/*
  # Add Exclude Externally Completed Facilities Setting

  1. Changes
    - Add `exclude_externally_completed` boolean field to user_settings table
    - Defaults to false to maintain existing behavior
  
  2. Purpose
    - Allows users to selectively exclude only externally completed facilities from route optimization
    - Provides granular control separate from the general exclude_completed_facilities setting
    - External completions are facilities marked as completed by external inspectors
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'exclude_externally_completed'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN exclude_externally_completed boolean DEFAULT false;
  END IF;
END $$;