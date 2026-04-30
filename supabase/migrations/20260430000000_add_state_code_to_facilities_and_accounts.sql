/*
  # Add state code to facilities + account-level default state

  Lets the SPCC Recertification page populate `Location: lat,lon | County, ST`.
  Per Israel: every facility has a state; companies operate in (usually) one
  state, so the account carries a default that auto-fills on new facilities
  but stays editable per-facility.

  ## Columns

  - `accounts.default_state_code`  text — 2-letter US state code (e.g. 'OK')
  - `facilities.state_code`        text — 2-letter US state code; falls back
                                          to the account default on insert
                                          via a BEFORE INSERT trigger

  ## Backfill

  All existing facilities → 'OK' (Camino is OK-only). Camino's account row
  also gets default_state_code = 'OK' so freshly imported facilities pick
  it up automatically.

  ## Trigger

  `facilities_default_state_code_from_account` — BEFORE INSERT. If the
  inserted row has a NULL `state_code`, copy it from the parent account's
  `default_state_code`. Stays NULL only if neither is set. Always
  overridable by setting state_code explicitly in the INSERT.
*/

-- Account-level default
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS default_state_code text;

COMMENT ON COLUMN accounts.default_state_code IS
  '2-letter US state code applied to new facilities by default. Editable per-facility.';

-- Per-facility state
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS state_code text;

COMMENT ON COLUMN facilities.state_code IS
  '2-letter US state code. Auto-defaulted from accounts.default_state_code on insert; freely editable.';

-- Backfill: every existing facility → OK; Camino's account default → OK
UPDATE facilities SET state_code = 'OK' WHERE state_code IS NULL;
UPDATE accounts SET default_state_code = 'OK' WHERE default_state_code IS NULL;

-- Trigger: new facilities inherit state_code from parent account when not specified
CREATE OR REPLACE FUNCTION facilities_default_state_code_from_account()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state_code IS NULL AND NEW.account_id IS NOT NULL THEN
    SELECT default_state_code
      INTO NEW.state_code
      FROM accounts
     WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facilities_default_state_code_trigger ON facilities;
CREATE TRIGGER facilities_default_state_code_trigger
  BEFORE INSERT ON facilities
  FOR EACH ROW
  EXECUTE FUNCTION facilities_default_state_code_from_account();
