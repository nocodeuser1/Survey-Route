/*
  # Add Navigation Mode Settings

  1. Changes to user_settings table
    - Add `navigation_mode_enabled` (boolean) - Toggle navigation mode on/off
    - Add `speed_unit` (text) - Display speed in 'mph' or 'kmh'
    - Add `estimate_speed_limits` (boolean) - Enable/disable speed limit estimation from OSM
    - Add `auto_start_navigation` (boolean) - Auto-start navigation mode in full-screen
    - Add `map_rotation_sensitivity` (numeric) - Control map rotation smoothness (0.1 to 1.0)

  2. Notes
    - All fields have sensible defaults
    - Settings support both metric and imperial units
    - Speed limit estimation is opt-in to avoid API abuse
    - Map rotation sensitivity allows user customization
*/

-- Add navigation mode settings to user_settings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'navigation_mode_enabled'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN navigation_mode_enabled boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'speed_unit'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN speed_unit text DEFAULT 'mph' CHECK (speed_unit IN ('mph', 'kmh'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'estimate_speed_limits'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN estimate_speed_limits boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'auto_start_navigation'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN auto_start_navigation boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'map_rotation_sensitivity'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN map_rotation_sensitivity numeric DEFAULT 0.7 CHECK (map_rotation_sensitivity >= 0.1 AND map_rotation_sensitivity <= 1.0);
  END IF;
END $$;