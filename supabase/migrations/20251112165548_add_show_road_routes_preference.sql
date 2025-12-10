/*
  # Add road routes display preference to user settings

  1. Changes
    - Add show_road_routes boolean column to user_settings table
    - Default to false (roads off by default)
  
  2. Notes
    - This preference persists whether road routes are displayed on the map
    - Users can toggle this on/off and it will be remembered across sessions
*/

-- Add show_road_routes column to user_settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'show_road_routes'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN show_road_routes boolean DEFAULT false NOT NULL;
  END IF;
END $$;