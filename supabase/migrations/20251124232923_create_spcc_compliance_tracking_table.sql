/*
  # Create SPCC Compliance Tracking System

  ## Overview
  Creates a comprehensive SPCC compliance tracking system that manages:
  - Initial SPCC plan requirements (due 6 months after Initial Production Date)
  - 5-year renewal cycles for SPCC plans
  - Compliance status calculation and monitoring
  - Automatic due date calculations

  ## New Tables

  ### `spcc_compliance_tracking`
  Dedicated table for SPCC plan compliance with automatic calculation.

  **Columns:**
  - `id` (uuid, primary key) - Unique identifier
  - `facility_id` (uuid, foreign key) - References facilities table
  - `account_id` (uuid, foreign key) - References accounts table
  - `initial_production_date` (date) - IP Date from facilities.first_prod_date
  - `initial_spcc_due_date` (date) - IP Date + 6 months
  - `initial_spcc_completed_date` (date, nullable) - When initial plan was completed
  - `renewal_cycle_number` (integer) - Current renewal cycle (0 = initial, 1+ = renewals)
  - `current_renewal_due_date` (date, nullable) - Current cycle due date
  - `current_renewal_completed_date` (date, nullable) - Current cycle completion date
  - `is_compliant` (boolean) - Overall compliance status
  - `compliance_status` (text) - Status: not_started, initial_due, initial_complete, renewal_due, renewal_complete, overdue
  - `days_until_due` (integer, nullable) - Days until next due date (negative if overdue)
  - `notification_sent_at` (timestamptz, nullable) - Last notification timestamp
  - `notes` (text, nullable) - Additional notes or context
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Compliance Logic

  ### Initial SPCC Plan (Cycle 0)
  - Due: Initial Production Date + 6 months
  - Status: initial_due until completed
  - After completion: Move to renewal cycle

  ### Renewal Cycles (Cycle 1+)
  - Due: Previous completion date + 5 years
  - Status: renewal_due until completed
  - After completion: Increment cycle, calculate next due date

  ### Compliance Status States
  - `not_started`: No IP date or initial plan not started
  - `initial_due`: Initial plan pending (within 6 months of IP date)
  - `initial_complete`: Initial plan completed, no renewal due yet
  - `renewal_due`: Renewal plan pending (within 5 years since last completion)
  - `renewal_complete`: Renewal completed, next renewal not due yet
  - `overdue`: Past due date without completion

  ## Security
  - Enable RLS on spcc_compliance_tracking table
  - Users can view compliance for facilities in their account
  - Account admins can manage all compliance records

  ## Indexes
  - Index on facility_id (one-to-one relationship)
  - Index on (account_id, compliance_status) for filtering
  - Index on days_until_due for due date queries
  - Index on initial_production_date for date range queries

  ## Notes
  - One record per facility
  - Automatically calculates all dates and statuses
  - Updated via trigger when facility dates change
  - Provides complete audit trail of SPCC compliance history
*/

-- Create spcc_compliance_tracking table
CREATE TABLE IF NOT EXISTS spcc_compliance_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE UNIQUE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  initial_production_date date,
  initial_spcc_due_date date,
  initial_spcc_completed_date date,
  renewal_cycle_number integer DEFAULT 0,
  current_renewal_due_date date,
  current_renewal_completed_date date,
  is_compliant boolean DEFAULT false,
  compliance_status text DEFAULT 'not_started' CHECK (compliance_status IN (
    'not_started',
    'initial_due',
    'initial_complete',
    'renewal_due',
    'renewal_complete',
    'overdue'
  )),
  days_until_due integer,
  notification_sent_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_spcc_compliance_facility
  ON spcc_compliance_tracking(facility_id);

CREATE INDEX IF NOT EXISTS idx_spcc_compliance_account_status
  ON spcc_compliance_tracking(account_id, compliance_status);

CREATE INDEX IF NOT EXISTS idx_spcc_compliance_days_until_due
  ON spcc_compliance_tracking(days_until_due)
  WHERE days_until_due IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spcc_compliance_ip_date
  ON spcc_compliance_tracking(initial_production_date)
  WHERE initial_production_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spcc_compliance_not_compliant
  ON spcc_compliance_tracking(account_id, is_compliant)
  WHERE is_compliant = false;

-- Enable RLS
ALTER TABLE spcc_compliance_tracking ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view compliance for facilities in their account
CREATE POLICY "Users can view spcc compliance tracking"
  ON spcc_compliance_tracking
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT au.account_id
      FROM account_users au
      WHERE au.user_id = auth.uid()
    )
  );

-- Policy: Account admins can insert compliance records
CREATE POLICY "Account admins can create spcc compliance tracking"
  ON spcc_compliance_tracking
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

-- Policy: Account admins can update compliance records
CREATE POLICY "Account admins can update spcc compliance tracking"
  ON spcc_compliance_tracking
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

-- Policy: Account admins can delete compliance records
CREATE POLICY "Account admins can delete spcc compliance tracking"
  ON spcc_compliance_tracking
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

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_spcc_compliance_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER spcc_compliance_tracking_updated_at
  BEFORE UPDATE ON spcc_compliance_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_spcc_compliance_tracking_updated_at();

-- Add helpful comments
COMMENT ON TABLE spcc_compliance_tracking IS 'Tracks SPCC plan compliance with automatic due date calculation for initial (6 months) and renewal (5 years) cycles';
COMMENT ON COLUMN spcc_compliance_tracking.initial_production_date IS 'Initial Production Date from facility - triggers SPCC requirements';
COMMENT ON COLUMN spcc_compliance_tracking.initial_spcc_due_date IS 'Calculated as IP Date + 6 months';
COMMENT ON COLUMN spcc_compliance_tracking.renewal_cycle_number IS 'Current renewal cycle: 0 = initial plan, 1+ = renewal number';
COMMENT ON COLUMN spcc_compliance_tracking.current_renewal_due_date IS 'Current cycle due date (initial: IP + 6mo, renewal: last completion + 5yr)';
COMMENT ON COLUMN spcc_compliance_tracking.compliance_status IS 'Status: not_started, initial_due, initial_complete, renewal_due, renewal_complete, overdue';
COMMENT ON COLUMN spcc_compliance_tracking.days_until_due IS 'Days until next due date (negative if overdue)';
