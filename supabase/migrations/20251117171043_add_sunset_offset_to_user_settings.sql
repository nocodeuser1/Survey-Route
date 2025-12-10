/*
  # Add Sunset Offset to User Settings

  1. Changes
    - Add `sunset_offset_minutes` column to `user_settings` table
      - Type: integer
      - Default: 0 (no offset)
      - Allows positive or negative values to adjust sunset time forward or backward
  
  2. Notes
    - Positive values move sunset time later (e.g., 15 means 15 minutes after actual sunset)
    - Negative values move sunset time earlier (e.g., -15 means 15 minutes before actual sunset)
    - Used for calculating sunset-related route indicators and warnings
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'sunset_offset_minutes'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN sunset_offset_minutes integer DEFAULT 0;
  END IF;
END $$;