/*
  # Add Survey Type Visit Duration Settings

  1. Changes
    - Add `inspection_visit_duration_minutes` integer field to user_settings table (default 30)
    - Add `plan_visit_duration_minutes` integer field to user_settings table (default 60)

  2. Purpose
    - SPCC Inspections and SPCC Plans take different amounts of time onsite
    - When generating routes in a specific survey mode, the system uses the corresponding duration
    - In "All Facilities" mode, per-facility visit_duration_minutes is used (existing behavior)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'inspection_visit_duration_minutes'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN inspection_visit_duration_minutes integer DEFAULT 30;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'plan_visit_duration_minutes'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN plan_visit_duration_minutes integer DEFAULT 60;
  END IF;
END $$;
