/*
  # Create Notification History System

  ## Overview
  Creates a historical record system for all notifications sent to users.
  Supports in-app notification display, audit trails, and compliance documentation.

  ## New Tables

  ### `notification_history`
  Historical record of all delivered notifications with read/dismiss tracking.

  **Columns:**
  - `id` (uuid, primary key) - Unique identifier
  - `account_id` (uuid, foreign key) - References accounts table
  - `user_id` (uuid, foreign key) - References auth.users
  - `facility_id` (uuid, foreign key, nullable) - References facilities table
  - `notification_type` (text) - Type: spcc_initial_due, spcc_renewal_due, spcc_overdue, inspection_due, inspection_overdue
  - `subject` (text) - Notification subject/title
  - `message` (text) - Notification message body
  - `sent_at` (timestamptz) - When notification was delivered
  - `read_at` (timestamptz, nullable) - When user viewed the notification
  - `dismissed_at` (timestamptz, nullable) - When user dismissed the notification
  - `metadata` (jsonb) - Additional context data
  - `created_at` (timestamptz) - Record creation timestamp

  ## Security
  - Enable RLS on notification_history table
  - Users can view their own notification history
  - Users can update read_at and dismissed_at on their notifications
  - Account admins can view all notifications for their account

  ## Indexes
  - Index on (user_id, sent_at DESC) for user timeline
  - Index on (account_id, sent_at DESC) for account reports
  - Index on facility_id for facility-related queries
  - Index on read_at for unread filtering
  - Index on notification_type for filtering

  ## Notes
  - In-app notification bell pulls from this table
  - Unread count = WHERE read_at IS NULL
  - Old records can be archived after 90 days for performance
*/

-- Create notification_history table
CREATE TABLE IF NOT EXISTS notification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  notification_type text NOT NULL CHECK (notification_type IN (
    'spcc_initial_due',
    'spcc_renewal_due',
    'spcc_overdue',
    'inspection_due',
    'inspection_overdue',
    'daily_digest'
  )),
  subject text NOT NULL,
  message text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_history_user_sent
  ON notification_history(user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_history_account_sent
  ON notification_history(account_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_history_facility
  ON notification_history(facility_id)
  WHERE facility_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_unread
  ON notification_history(user_id, read_at)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_type
  ON notification_history(notification_type);

-- Enable RLS
ALTER TABLE notification_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own notification history
CREATE POLICY "Users can view own notification history"
  ON notification_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can update read/dismiss status on their notifications
CREATE POLICY "Users can update own notification status"
  ON notification_history
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (read_at IS DISTINCT FROM (SELECT read_at FROM notification_history WHERE id = notification_history.id)
         OR dismissed_at IS DISTINCT FROM (SELECT dismissed_at FROM notification_history WHERE id = notification_history.id))
  );

-- Policy: Account admins can view all notifications for their account
CREATE POLICY "Account admins can view account notification history"
  ON notification_history
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

-- Policy: System can insert notifications (via service role)
-- Service role bypasses RLS, so no additional policy needed

-- Create function to get unread notification count
CREATE OR REPLACE FUNCTION get_unread_notification_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::integer
  FROM notification_history
  WHERE user_id = p_user_id
  AND read_at IS NULL
  AND dismissed_at IS NULL;
$$;

-- Add helpful comments
COMMENT ON TABLE notification_history IS 'Historical record of all delivered notifications for in-app display and audit trail';
COMMENT ON COLUMN notification_history.sent_at IS 'When the notification was delivered to the user';
COMMENT ON COLUMN notification_history.read_at IS 'When the user viewed the notification in-app';
COMMENT ON COLUMN notification_history.dismissed_at IS 'When the user dismissed/archived the notification';
COMMENT ON COLUMN notification_history.metadata IS 'Additional context data (facility name, due date, etc.)';
