/*
  # Create SPCC Compliance Calculation Function

  ## Overview
  Creates a comprehensive function to calculate SPCC compliance status based on:
  - Initial Production Date (IP Date)
  - Initial SPCC plan (due 6 months after IP Date)
  - SPCC renewals (due 5 years after each completion)
  - Current dates and completion records

  ## Function: calculate_spcc_compliance

  ### Inputs
  - p_facility_id (uuid) - The facility to calculate compliance for

  ### Logic
  1. Get facility data (IP date, SPCC dates from facilities table)
  2. Determine if in initial phase (< 6 months from IP) or renewal phase
  3. Calculate current due date based on phase
  4. Determine compliance status
  5. Calculate days until due
  6. Update or insert spcc_compliance_tracking record

  ### Compliance Status Determination
  - `not_started`: No IP date provided
  - `initial_due`: Initial plan pending (within 6 months of IP date)
  - `initial_complete`: Initial plan completed, no renewal due yet
  - `renewal_due`: Renewal plan pending
  - `renewal_complete`: Renewal completed, next not due yet
  - `overdue`: Past due date without completion

  ### Returns
  - void (updates spcc_compliance_tracking table)

  ## Notes
  - Called automatically by trigger when facility dates change
  - Can be called manually to recalculate compliance
  - Handles all edge cases (missing dates, old facilities, etc.)
*/

