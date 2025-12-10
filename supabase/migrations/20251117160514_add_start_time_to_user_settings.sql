/*
  # Add start_time column to user_settings table

  1. Changes
    - Add `start_time` column to `user_settings` table to store daily route start time
    - Default value is '08:00' (8:00 AM in 24-hour format)
    - Column stores time in HH:MM format for consistency

  2. Purpose
    - Allows users to configure when their daily routes should start
    - Provides flexibility for different work schedules
    - Used by route optimization to calculate arrival/departure times

  3. Notes
    - Existing records will receive the default value '08:00'
    - Time is stored in 24-hour format (00:00 to 23:59)
    - Frontend will handle conversion to/from 12-hour AM/PM format for user input
*/

-- Add start_time column to user_settings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'start_time'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN start_time text DEFAULT '08:00';
  END IF;
END $$;