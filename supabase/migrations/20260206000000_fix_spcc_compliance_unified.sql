/*
  # Unified SPCC Compliance Tracking Fix

  ## Problems Fixed
  1. Plan upload (spcc_pe_stamp_date) did not trigger compliance recalculation
  2. 5-year renewal calculation had a cycle multiplication bug
  3. spcc_completed_date was never set when uploading a plan
  4. initial_due facilities were marked as non-compliant (they're within grace period)
  5. No "expiring" status for plans approaching 5-year renewal

  ## Changes
  - BEFORE trigger: auto-syncs spcc_completed_date from spcc_pe_stamp_date
  - AFTER trigger: now watches spcc_pe_stamp_date and spcc_plan_url changes
  - calculate_spcc_compliance(): reads PE stamp date, fixes renewal math, adds expiring status
  - New columns on spcc_compliance_tracking: pe_stamp_date, plan_url
  - Backfills all existing facilities
*/

-- ============================================================
-- 1. Add new columns to spcc_compliance_tracking
-- ============================================================
ALTER TABLE spcc_compliance_tracking
  ADD COLUMN IF NOT EXISTS pe_stamp_date date,
  ADD COLUMN IF NOT EXISTS plan_url text;

-- Update compliance_status constraint to include 'expiring'
ALTER TABLE spcc_compliance_tracking
  DROP CONSTRAINT IF EXISTS spcc_compliance_tracking_compliance_status_check;

ALTER TABLE spcc_compliance_tracking
  ADD CONSTRAINT spcc_compliance_tracking_compliance_status_check
  CHECK (compliance_status IN (
    'not_started', 'initial_due', 'initial_complete',
    'renewal_due', 'renewal_complete', 'overdue', 'expiring'
  ));

-- ============================================================
-- 2. BEFORE trigger: auto-sync spcc_completed_date from PE stamp
-- ============================================================
CREATE OR REPLACE FUNCTION sync_spcc_completed_from_pe_stamp()
RETURNS TRIGGER AS $$
BEGIN
  -- When PE stamp date is set/changed, bridge it to spcc_completed_date
  IF NEW.spcc_pe_stamp_date IS NOT NULL
     AND (OLD IS NULL
          OR OLD.spcc_pe_stamp_date IS NULL
          OR NEW.spcc_pe_stamp_date IS DISTINCT FROM OLD.spcc_pe_stamp_date) THEN
    NEW.spcc_completed_date := NEW.spcc_pe_stamp_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_spcc_completed_before_change ON facilities;
CREATE TRIGGER sync_spcc_completed_before_change
  BEFORE INSERT OR UPDATE ON facilities
  FOR EACH ROW
  EXECUTE FUNCTION sync_spcc_completed_from_pe_stamp();

-- ============================================================
-- 3. Replace the compliance calculation function
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
  v_effective_completed_date date;
  v_pe_stamp_date date;
  v_plan_url text;
  v_renewal_cycle_number integer;
  v_current_renewal_due_date date;
  v_current_renewal_completed_date date;
  v_compliance_status text;
  v_is_compliant boolean;
  v_days_until_due integer;
BEGIN
  -- Get facility data (now includes PE stamp date and plan URL)
  SELECT
    account_id,
    first_prod_date,
    spcc_completed_date,
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

  -- PE stamp date is the authoritative completion date
  v_effective_completed_date := COALESCE(v_pe_stamp_date, v_facility.spcc_completed_date);

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
    -- Case 2: No completion date -> initial phase
    -- ========================================
    IF v_effective_completed_date IS NULL THEN
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
    -- Case 3: Has completion date -> check renewals
    -- ========================================
    ELSE
      v_initial_spcc_completed_date := v_effective_completed_date;

      -- Simple renewal calculation: just add 5 years from completion
      -- If that renewal has passed without a new completion, it's overdue
      v_current_renewal_due_date := v_effective_completed_date + interval '5 years';
      v_renewal_cycle_number := 1;

      -- Fast-forward through any fully expired 5-year windows
      -- (handles facilities operating 15+ years with same old completion date)
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
        v_current_renewal_completed_date := v_effective_completed_date;
      ELSE
        -- Renewal is far off, plan is valid
        IF v_renewal_cycle_number <= 1 THEN
          v_compliance_status := 'initial_complete';
        ELSE
          v_compliance_status := 'renewal_complete';
        END IF;
        v_is_compliant := true;
        v_current_renewal_completed_date := v_effective_completed_date;
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
-- 4. Replace the AFTER trigger to watch PE stamp + plan URL
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_update_spcc_compliance()
RETURNS TRIGGER AS $$
BEGIN
  -- For INSERT, calculate if we have any relevant date
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_prod_date IS NOT NULL
       OR NEW.spcc_completed_date IS NOT NULL
       OR NEW.spcc_pe_stamp_date IS NOT NULL THEN
      PERFORM calculate_spcc_compliance(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  -- For UPDATE, recalculate if any relevant field changed
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.first_prod_date IS DISTINCT FROM OLD.first_prod_date)
       OR (NEW.spcc_completed_date IS DISTINCT FROM OLD.spcc_completed_date)
       OR (NEW.spcc_pe_stamp_date IS DISTINCT FROM OLD.spcc_pe_stamp_date)
       OR (NEW.spcc_plan_url IS DISTINCT FROM OLD.spcc_plan_url)
       OR (NEW.account_id IS DISTINCT FROM OLD.account_id) THEN
      PERFORM calculate_spcc_compliance(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
DROP TRIGGER IF EXISTS update_spcc_compliance_on_facility_change ON facilities;
CREATE TRIGGER update_spcc_compliance_on_facility_change
  AFTER INSERT OR UPDATE ON facilities
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_spcc_compliance();

-- ============================================================
-- 5. Backfill all existing facilities
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
       OR spcc_completed_date IS NOT NULL
       OR spcc_pe_stamp_date IS NOT NULL
  LOOP
    PERFORM calculate_spcc_compliance(v_facility.id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfilled SPCC compliance tracking for % facilities', v_count;
END $$;

-- ============================================================
-- 6. Sync existing PE stamp dates to spcc_completed_date
-- ============================================================
UPDATE facilities
SET spcc_completed_date = spcc_pe_stamp_date
WHERE spcc_pe_stamp_date IS NOT NULL
  AND (spcc_completed_date IS NULL OR spcc_completed_date != spcc_pe_stamp_date);
