/*
  # Extend Facilities Table with Inspection Tracking

  ## Overview
  Adds inspection tracking fields to the facilities table for quick lookup
  and filtering of inspection status without complex joins.

  ## Changes to `facilities` Table

  ### New Columns
  - `inspection_frequency_days` (integer) - Days between inspections (default 365 for annual)
  - `last_inspection_date` (date, nullable) - Date of most recent completed inspection
  - `next_inspection_due` (date, nullable) - Calculated next inspection due date
  - `inspection_due_notification_sent_at` (timestamptz, nullable) - Last notification timestamp

  ## Indexes
  - Index on next_inspection_due for filtering facilities by due date
  - Index on (account_id, next_inspection_due) for account-specific queries
  - Index on last_inspection_date for tracking recent inspections

  ## Notes
  - inspection_frequency_days defaults to 365 (annual inspection)
  - next_inspection_due = last_inspection_date + inspection_frequency_days
  - These fields are automatically updated when inspections are completed
  - Denormalized for performance (avoids complex joins)
*/

-- Add inspection tracking columns to facilities table
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS inspection_frequency_days integer DEFAULT 365 CHECK (inspection_frequency_days > 0),
ADD COLUMN IF NOT EXISTS last_inspection_date date,
ADD COLUMN IF NOT EXISTS next_inspection_due date,
ADD COLUMN IF NOT EXISTS inspection_due_notification_sent_at timestamptz;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_facilities_next_inspection_due
  ON facilities(next_inspection_due)
  WHERE next_inspection_due IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facilities_account_next_inspection
  ON facilities(account_id, next_inspection_due)
  WHERE next_inspection_due IS NOT NULL AND account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facilities_last_inspection_date
  ON facilities(last_inspection_date)
  WHERE last_inspection_date IS NOT NULL;

-- Create function to update facility inspection dates
CREATE OR REPLACE FUNCTION update_facility_inspection_dates()
RETURNS TRIGGER AS $$
BEGIN
  -- Update facilities table when inspection is completed
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE facilities
    SET
      last_inspection_date = NEW.conducted_at::date,
      next_inspection_due = (NEW.conducted_at::date + (inspection_frequency_days || ' days')::interval)::date,
      inspection_due_notification_sent_at = NULL
    WHERE id = NEW.facility_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update facility inspection dates when inspection is completed
DROP TRIGGER IF EXISTS update_facility_inspection_on_completion ON inspections;
CREATE TRIGGER update_facility_inspection_on_completion
  AFTER INSERT OR UPDATE ON inspections
  FOR EACH ROW
  EXECUTE FUNCTION update_facility_inspection_dates();

-- Add helpful comments
COMMENT ON COLUMN facilities.inspection_frequency_days IS 'Days between inspections (default 365 for annual)';
COMMENT ON COLUMN facilities.last_inspection_date IS 'Date of most recent completed inspection - auto-updated from inspections table';
COMMENT ON COLUMN facilities.next_inspection_due IS 'Calculated as last_inspection_date + inspection_frequency_days';
COMMENT ON COLUMN facilities.inspection_due_notification_sent_at IS 'Timestamp of last notification sent for upcoming inspection';
