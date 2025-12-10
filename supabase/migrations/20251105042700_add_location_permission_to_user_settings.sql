/*
  # Add Location Permission State to User Settings

  1. Changes
    - Add `location_permission_granted` column to `user_settings` table
    - This tracks whether the user has granted location permissions for Survey Mode
    - Defaults to `false` so users must grant permission at least once

  2. Notes
    - Once a user grants location permission, this will be set to `true`
    - This prevents the location permission prompt from appearing every time Survey Mode is opened
    - Users can still revoke permissions in their browser/device settings
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'location_permission_granted'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN location_permission_granted boolean DEFAULT false NOT NULL;
  END IF;
END $$;
