-- Add well_name_7 through well_name_10 and well_api_7 through well_api_10 to facilities table
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS well_name_7 text,
  ADD COLUMN IF NOT EXISTS well_api_7 text,
  ADD COLUMN IF NOT EXISTS well_name_8 text,
  ADD COLUMN IF NOT EXISTS well_api_8 text,
  ADD COLUMN IF NOT EXISTS well_name_9 text,
  ADD COLUMN IF NOT EXISTS well_api_9 text,
  ADD COLUMN IF NOT EXISTS well_name_10 text,
  ADD COLUMN IF NOT EXISTS well_api_10 text;

-- Grant access consistent with existing well columns
GRANT SELECT, INSERT, UPDATE ON facilities TO authenticated;
GRANT SELECT, INSERT, UPDATE ON facilities TO service_role;
