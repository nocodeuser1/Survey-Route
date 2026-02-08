-- Fix trigger_update_spcc_compliance() referencing non-existent column
-- The trigger was referencing 'spcc_completed_date' which doesn't exist.
-- The correct column names are 'spcc_inspection_date', 'spcc_pe_stamp_date', and 'spcc_plan_url'.
-- This caused ALL updates to the facilities table to fail with a 400 error.

CREATE OR REPLACE FUNCTION trigger_update_spcc_compliance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_prod_date IS NOT NULL OR NEW.spcc_inspection_date IS NOT NULL THEN
      PERFORM calculate_spcc_compliance(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.first_prod_date IS DISTINCT FROM OLD.first_prod_date)
       OR (NEW.spcc_inspection_date IS DISTINCT FROM OLD.spcc_inspection_date)
       OR (NEW.spcc_pe_stamp_date IS DISTINCT FROM OLD.spcc_pe_stamp_date)
       OR (NEW.spcc_plan_url IS DISTINCT FROM OLD.spcc_plan_url)
       OR (NEW.account_id IS DISTINCT FROM OLD.account_id) THEN
      PERFORM calculate_spcc_compliance(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
