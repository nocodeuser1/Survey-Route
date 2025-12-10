/*
  # Add Settings and Home Base Data to Route Plans

  1. Changes
    - Add `settings` column to store route optimization settings
    - Add `home_base_data` column to store home base configuration
    - These columns are needed to restore full route context when loading saved routes

  2. Notes
    - Both columns store JSON data
    - Existing routes will have NULL values for these fields
*/

-- Add settings column to route_plans table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_plans' AND column_name = 'settings'
  ) THEN
    ALTER TABLE route_plans ADD COLUMN settings jsonb;
  END IF;
END $$;

-- Add home_base_data column to route_plans table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_plans' AND column_name = 'home_base_data'
  ) THEN
    ALTER TABLE route_plans ADD COLUMN home_base_data jsonb;
  END IF;
END $$;
