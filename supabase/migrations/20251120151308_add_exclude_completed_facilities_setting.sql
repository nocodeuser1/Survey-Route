/*
  # Add Exclude Completed Facilities Setting

  1. Changes
    - Add `exclude_completed_facilities` boolean field to user_settings table
    - Defaults to false to maintain existing behavior
  
  2. Purpose
    - Allows users to exclude completed facilities from route optimization
    - Completed facilities remain visible on map but are not included in new routes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'exclude_completed_facilities'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN exclude_completed_facilities boolean DEFAULT false;
  END IF;
END $$;