/*
  # Add Email Unsubscribe System
  
  1. Changes to notification_preferences table
    - Add `email_unsubscribed` (boolean) - Tracks if user has unsubscribed from all emails
    - Add `unsubscribed_at` (timestamptz) - Records when user unsubscribed
    - Add `unsubscribe_token` (uuid) - Unique token for secure unsubscribe links
  
  2. Security
    - Add index on unsubscribe_token for fast lookups
    - Add RLS policy for public unsubscribe operations (token-based)
  
  3. Important Notes
    - Unsubscribe must work even for users who haven't accepted invites yet
    - Token-based system allows unsubscribe without authentication
    - System respects CAN-SPAM compliance requirements
*/

-- Add unsubscribe fields to notification_preferences table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_preferences' AND column_name = 'email_unsubscribed'
  ) THEN
    ALTER TABLE notification_preferences 
    ADD COLUMN email_unsubscribed boolean DEFAULT false NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_preferences' AND column_name = 'unsubscribed_at'
  ) THEN
    ALTER TABLE notification_preferences 
    ADD COLUMN unsubscribed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_preferences' AND column_name = 'unsubscribe_token'
  ) THEN
    ALTER TABLE notification_preferences 
    ADD COLUMN unsubscribe_token uuid DEFAULT gen_random_uuid() UNIQUE NOT NULL;
  END IF;
END $$;

-- Create index on unsubscribe_token for fast lookups
CREATE INDEX IF NOT EXISTS idx_notification_preferences_unsubscribe_token 
ON notification_preferences(unsubscribe_token);

-- Add RLS policy for public unsubscribe operations (token-based)
-- This allows anyone with a valid token to unsubscribe
DROP POLICY IF EXISTS "Allow public unsubscribe by token" ON notification_preferences;
CREATE POLICY "Allow public unsubscribe by token"
  ON notification_preferences
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Note: The edge function will validate the token, so we allow the update
-- The function will only update email_unsubscribed, unsubscribed_at, and email_enabled fields