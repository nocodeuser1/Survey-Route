/*
  # Create Notification Queue System

  ## Overview
  Creates a queue system for managing outbound notifications with delivery tracking,
  retry logic, and failure handling for SPCC and inspection reminders.

  ## New Tables

  ### `notification_queue`
  Queues notifications to be sent with status tracking.

  **Columns:**
  - `id` (uuid, primary key) - Unique identifier
  - `account_id` (uuid, foreign key) - References accounts table
  - `user_id` (uuid, foreign key) - References auth.users
  - `facility_id` (uuid, foreign key, nullable) - References facilities table
  - `notification_type` (text) - Type: spcc_initial_due, spcc_renewal_due, spcc_overdue, inspection_due, inspection_overdue
  - `subject` (text) - Email subject line
  - `message` (text) - Notification message body
  - `scheduled_for` (timestamptz) - When to send the notification
  - `sent_at` (timestamptz, nullable) - When notification was actually sent
  - `status` (text) - Status: pending, sent, failed
  - `error_message` (text, nullable) - Error details if failed
  - `retry_count` (integer) - Number of retry attempts
  - `metadata` (jsonb) - Additional data (facility name, due date, days until due, etc.)
  - `created_at` (timestamptz) - Queue entry creation timestamp

  ## Security
  - Enable RLS on notification_queue table
  - Only system and account admins can access queue
  - Service role bypasses RLS for background job processing

  ## Indexes
  - Index on (status, scheduled_for) for efficient queue processing
  - Index on (account_id, user_id) for user-specific queries
  - Index on facility_id for facility-related lookups
  - Index on notification_type for filtering

  ## Notes
  - Background job processes pending notifications at scheduled_for time
  - Failed notifications can be retried up to 3 times
  - Sent notifications are moved to notification_history after delivery
*/

-- Create notification_queue table
CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
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
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  retry_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_queue_status_scheduled
  ON notification_queue(status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notification_queue_account_user
  ON notification_queue(account_id, user_id);

CREATE INDEX IF NOT EXISTS idx_notification_queue_facility
  ON notification_queue(facility_id)
  WHERE facility_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_queue_type
  ON notification_queue(notification_type);

CREATE INDEX IF NOT EXISTS idx_notification_queue_created_at
  ON notification_queue(created_at DESC);

-- Enable RLS
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- Policy: Account admins can view queue for their account
CREATE POLICY "Account admins can view notification queue"
  ON notification_queue
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

-- Policy: System can manage queue (service role bypasses RLS)
-- No additional policies needed as service role has full access

-- Add helpful comments
COMMENT ON TABLE notification_queue IS 'Queue for outbound notifications with delivery tracking';
COMMENT ON COLUMN notification_queue.notification_type IS 'Type of notification: spcc_initial_due, spcc_renewal_due, spcc_overdue, inspection_due, inspection_overdue, daily_digest';
COMMENT ON COLUMN notification_queue.status IS 'Delivery status: pending (not sent yet), sent (delivered), failed (delivery error)';
COMMENT ON COLUMN notification_queue.metadata IS 'Additional context data (facility name, due date, days until due, etc.)';
COMMENT ON COLUMN notification_queue.retry_count IS 'Number of delivery attempts made';
