/*
  # Separate SPCC Plan and Inspection Completion Dates

  ## Problem
  The spcc_completed_date field was being used for two different purposes:
  1. SPCC inspection completion (when spcc_completion_type is 'internal' or 'external')
  2. SPCC plan completion (incorrectly set by PE stamp date)

  ## Solution
  - Remove the BEFORE trigger that auto-syncs spcc_completed_date from spcc_pe_stamp_date
  - Update calculate_spcc_compliance() to ONLY use spcc_pe_stamp_date for plan tracking
  - Keep spcc_completed_date exclusively for SPCC inspection tracking
  - Clear any spcc_completed_date values that were incorrectly set by plan uploads
*/

-- ============================================================
-- 1. Drop the problematic BEFORE trigger
-- ============================================================
DROP TRIGGER IF EXISTS sync_spcc_completed_before_change ON facilities;
DROP FUNCTION IF EXISTS sync_spcc_completed_from_pe_stamp();

-- ============================================================
-- 2. Update calculate_spcc_compliance to use ONLY PE stamp date
-- ============================================================
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
  v_pe_stamp_date date;
  v_plan_url text;
  v_renewal_cycle_number integer;
  v_current_renewal_due_date date;
  v_current_renewal_completed_date date;
  v_compliance_status text;
  v_is_compliant boolean;
  v_days_until_due integer;
BEGIN
  -- Get facility data (PE stamp date is authoritative for plan completion)
  SELECT
    account_id,
    first_prod_date,
    spcc_pe_stamp_date::date,
    spcc_plan_url
  INTO v_facility
  FROM facilities
  WHERE id = p_facility_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_account_id := v_facility.account_id;
  v_initial_production_date := v_facility.first_prod_date;
  v_pe_stamp_date := v_facility.spcc_pe_stamp_date;
  v_plan_url := v_facility.spcc_plan_url;

  -- ========================================
  -- Case 1: No IP date -> not_started
  -- ========================================
  IF v_initial_production_date IS NULL THEN
    v_compliance_status := 'not_started';
    v_is_compliant := false;
    v_days_until_due := NULL;
    v_initial_spcc_due_date := NULL;
    v_renewal_cycle_number := 0;
    v_current_renewal_due_date := NULL;
    v_current_renewal_completed_date := NULL;
    v_initial_spcc_completed_date := NULL;

  ELSE
    -- Calculate initial SPCC due date (IP Date + 6 months)
    v_initial_spcc_due_date := v_initial_production_date + interval '6 months';

    -- ========================================
    -- Case 2: No PE stamp date -> initial phase
    -- ========================================
    IF v_pe_stamp_date IS NULL THEN
      v_renewal_cycle_number := 0;
      v_current_renewal_due_date := v_initial_spcc_due_date;
      v_initial_spcc_completed_date := NULL;
      v_current_renewal_completed_date := NULL;

      IF CURRENT_DATE > v_initial_spcc_due_date THEN
        v_compliance_status := 'overdue';
        v_is_compliant := false;
      ELSE
        v_compliance_status := 'initial_due';
        v_is_compliant := true; -- Within grace period IS compliant
      END IF;

      v_days_until_due := v_initial_spcc_due_date - CURRENT_DATE;

    -- ========================================
    -- Case 3: Has PE stamp date -> check renewals
    -- ========================================
    ELSE
      v_initial_spcc_completed_date := v_pe_stamp_date;

      -- Simple renewal calculation: just add 5 years from PE stamp
      v_current_renewal_due_date := v_pe_stamp_date + interval '5 years';
      v_renewal_cycle_number := 1;

      -- Fast-forward through any fully expired 5-year windows
      WHILE v_current_renewal_due_date < CURRENT_DATE - interval '5 years' LOOP
        v_current_renewal_due_date := v_current_renewal_due_date + interval '5 years';
        v_renewal_cycle_number := v_renewal_cycle_number + 1;
      END LOOP;

      -- Determine status based on where we are relative to renewal date
      IF CURRENT_DATE > v_current_renewal_due_date THEN
        -- Past the renewal date
        v_compliance_status := 'overdue';
        v_is_compliant := false;
        v_current_renewal_completed_date := NULL;
      ELSIF CURRENT_DATE >= v_current_renewal_due_date - interval '90 days' THEN
        -- Within 90 days of renewal
        v_compliance_status := 'expiring';
        v_is_compliant := true; -- Still valid, but approaching
        v_current_renewal_completed_date := v_pe_stamp_date;
      ELSE
        -- Renewal is far off, plan is valid
        IF v_renewal_cycle_number <= 1 THEN
          v_compliance_status := 'initial_complete';
        ELSE
          v_compliance_status := 'renewal_complete';
        END IF;
        v_is_compliant := true;
        v_current_renewal_completed_date := v_pe_stamp_date;
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
    pe_stamp_date,
    plan_url,
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
    v_pe_stamp_date,
    v_plan_url,
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
    pe_stamp_date = EXCLUDED.pe_stamp_date,
    plan_url = EXCLUDED.plan_url,
    updated_at = now();
END;
$$;

-- ============================================================
-- 3. Clear spcc_completed_date where it was set by plan upload
-- ============================================================
-- If spcc_completed_date matches spcc_pe_stamp_date AND there's no spcc_completion_type,
-- it was likely set by plan upload, so clear it
UPDATE facilities
SET spcc_completed_date = NULL
WHERE spcc_pe_stamp_date IS NOT NULL
  AND spcc_completed_date = spcc_pe_stamp_date::text
  AND spcc_completion_type IS NULL;

-- ============================================================
-- 4. Backfill all facilities
-- ============================================================
DO $$
DECLARE
  v_facility RECORD;
  v_count integer := 0;
BEGIN
  FOR v_facility IN
    SELECT id
    FROM facilities
    WHERE first_prod_date IS NOT NULL
       OR spcc_pe_stamp_date IS NOT NULL
  LOOP
    PERFORM calculate_spcc_compliance(v_facility.id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Recalculated SPCC compliance for % facilities', v_count;
END $$;
