/*
  # Add Notification Settings and Sold Facilities Support

  1. New Tables
    - `company_notification_settings`
      - `account_id` (uuid, primary key, references accounts)
      - `spcc_plan_creation_reminders` (int[]): Days before due
      - `spcc_plan_renewal_reminders` (int[]): Days before due
      - `spcc_annual_inspection_reminders` (int[]): Days before due
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Changes to Facilities
    - Add `status` column (text, default 'active')
    - Add `sold_at` column (date, nullable)
    - Add check constraint on status

  3. Security
    - Enable RLS on new table
    - Add policies for account admins to manage settings
    - Add policies for users to view settings
*/

-- Create company_notification_settings table
CREATE TABLE IF NOT EXISTS company_notification_settings (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  spcc_plan_creation_reminders integer[] DEFAULT ARRAY[90, 60, 30, 15, 1],
  spcc_plan_renewal_reminders integer[] DEFAULT ARRAY[90, 60, 30, 15, 1],
  spcc_annual_inspection_reminders integer[] DEFAULT ARRAY[30, 14, 7, 1],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE company_notification_settings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view company notification settings"
  ON company_notification_settings
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Account admins can update company notification settings"
  ON company_notification_settings
  FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
      AND role = 'account_admin'
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id
      FROM account_users
      WHERE user_id = auth.uid()
      AND role = 'account_admin'
    )
  );

CREATE POLICY "Account admins can insert company notification settings"
  ON company_notification_settings
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

-- Add trigger for updated_at (reusing existing function if available, otherwise creating generic one)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_company_notification_settings_updated_at') THEN
    CREATE FUNCTION update_company_notification_settings_updated_at()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TRIGGER company_notification_settings_updated_at
  BEFORE UPDATE ON company_notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_company_notification_settings_updated_at();

-- Modify facilities table
ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'sold')),
ADD COLUMN IF NOT EXISTS sold_at date;

-- Add index for status
CREATE INDEX IF NOT EXISTS idx_facilities_status ON facilities(status);
