/*
  # Add Survey Mode Support

  1. Changes to user_settings table
    - Add `map_preference` column (text) - Options: 'google' or 'apple'
    - Default to 'google' for compatibility

  2. Indexes
    - Add index on inspections.conducted_at for faster date-based queries
    - This improves performance when checking inspection verification status

  3. Notes
    - Map preference allows users to choose their preferred navigation app
    - Inspection date index speeds up verification checks (inspections within last year)
*/

-- Add map preference to user_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'map_preference'
  ) THEN
    ALTER TABLE user_settings
    ADD COLUMN map_preference text DEFAULT 'google' CHECK (map_preference IN ('google', 'apple'));
  END IF;
END $$;

-- Add index on inspection conducted_at for faster date queries
CREATE INDEX IF NOT EXISTS idx_inspections_conducted_at ON inspections(conducted_at DESC);

-- Add index on facility_id and conducted_at together for even faster facility-specific queries
CREATE INDEX IF NOT EXISTS idx_inspections_facility_conducted ON inspections(facility_id, conducted_at DESC);
