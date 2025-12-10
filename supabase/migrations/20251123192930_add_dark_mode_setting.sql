/*
  # Add Dark Mode Setting

  1. Changes
    - Add `dark_mode` column to `user_settings` table with default false
    - Allows users to toggle between light and dark themes

  2. Details
    - Column type: boolean
    - Default value: false (light mode)
    - No RLS changes needed (inherits from user_settings policies)
*/

-- Add dark_mode column to user_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'dark_mode'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN dark_mode boolean DEFAULT false;
  END IF;
END $$;