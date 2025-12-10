/*
  # Add Google Earth Navigation Option

  1. Changes
    - Add `include_google_earth` boolean column to `user_settings` table
    - Default value is false

  2. Notes
    - This allows users to optionally include Google Earth in navigation options
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'include_google_earth'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN include_google_earth boolean DEFAULT false;
  END IF;
END $$;