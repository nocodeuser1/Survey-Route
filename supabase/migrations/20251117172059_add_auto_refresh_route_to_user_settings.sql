/*
  # Add Auto Refresh Route to User Settings

  1. Changes
    - Add `auto_refresh_route` column to `user_settings` table
      - Type: boolean
      - Default: false
      - Controls whether facility updates automatically trigger route recalculation
  
  2. Notes
    - When false: Updating facility duration only updates times in existing route
    - When true: Updating facility duration triggers full route optimization
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'auto_refresh_route'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN auto_refresh_route boolean DEFAULT false;
  END IF;
END $$;