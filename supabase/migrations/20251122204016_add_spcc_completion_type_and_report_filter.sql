/*
  # Add SPCC Completion Type and Report Type Filter
  
  ## Overview
  Enhances SPCC completion tracking with internal/external distinction and adds report type filtering preference.
  
  ## Changes to `facilities` Table
  1. New Fields:
     - `spcc_completion_type` (text) - Tracks whether SPCC was completed 'internal' or 'external'
     - Values: NULL (not completed), 'internal' (completed by your team), 'external' (completed by another company)
  
  ## Changes to `user_settings` Table
  1. New Fields:
     - `selected_report_type` (text) - User's selected report type filter ('none', 'spcc_plan', 'spcc_inspection')
     - Default: 'none'
  
  ## Indexes
  - Index on `spcc_completion_type` for efficient filtering
  
  ## Notes
  - Maintains backward compatibility by keeping spcc_completed_date
  - selected_report_type persists across sessions
*/

-- Add completion type field to facilities table
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS spcc_completion_type text CHECK (spcc_completion_type IN ('internal', 'external'));

-- Add index for filtering by completion type
CREATE INDEX IF NOT EXISTS idx_facilities_spcc_completion_type
  ON facilities(spcc_completion_type)
  WHERE spcc_completion_type IS NOT NULL;

-- Add comment documenting the field
COMMENT ON COLUMN facilities.spcc_completion_type IS 'Tracks whether SPCC was completed internally or externally. NULL = not completed, internal = completed by your team, external = completed by another company';

-- Add report type filter preference to user_settings
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS selected_report_type text DEFAULT 'none' CHECK (selected_report_type IN ('none', 'spcc_plan', 'spcc_inspection'));

-- Add comment documenting the field
COMMENT ON COLUMN user_settings.selected_report_type IS 'User preference for report type filter in facilities view. Options: none, spcc_plan, spcc_inspection';
