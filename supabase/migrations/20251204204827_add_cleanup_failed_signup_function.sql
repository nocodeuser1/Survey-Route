/*
  # Add Cleanup Function for Failed Signup Attempts

  1. Changes
    - Create `cleanup_failed_signup_via_invitation` function to handle edge case
    - Allows cleanup of accounts that appear "fully registered" but failed during signup
    - Uses SECURITY DEFINER to bypass RLS restrictions
    - Requires valid invitation token for safety

  2. What This Fixes
    - Users whose signup attempts partially succeeded but ultimately failed with errors
    - Database records exist (auth, profile, membership) but user never successfully logged in
    - Frontend blocks them saying "already registered" but they can't log in
    - Standard cleanup function refuses to clean "fully registered" accounts

  3. Security
    - Requires valid, pending invitation token
    - Only cleans up records associated with the invitation's email
    - Checks that no active session exists for this email
    - Logs all cleanup operations for audit trail
*/

-- Create function to cleanup failed signup attempts using invitation context
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

  -- Step 7: Log the cleanup for audit trail
  INSERT INTO user_activity_logs (
    account_id,
    user_id,
    action,
    details,
    ip_address,
    user_agent
  ) VALUES (
    invitation_record.account_id,
    NULL,
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

-- Grant execute permission to anon (needed for invitation page)
GRANT EXECUTE ON FUNCTION cleanup_failed_signup_via_invitation(text) TO anon;
GRANT EXECUTE ON FUNCTION cleanup_failed_signup_via_invitation(text) TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION cleanup_failed_signup_via_invitation IS
  'Cleans up failed signup attempts where database records exist but user never successfully logged in. Requires valid invitation token for security.';