-- Create comprehensive SPCC compliance calculation function
CREATE OR REPLACE FUNCTION calculate_spcc_compliance(p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_facility RECORD;
  v_account_id uuid;
  v_initial_production_date date;
  v_initial_spcc_due_date date;
  v_initial_spcc_completed_date date;
  v_spcc_completed_date date;
  v_renewal_cycle_number integer;
  v_current_renewal_due_date date;
  v_current_renewal_completed_date date;
  v_compliance_status text;
  v_is_compliant boolean;
  v_days_until_due integer;
  v_last_completion_date date;
BEGIN
  -- Get facility data
  SELECT 
    account_id,
    first_prod_date,
    spcc_completed_date
  INTO v_facility
  FROM facilities
  WHERE id = p_facility_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  v_account_id := v_facility.account_id;
  v_initial_production_date := v_facility.first_prod_date;
  v_spcc_completed_date := v_facility.spcc_completed_date;
  
  -- If no IP date, set as not_started
  IF v_initial_production_date IS NULL THEN
    v_compliance_status := 'not_started';
    v_is_compliant := false;
    v_days_until_due := NULL;
    v_initial_spcc_due_date := NULL;
    v_renewal_cycle_number := 0;
    v_current_renewal_due_date := NULL;
  ELSE
    -- Calculate initial SPCC due date (IP Date + 6 months)
    v_initial_spcc_due_date := v_initial_production_date + interval '6 months';
    
    -- Determine if initial SPCC is complete
    IF v_spcc_completed_date IS NULL THEN
      -- Initial SPCC not completed
      v_renewal_cycle_number := 0;
      v_current_renewal_due_date := v_initial_spcc_due_date;
      v_initial_spcc_completed_date := NULL;
      
      -- Check if overdue or still pending
      IF CURRENT_DATE > v_initial_spcc_due_date THEN
        v_compliance_status := 'overdue';
        v_is_compliant := false;
      ELSE
        v_compliance_status := 'initial_due';
        v_is_compliant := false;
      END IF;
      
      v_days_until_due := v_initial_spcc_due_date - CURRENT_DATE;
      
    ELSIF v_spcc_completed_date <= v_initial_spcc_due_date THEN
      -- Initial SPCC completed on time or early
      v_initial_spcc_completed_date := v_spcc_completed_date;
      v_last_completion_date := v_spcc_completed_date;
      
      -- Calculate renewal cycle
      -- Each renewal is 5 years from last completion
      v_renewal_cycle_number := FLOOR(EXTRACT(YEAR FROM AGE(CURRENT_DATE, v_last_completion_date)) / 5);
      
      -- Calculate current renewal due date
      v_current_renewal_due_date := v_last_completion_date + (interval '5 years' * (v_renewal_cycle_number + 1));
      
      -- Check if renewal is due
      IF CURRENT_DATE >= (v_last_completion_date + interval '5 years' * v_renewal_cycle_number) THEN
        -- We're in a renewal period
        IF CURRENT_DATE > v_current_renewal_due_date THEN
          v_compliance_status := 'overdue';
          v_is_compliant := false;
        ELSE
          v_compliance_status := 'renewal_due';
          v_is_compliant := false;
        END IF;
        v_current_renewal_completed_date := NULL;
      ELSE
        -- Not yet time for next renewal
        IF v_renewal_cycle_number = 0 THEN
          v_compliance_status := 'initial_complete';
        ELSE
          v_compliance_status := 'renewal_complete';
        END IF;
        v_is_compliant := true;
        v_current_renewal_completed_date := v_last_completion_date;
      END IF;
      
      v_days_until_due := v_current_renewal_due_date - CURRENT_DATE;
      
    ELSE
      -- Initial SPCC completed late (after due date)
      v_initial_spcc_completed_date := v_spcc_completed_date;
      v_last_completion_date := v_spcc_completed_date;
      v_renewal_cycle_number := 0;
      
      -- Calculate first renewal due date (5 years from late completion)
      v_current_renewal_due_date := v_last_completion_date + interval '5 years';
      
      -- Check if renewal is due
      IF CURRENT_DATE >= v_last_completion_date + interval '5 years' THEN
        IF CURRENT_DATE > v_current_renewal_due_date THEN
          v_compliance_status := 'overdue';
          v_is_compliant := false;
        ELSE
          v_compliance_status := 'renewal_due';
          v_is_compliant := false;
        END IF;
        v_current_renewal_completed_date := NULL;
      ELSE
        v_compliance_status := 'initial_complete';
        v_is_compliant := true;
        v_current_renewal_completed_date := v_last_completion_date;
      END IF;
      
      v_days_until_due := v_current_renewal_due_date - CURRENT_DATE;
    END IF;
  END IF;
  
  -- Upsert spcc_compliance_tracking record
  INSERT INTO spcc_compliance_tracking (
    facility_id,
    account_id,
    initial_production_date,
    initial_spcc_due_date,
    initial_spcc_completed_date,
    renewal_cycle_number,
    current_renewal_due_date,
    current_renewal_completed_date,
    is_compliant,
    compliance_status,
    days_until_due,
    updated_at
  ) VALUES (
    p_facility_id,
    v_account_id,
    v_initial_production_date,
    v_initial_spcc_due_date,
    v_initial_spcc_completed_date,
    v_renewal_cycle_number,
    v_current_renewal_due_date,
    v_current_renewal_completed_date,
    v_is_compliant,
    v_compliance_status,
    v_days_until_due,
    now()
  )
  ON CONFLICT (facility_id) DO UPDATE SET
    account_id = EXCLUDED.account_id,
    initial_production_date = EXCLUDED.initial_production_date,
    initial_spcc_due_date = EXCLUDED.initial_spcc_due_date,
    initial_spcc_completed_date = EXCLUDED.initial_spcc_completed_date,
    renewal_cycle_number = EXCLUDED.renewal_cycle_number,
    current_renewal_due_date = EXCLUDED.current_renewal_due_date,
    current_renewal_completed_date = EXCLUDED.current_renewal_completed_date,
    is_compliant = EXCLUDED.is_compliant,
    compliance_status = EXCLUDED.compliance_status,
    days_until_due = EXCLUDED.days_until_due,
    updated_at = now();
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION calculate_spcc_compliance IS 'Calculates SPCC compliance status for a facility based on IP Date, initial plan (6 months), and renewals (5 years)';
