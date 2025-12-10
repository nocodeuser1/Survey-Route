/*
  # Add SPCC External Completion Tracking

  ## Overview
  Adds a field to track when SPCC inspections are completed by external companies,
  allowing facilities to be marked as complete without creating an inspection record.

  ## Changes to `facilities` Table
  - `spcc_completed_by_other` (boolean, default false) - Indicates if SPCC was completed by another company
  - When true, facility is considered SPCC complete even without an inspection

  ## Notes
  - Defaults to false for all existing facilities
  - Used in conjunction with spcc_completed_date
  - Allows filtering out externally completed facilities across the app
*/

-- Add external completion tracking field
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS spcc_completed_by_other boolean DEFAULT false;

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_facilities_spcc_external
  ON facilities(spcc_completed_by_other)
  WHERE spcc_completed_by_other = true;

-- Add comment documenting the field
COMMENT ON COLUMN facilities.spcc_completed_by_other IS 'True if SPCC inspection was completed by another company (no inspection record needed)';
