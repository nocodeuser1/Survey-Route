/*
  # Add Notes Column to Facilities

  Adds a text field for storing multi-line notes on each facility.
*/

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN facilities.notes IS 'Free-form notes for the facility (multi-line text)';
