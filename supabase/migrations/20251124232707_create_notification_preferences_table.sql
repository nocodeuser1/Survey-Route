/*
  # Create Notification Preferences System

  ## Overview
  Creates a comprehensive notification preferences system for SPCC compliance and inspection reminders.
  Users can configure when and how they receive notifications for upcoming due dates.

  ## New Tables

  ### `notification_preferences`
  Stores user-level notification settings per account.

  **Columns:**
  - `id` (uuid, primary key) - Unique identifier
  - `user_id` (uuid, foreign key) - References auth.users
  - `account_id` (uuid, foreign key) - References accounts table
  - `receive_spcc_reminders` (boolean) - Enable SPCC compliance notifications
  - `receive_inspection_reminders` (boolean) - Enable inspection due date notifications
  - `reminder_days_before` (integer array) - Days before due date to send reminders (e.g., [30, 14, 7, 1])
  - `email_enabled` (boolean) - Send email notifications
  - `in_app_enabled` (boolean) - Show in-app notifications
  - `daily_digest_enabled` (boolean) - Send daily summary email
  - `daily_digest_time` (time) - Time to send daily digest (e.g., 08:00)
  - `notify_for_team_only` (boolean) - Only notify for facilities assigned to user's team
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on notification_preferences table
  - Users can read/update their own preferences
  - Account admins can view all preferences for their account

  ## Indexes
  - Index on (user_id, account_id) for fast lookup
  - Index on account_id for admin queries

  ## Notes
  - Default settings: 30, 14, 7, 1 days before reminders
  - Each user can have different preferences per account
  - Preferences automatically created on first account access
*/

-- Create notification_preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  receive_spcc_reminders boolean DEFAULT true,
  receive_inspection_reminders boolean DEFAULT true,
  reminder_days_before integer[] DEFAULT ARRAY[30, 14, 7, 1],
  email_enabled boolean DEFAULT true,
  in_app_enabled boolean DEFAULT true,
  daily_digest_enabled boolean DEFAULT false,
  daily_digest_time time DEFAULT '08:00:00',
  notify_for_team_only boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, account_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_account
  ON notification_preferences(user_id, account_id);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_account
  ON notification_preferences(account_id);

-- Enable RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own preferences
CREATE POLICY "Users can view own notification preferences"
  ON notification_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own preferences
CREATE POLICY "Users can create own notification preferences"
  ON notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own preferences
CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Account admins can view all preferences in their account
CREATE POLICY "Account admins can view account notification preferences"
  ON notification_preferences
  FOR SELECT
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
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_preferences_updated_at();

-- Add helpful comments
COMMENT ON TABLE notification_preferences IS 'User notification preferences for compliance and inspection reminders';
COMMENT ON COLUMN notification_preferences.reminder_days_before IS 'Array of days before due date to send reminders (e.g., [30, 14, 7, 1])';
COMMENT ON COLUMN notification_preferences.notify_for_team_only IS 'If true, only receive notifications for facilities assigned to user team';