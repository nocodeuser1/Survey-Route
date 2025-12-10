/*
  # Add Day Assignment to Facilities

  ## Summary
  This migration adds day assignment functionality to support manual facility reassignment
  between days in the route optimization system.

  ## Changes

  ### Schema Changes
  1. Add `day_assignment` column to `facilities` table
     - Nullable integer field to store which day a facility is assigned to
     - NULL means the facility has no manual assignment and should use auto-generated routing
     - Values 1-N correspond to day numbers in the route plan

  2. Create index on `day_assignment` for efficient filtering

  ## Notes
  - This field preserves user manual assignments when regenerating routes
  - NULL values indicate auto-assignment should be used
  - Values should correspond to valid day numbers in the current route plan
  - This supports the facility reassignment UI feature
*/

-- Add day_assignment column to facilities table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'facilities' AND column_name = 'day_assignment'
  ) THEN
    ALTER TABLE facilities ADD COLUMN day_assignment integer DEFAULT NULL;
  END IF;
END $$;

-- Create index on day_assignment for efficient queries
CREATE INDEX IF NOT EXISTS idx_facilities_day_assignment
  ON facilities(day_assignment)
  WHERE day_assignment IS NOT NULL;

-- Add comment to document the column
COMMENT ON COLUMN facilities.day_assignment IS
  'Manual day assignment for route planning. NULL = auto-assign, 1-N = specific day number';
