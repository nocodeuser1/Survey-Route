/*
  # Create Facility Inspection Schedules System

  ## Overview
  Creates a system to track inspection schedules and frequencies for facilities.
  Supports multiple inspection types per facility with customizable intervals and
  automatic due date calculation.

  ## New Tables

  ### `facility_inspection_schedules`
  Tracks inspection schedules and frequencies per facility.

  **Columns:**
  - `id` (uuid, primary key) - Unique identifier
  - `facility_id` (uuid, foreign key) - References facilities table
  - `account_id` (uuid, foreign key) - References accounts table
  - `inspection_type` (text) - Type of inspection (spcc, safety, environmental, general, custom)
  - `frequency_days` (integer) - Days between inspections (e.g., 365 for annual)
  - `last_inspection_date` (date, nullable) - Date of most recent completed inspection
  - `next_due_date` (date, nullable) - Calculated next inspection due date
  - `is_overdue` (boolean) - Whether inspection is past due
  - `reminder_sent_at` (timestamptz, nullable) - When last reminder was sent
  - `is_active` (boolean) - Whether this schedule is currently active
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on facility_inspection_schedules table
  - Users can view schedules for facilities in their account
  - Account admins can manage all schedules

  ## Indexes
  - Index on facility_id for facility queries
  - Index on (account_id, next_due_date) for due date filtering
  - Index on is_overdue for overdue filtering
  - Index on inspection_type for filtering

  ## Notes
  - next_due_date = last_inspection_date + frequency_days
  - is_overdue = next_due_date < CURRENT_DATE
  - Multiple schedules can exist per facility (different inspection types)
  - Automatically updated when inspection is completed
*/

-- Create facility_inspection_schedules table
CREATE TABLE IF NOT EXISTS facility_inspection_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  inspection_type text NOT NULL CHECK (inspection_type IN (
    'spcc',
    'safety',
    'environmental',
    'general',
    'custom'
  )),
  frequency_days integer NOT NULL DEFAULT 365 CHECK (frequency_days > 0),
  last_inspection_date date,
  next_due_date date,
  is_overdue boolean DEFAULT false,
  reminder_sent_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(facility_id, inspection_type)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_facility_inspection_schedules_facility
  ON facility_inspection_schedules(facility_id);

CREATE INDEX IF NOT EXISTS idx_facility_inspection_schedules_account_due
  ON facility_inspection_schedules(account_id, next_due_date)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_facility_inspection_schedules_overdue
  ON facility_inspection_schedules(is_overdue, next_due_date)
  WHERE is_active = true AND is_overdue = true;

CREATE INDEX IF NOT EXISTS idx_facility_inspection_schedules_type
  ON facility_inspection_schedules(inspection_type);

-- Enable RLS
ALTER TABLE facility_inspection_schedules ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view schedules for facilities in their account
CREATE POLICY "Users can view facility inspection schedules"
  ON facility_inspection_schedules
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT au.account_id
      FROM account_users au
      WHERE au.user_id = auth.uid()
    )
  );

-- Policy: Account admins can insert schedules
CREATE POLICY "Account admins can create facility inspection schedules"
  ON facility_inspection_schedules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
      AND role = 'account_admin'
    )
  );

-- Policy: Account admins can update schedules
CREATE POLICY "Account admins can update facility inspection schedules"
  ON facility_inspection_schedules
  FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
      AND role = 'account_admin'
    )
  );

-- Policy: Account admins can delete schedules
CREATE POLICY "Account admins can delete facility inspection schedules"
  ON facility_inspection_schedules
  FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
      AND role = 'account_admin'
    )
  );

-- Create function to update inspection schedule
CREATE OR REPLACE FUNCTION update_inspection_schedule(
  p_facility_id uuid,
  p_inspection_type text,
  p_inspection_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_schedule_record RECORD;
BEGIN
  -- Get the schedule record
  SELECT * INTO v_schedule_record
  FROM facility_inspection_schedules
  WHERE facility_id = p_facility_id
  AND inspection_type = p_inspection_type;
  
  IF FOUND THEN
    -- Update existing schedule
    UPDATE facility_inspection_schedules
    SET
      last_inspection_date = p_inspection_date,
      next_due_date = p_inspection_date + (frequency_days || ' days')::interval,
      is_overdue = false,
      reminder_sent_at = NULL,
      updated_at = now()
    WHERE facility_id = p_facility_id
    AND inspection_type = p_inspection_type;
  END IF;
END;
$$;

-- Create function to update overdue status
CREATE OR REPLACE FUNCTION update_overdue_inspection_schedules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE facility_inspection_schedules
  SET is_overdue = (next_due_date < CURRENT_DATE)
  WHERE is_active = true
  AND next_due_date IS NOT NULL;
END;
$$;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_facility_inspection_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER facility_inspection_schedules_updated_at
  BEFORE UPDATE ON facility_inspection_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_facility_inspection_schedules_updated_at();

-- Add helpful comments
COMMENT ON TABLE facility_inspection_schedules IS 'Tracks inspection schedules and frequencies for facilities with multiple inspection types';
COMMENT ON COLUMN facility_inspection_schedules.inspection_type IS 'Type of inspection: spcc, safety, environmental, general, or custom';
COMMENT ON COLUMN facility_inspection_schedules.frequency_days IS 'Days between inspections (e.g., 365 for annual, 180 for semi-annual)';
COMMENT ON COLUMN facility_inspection_schedules.next_due_date IS 'Calculated as last_inspection_date + frequency_days';
COMMENT ON COLUMN facility_inspection_schedules.is_overdue IS 'True when next_due_date < CURRENT_DATE';
