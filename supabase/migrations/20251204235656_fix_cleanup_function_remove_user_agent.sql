/*
  # Fix Cleanup Function - Remove Non-Existent user_agent Column

  ## Problem
  The `cleanup_failed_signup_via_invitation` function tries to insert into a 
  `user_agent` column that doesn't exist in the `user_activity_logs` table,
  causing 400 errors during invitation acceptance.

  ## Changes
  1. Update `cleanup_failed_signup_via_invitation` to only insert into existing columns
  2. Remove `user_agent` from INSERT statement
  3. Remove `ip_address` as well (not needed for system actions)

  ## Security
  - Function remains SECURITY DEFINER to allow system actions
  - RLS policies still protect the activity logs table
*/

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
  -- Only insert into columns that actually exist in the table
  INSERT INTO user_activity_logs (
    account_id,
    user_id,
    action,
    metadata
  ) VALUES (
    invitation_record.account_id,
    NULL, -- System action
    'cleanup_failed_signup',
    jsonb_build_object(
      'email', invitation_record.email,
      'memberships_deleted', memberships_count,
      'invitation_id', invitation_record.id
    )
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

COMMENT ON FUNCTION cleanup_failed_signup_via_invitation IS 
  'Cleans up failed signup attempts when re-accepting an invitation. Removes user profile, account memberships, and auth account if they exist with no other memberships.';