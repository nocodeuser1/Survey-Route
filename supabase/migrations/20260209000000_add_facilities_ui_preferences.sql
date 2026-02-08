/*
  # Add Facilities UI Preferences Column

  1. Changes
    - Add `facilities_ui_preferences` JSONB column to `user_settings` table

  2. Details
    - Stores per-account facility tab UI preferences as JSON
    - Shape: { sort_column, sort_direction, hide_empty_fields, columns: { [key]: { visible, order } } }
    - Nullable, defaults to NULL (existing localStorage values used as fallback)

  3. Notes
    - No RLS changes needed -- user_settings already uses user_has_account_access(account_id)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'facilities_ui_preferences'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN facilities_ui_preferences jsonb;
  END IF;
END $$;
