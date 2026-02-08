/*
  # Add SPCC Extraction Configuration

  1. Changes
    - Add `spcc_extraction_config` JSONB field to user_settings table
    - Stores per-account PDF extraction regions for facility name and PE stamp date

  2. Structure
    {
      "facility_name_page": 1,
      "facility_name_region": { "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.05 },
      "pe_stamp_date_page": 1,
      "pe_stamp_date_region": { "x": 0.6, "y": 0.8, "width": 0.3, "height": 0.04 }
    }
    Coordinates are percentages (0-1) of page dimensions.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'spcc_extraction_config'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN spcc_extraction_config jsonb DEFAULT null;
  END IF;
END $$;
