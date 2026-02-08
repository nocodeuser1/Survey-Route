/*
  # Add Workday Constraint Settings

  1. Changes
    - Add `lunch_break_minutes` integer field to user_settings table (default 0)
    - Add `max_drive_time_minutes` integer field to user_settings table (default 0)
    - Add `return_by_time` text field to user_settings table (default null)

  2. Purpose
    - Allows users to configure a lunch/break time that gets inserted at the midpoint of each day's route
    - Allows users to set a maximum cumulative driving time per day
    - Allows users to set a return-by-time constraint so routes end before a certain time
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'lunch_break_minutes'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN lunch_break_minutes integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'max_drive_time_minutes'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN max_drive_time_minutes integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'return_by_time'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN return_by_time text DEFAULT null;
  END IF;
END $$;
