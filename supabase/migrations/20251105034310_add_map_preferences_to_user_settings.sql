/*
  # Add Map Preferences to User Settings

  1. Changes
    - Add `map_preference` column to store user's preferred map service (google/apple)
    - Add `include_google_earth` column to enable/disable Google Earth option
  
  2. Notes
    - Defaults to Google Maps preference
    - Google Earth option defaults to false
*/

-- Add map_preference column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'map_preference'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN map_preference text DEFAULT 'google' NOT NULL;
    ALTER TABLE user_settings ADD CONSTRAINT user_settings_map_preference_check 
      CHECK (map_preference IN ('google', 'apple'));
  END IF;
END $$;

-- Add include_google_earth column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'include_google_earth'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN include_google_earth boolean DEFAULT false NOT NULL;
  END IF;
END $$;
