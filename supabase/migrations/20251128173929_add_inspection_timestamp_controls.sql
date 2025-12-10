/*
  # Add Inspection Timestamp Display Controls

  1. Changes to `inspections` table
    - Add `manual_timestamp` (timestamptz, nullable) - Stores manually overridden timestamp
    - Preserves original `conducted_at` for audit trail and restoration

  2. Changes to `user_settings` table
    - Add `hide_report_timestamps` (boolean, default false) - Controls timestamp visibility
    - When true: shows only date on reports (hides time)
    - When false: shows full date and time

  3. Important Notes
    - Manual timestamps allow authorized users to override display timestamp
    - Original timestamps always preserved for data integrity
    - Setting applies site-wide to all report previews and exports
    - No RLS changes needed - uses existing inspection and user_settings policies
*/

-- Add manual_timestamp to inspections table
ALTER TABLE inspections
ADD COLUMN IF NOT EXISTS manual_timestamp timestamptz;

-- Add hide_report_timestamps to user_settings table
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS hide_report_timestamps boolean DEFAULT false;

-- Add index for performance when querying inspections with manual timestamps
CREATE INDEX IF NOT EXISTS idx_inspections_manual_timestamp
ON inspections(manual_timestamp)
WHERE manual_timestamp IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN inspections.manual_timestamp IS 'Optional manually overridden timestamp for display. When set, displays instead of conducted_at. Original conducted_at preserved for audit trail.';
COMMENT ON COLUMN user_settings.hide_report_timestamps IS 'When true, reports show only date (no time). When false, reports show full date and time.';
