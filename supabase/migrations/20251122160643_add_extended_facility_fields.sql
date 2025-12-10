/*
  # Add Extended Facility Fields for Well Data and SPCC Compliance

  ## Overview
  Adds comprehensive well data fields, API numbers, and SPCC compliance tracking
  to the facilities table to support detailed facility management and reporting.

  ## Changes to `facilities` Table

  ### Well Information
  - `matched_facility_name` (text) - Matched facility name from well list
  - `well_name_1` through `well_name_6` (text) - Six well name fields

  ### API Numbers
  - `well_api_1` through `well_api_6` (text) - Individual well API numbers
  - `api_numbers_combined` (text) - Combined API numbers field

  ### Alternative Coordinates
  - `lat_well_sheet` (decimal) - Latitude from well sheet (may differ from primary)
  - `long_well_sheet` (decimal) - Longitude from well sheet

  ### Date Fields
  - `first_prod_date` (date) - First production date
  - `spcc_due_date` (date) - SPCC compliance due date (on or before)
  - `spcc_completed_date` (date) - Date SPCC was completed (if applicable)

  ## Indexes
  - Add index on spcc_due_date for filtering facilities by due date
  - Add index on spcc_completed_date for filtering completed facilities
  - Add index on matched_facility_name for search functionality

  ## Notes
  - All new columns are nullable to maintain backward compatibility
  - Existing facilities will have NULL values for these fields
  - SPCC completion tracking is separate from inspection system
  - Date fields use PostgreSQL date type for proper date comparisons
*/

-- Add well information columns
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS matched_facility_name text,
ADD COLUMN IF NOT EXISTS well_name_1 text,
ADD COLUMN IF NOT EXISTS well_name_2 text,
ADD COLUMN IF NOT EXISTS well_name_3 text,
ADD COLUMN IF NOT EXISTS well_name_4 text,
ADD COLUMN IF NOT EXISTS well_name_5 text,
ADD COLUMN IF NOT EXISTS well_name_6 text;

-- Add API number columns
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS well_api_1 text,
ADD COLUMN IF NOT EXISTS well_api_2 text,
ADD COLUMN IF NOT EXISTS well_api_3 text,
ADD COLUMN IF NOT EXISTS well_api_4 text,
ADD COLUMN IF NOT EXISTS well_api_5 text,
ADD COLUMN IF NOT EXISTS well_api_6 text,
ADD COLUMN IF NOT EXISTS api_numbers_combined text;

-- Add alternative coordinate columns
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS lat_well_sheet decimal(10, 7),
ADD COLUMN IF NOT EXISTS long_well_sheet decimal(10, 7);

-- Add date columns
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS first_prod_date date,
ADD COLUMN IF NOT EXISTS spcc_due_date date,
ADD COLUMN IF NOT EXISTS spcc_completed_date date;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_facilities_spcc_due_date
  ON facilities(spcc_due_date)
  WHERE spcc_due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facilities_spcc_completed_date
  ON facilities(spcc_completed_date)
  WHERE spcc_completed_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facilities_matched_name
  ON facilities(matched_facility_name)
  WHERE matched_facility_name IS NOT NULL;

-- Add comment documenting the new fields
COMMENT ON COLUMN facilities.matched_facility_name IS 'Matched facility name from well list';
COMMENT ON COLUMN facilities.spcc_completed_date IS 'Date SPCC was completed - separate from inspection system';
COMMENT ON COLUMN facilities.spcc_due_date IS 'SPCC compliance due date (on or before)';