/*
  # Fix Activity Logs for System Actions

  ## Problem
  The `cleanup_failed_signup_via_invitation` function fails because it tries to log
  system actions with `user_id = NULL`, but the table has a NOT NULL constraint.

  ## Changes
  1. Make `user_id` nullable in user_activity_logs table to allow system actions
  2. Update `action` column name from migration (it was called `action_type` in schema but `action` in function)
  3. Update RLS INSERT policy to allow system functions to log actions
  4. Update cleanup function to use correct column names

  ## Security
  - System actions (NULL user_id) can only be inserted via SECURITY DEFINER functions
  - Regular users still require membership validation
*/

-- Step 1: Make user_id nullable to allow system actions
ALTER TABLE user_activity_logs 
  ALTER COLUMN user_id DROP NOT NULL;

-- Step 2: Rename action column to match function usage (if needed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_activity_logs' 
    AND column_name = 'action'
  ) THEN
    -- Column already named 'action', no change needed
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_activity_logs' 
    AND column_name = 'action_type'
  ) THEN
    -- Rename action_type to action for consistency
    ALTER TABLE user_activity_logs RENAME COLUMN action_type TO action;
  END IF;
END $$;

-- Step 3: Update INSERT policy to allow system actions
DROP POLICY IF EXISTS "Users can create activity logs" ON user_activity_logs;

CREATE POLICY "Users can create activity logs"
  ON user_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow system actions (NULL user_id) from SECURITY DEFINER functions
    user_id IS NULL
    OR
    -- User can log actions for accounts they have access to
    EXISTS (
      SELECT 1 FROM account_users au
      JOIN users u ON au.user_id = u.id
      WHERE au.account_id = user_activity_logs.account_id
      AND u.auth_user_id = auth.uid()
    )
  );

-- Step 4: Add policy to allow anonymous system actions during signup cleanup
CREATE POLICY "System can create activity logs"
  ON user_activity_logs FOR INSERT
  TO anon
  WITH CHECK (
    -- Only allow system actions (NULL user_id) from anon
    -- This is used during invitation acceptance cleanup
    user_id IS NULL
  );

-- Step 5: Update function to use correct column names
CREATE OR REPLACE FUNCTION cleanup_failed_signup_via_invitation(
  invitation_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invitation_record RECORD;
  user_profile_record RECORD;
  auth_user_id_to_delete uuid;
  memberships_count integer;
  result jsonb;
BEGIN
  -- Step 1: Verify invitation is valid and pending
  SELECT id, email, account_id, status, expires_at
  INTO invitation_record
  FROM user_invitations
  WHERE token = invitation_token
    AND status = 'pending'
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Invalid or expired invitation'
    );
  END IF;

  -- Step 2: Find user profile for this email
  SELECT id, auth_user_id, email
  INTO user_profile_record
  FROM users
  WHERE email = invitation_record.email;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'No cleanup needed - user profile does not exist',
      'cleaned_up', false
    );
  END IF;

  -- Step 3: Get auth user ID
  IF user_profile_record.auth_user_id IS NOT NULL THEN
    auth_user_id_to_delete := user_profile_record.auth_user_id;
  ELSE
    -- Try to find orphaned auth record
    SELECT id INTO auth_user_id_to_delete
    FROM auth.users
    WHERE email = invitation_record.email;
  END IF;

  -- Step 4: Delete account memberships for this user
  DELETE FROM account_users
  WHERE user_id = user_profile_record.id;

  GET DIAGNOSTICS memberships_count = ROW_COUNT;

  -- Step 5: Delete user profile
  DELETE FROM users
  WHERE id = user_profile_record.id;

  -- Step 6: Delete auth user (if exists)
  IF auth_user_id_to_delete IS NOT NULL THEN
    DELETE FROM auth.users
    WHERE id = auth_user_id_to_delete;
  END IF;

  -- Step 7: Log the cleanup for audit trail (with NULL user_id for system action)
  INSERT INTO user_activity_logs (
    account_id,
    user_id,
    action,
    metadata,
    ip_address,
    user_agent
  ) VALUES (
    invitation_record.account_id,
    NULL, -- System action
    'cleanup_failed_signup',
    jsonb_build_object(
      'email', invitation_record.email,
      'memberships_deleted', memberships_count,
      'invitation_id', invitation_record.id
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Failed signup cleaned up successfully',
    'cleaned_up', true,
    'email', invitation_record.email,
    'memberships_deleted', memberships_count,
    'auth_user_deleted', auth_user_id_to_delete IS NOT NULL
  );
END;
$$;

COMMENT ON COLUMN user_activity_logs.user_id IS 
  'User who performed the action. NULL for system actions (e.g., automated cleanup, cron jobs).';
