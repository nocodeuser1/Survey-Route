/*
  # Add Exclude Completed Type Setting

  1. Changes
    - Add `exclude_completed_type` text field to user_settings table
    - Defaults to 'inspection' to maintain existing behavior

  2. Purpose
    - Allows users to choose which type of completion to exclude from route optimization:
      - 'inspection': Exclude facilities with completed SPCC inspections
      - 'plan': Exclude facilities with up-to-date SPCC plans (not due for renewal)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'exclude_completed_type'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN exclude_completed_type text DEFAULT 'inspection';
  END IF;
END $$;
