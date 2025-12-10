/*
  # Create SPCC Compliance Auto-Update Trigger

  ## Overview
  Creates a trigger that automatically recalculates SPCC compliance when:
  - first_prod_date (Initial Production Date) changes
  - spcc_completed_date changes
  - A facility is created with these dates

  ## Trigger Function: trigger_update_spcc_compliance

  ### When Triggered
  - AFTER INSERT on facilities (if dates are provided)
  - AFTER UPDATE on facilities (if dates changed)

  ### What It Does
  - Calls calculate_spcc_compliance() function
  - Ensures compliance tracking stays in sync with facility data
  - Handles both new facilities and updates to existing ones

  ## Notes
  - Runs after row is committed for data consistency
  - Only triggers if relevant date fields actually changed
  - Safe to run multiple times (upsert logic in calculate function)
*/

-- Create trigger function to update SPCC compliance
CREATE OR REPLACE FUNCTION trigger_update_spcc_compliance()
RETURNS TRIGGER AS $$
BEGIN
  -- For INSERT, always calculate if we have an IP date or SPCC date
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_prod_date IS NOT NULL OR NEW.spcc_completed_date IS NOT NULL THEN
      PERFORM calculate_spcc_compliance(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  -- For UPDATE, only recalculate if relevant fields changed
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.first_prod_date IS DISTINCT FROM OLD.first_prod_date)
       OR (NEW.spcc_completed_date IS DISTINCT FROM OLD.spcc_completed_date)
       OR (NEW.account_id IS DISTINCT FROM OLD.account_id) THEN
      PERFORM calculate_spcc_compliance(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on facilities table
DROP TRIGGER IF EXISTS update_spcc_compliance_on_facility_change ON facilities;
CREATE TRIGGER update_spcc_compliance_on_facility_change
  AFTER INSERT OR UPDATE ON facilities
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_spcc_compliance();

-- Backfill compliance tracking for existing facilities with IP dates
DO $$
DECLARE
  v_facility RECORD;
  v_count integer := 0;
BEGIN
  FOR v_facility IN 
    SELECT id 
    FROM facilities 
    WHERE first_prod_date IS NOT NULL OR spcc_completed_date IS NOT NULL
  LOOP
    PERFORM calculate_spcc_compliance(v_facility.id);
    v_count := v_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Backfilled SPCC compliance tracking for % facilities', v_count;
END $$;

-- Add helpful comments
COMMENT ON FUNCTION trigger_update_spcc_compliance IS 'Trigger function that automatically recalculates SPCC compliance when facility dates change';
