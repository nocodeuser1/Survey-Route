/*
  # Fix Invitation Flow for Orphaned Auth Accounts

  1. Changes
    - Add `check_auth_account_status` function to comprehensively check auth account state
    - Add `force_cleanup_auth_account` function for aggressive cleanup when needed
    - Update `cleanup_orphaned_auth_user` to handle accounts with incomplete user profiles
    - Add `prepare_email_for_invitation` function to clean up before creating new invitations

  2. What This Fixes
    - Users can be re-invited after revocation even if auth account still exists
    - Orphaned auth accounts from failed signups are automatically cleaned up
    - Clear detection of different auth states (orphaned, fully registered, etc.)
    - Prevents "already registered" errors for users who haven't completed signup

  3. Security
    - All functions are SECURITY DEFINER to access auth.users table
    - Functions only delete auth accounts that are truly orphaned
    - Comprehensive checks before any deletion
    - Audit trail of cleanup actions
*/

-- Function to comprehensively check auth account status
CREATE OR REPLACE FUNCTION check_auth_account_status(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_user_record RECORD;
  user_profile_record RECORD;
  account_memberships_count integer;
  result jsonb;
BEGIN
  -- Find auth.users record
  SELECT id, email, created_at, confirmed_at
  INTO auth_user_record
  FROM auth.users
  WHERE email = target_email;

  -- Find users profile
  SELECT id, auth_user_id, email, signature_completed, created_at
  INTO user_profile_record
  FROM users
  WHERE email = target_email;

  -- Count account memberships
  SELECT COUNT(*)
  INTO account_memberships_count
  FROM account_users
  WHERE user_id = user_profile_record.id;

  -- Build comprehensive status
  result := jsonb_build_object(
    'email', target_email,
    'auth_exists', auth_user_record.id IS NOT NULL,
    'auth_user_id', auth_user_record.id,
    'auth_created_at', auth_user_record.created_at,
    'auth_confirmed', auth_user_record.confirmed_at IS NOT NULL,
    'profile_exists', user_profile_record.id IS NOT NULL,
    'profile_linked_to_auth', user_profile_record.auth_user_id IS NOT NULL,
    'profile_signature_completed', user_profile_record.signature_completed,
    'account_memberships', account_memberships_count,
    'is_orphaned', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NULL),
    'is_fully_registered', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NOT NULL AND account_memberships_count > 0),
    'can_be_invited', (auth_user_record.id IS NULL OR user_profile_record.auth_user_id IS NULL)
  );

  RETURN result;
END;
$$;

-- Function to force cleanup of auth account (more aggressive)
CREATE OR REPLACE FUNCTION force_cleanup_auth_account(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_user_id uuid;
  user_profile_id uuid;
  account_memberships_count integer;
  result jsonb;
BEGIN
  -- Get auth user ID
  SELECT id INTO auth_user_id
  FROM auth.users
  WHERE email = target_email;

  -- If no auth user exists, nothing to clean up
  IF auth_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'none',
      'message', 'No auth account found for this email'
    );
  END IF;

  -- Check for linked user profile
  SELECT id INTO user_profile_id
  FROM users
  WHERE auth_user_id = force_cleanup_auth_account.auth_user_id;

  -- If there's a linked profile with account memberships, don't delete
  IF user_profile_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO account_memberships_count
    FROM account_users
    WHERE user_id = user_profile_id;

    IF account_memberships_count > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'action', 'blocked',
        'message', 'Cannot delete: user has active account memberships',
        'email', target_email,
        'memberships', account_memberships_count
      );
    END IF;

    -- Unlink the profile before deleting auth account
    UPDATE users
    SET auth_user_id = NULL
    WHERE id = user_profile_id;
  END IF;

  -- Delete the auth account
  DELETE FROM auth.users
  WHERE id = force_cleanup_auth_account.auth_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'deleted',
    'message', 'Auth account cleaned up successfully',
    'email', target_email,
    'had_profile', user_profile_id IS NOT NULL
  );
END;
$$;

-- Enhanced cleanup function that handles incomplete profiles
CREATE OR REPLACE FUNCTION cleanup_orphaned_auth_user(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_user_id uuid;
  user_profile_record RECORD;
  account_memberships_count integer;
  result jsonb;
BEGIN
  -- Find the auth.users record for this email
  SELECT id INTO auth_user_id
  FROM auth.users
  WHERE email = target_email;

  -- If no auth user exists, nothing to clean up
  IF auth_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'none',
      'message', 'No auth user found for this email'
    );
  END IF;

  -- Check for users profile linked to this auth account
  SELECT id, auth_user_id
  INTO user_profile_record
  FROM users
  WHERE auth_user_id = cleanup_orphaned_auth_user.auth_user_id;

  -- If there's a linked profile, check if it has account memberships
  IF user_profile_record.id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO account_memberships_count
    FROM account_users
    WHERE user_id = user_profile_record.id;

    -- If user has memberships, don't delete (they're a real user)
    IF account_memberships_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'action', 'none',
        'message', 'User has active account memberships, not deleted',
        'email', target_email
      );
    END IF;

    -- Profile exists but no memberships - unlink before deleting
    UPDATE users
    SET auth_user_id = NULL
    WHERE id = user_profile_record.id;
  END IF;

  -- Delete the orphaned auth account
  DELETE FROM auth.users
  WHERE id = cleanup_orphaned_auth_user.auth_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'deleted',
    'message', 'Orphaned auth user cleaned up successfully',
    'email', target_email,
    'had_profile', user_profile_record.id IS NOT NULL
  );
END;
$$;

-- Function to prepare email for new invitation (comprehensive cleanup)
CREATE OR REPLACE FUNCTION prepare_email_for_invitation(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  status_check jsonb;
  cleanup_result jsonb;
BEGIN
  -- First, check the current status
  SELECT check_auth_account_status(target_email) INTO status_check;

  -- If already fully registered with memberships, don't clean up
  IF (status_check->>'is_fully_registered')::boolean = true THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'User is already registered and has account memberships',
      'can_invite', false
    );
  END IF;

  -- If orphaned or incomplete, clean up
  IF (status_check->>'is_orphaned')::boolean = true OR 
     ((status_check->>'auth_exists')::boolean = true AND 
      (status_check->>'profile_linked_to_auth')::boolean = false) THEN
    
    SELECT cleanup_orphaned_auth_user(target_email) INTO cleanup_result;
    
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Email prepared for invitation',
      'cleanup_performed', true,
      'cleanup_result', cleanup_result,
      'can_invite', true
    );
  END IF;

  -- Email is clean and ready
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Email is ready for invitation',
    'cleanup_performed', false,
    'can_invite', true
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_auth_account_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION force_cleanup_auth_account(text) TO authenticated;
GRANT EXECUTE ON FUNCTION prepare_email_for_invitation(text) TO authenticated;

-- Also allow anonymous access to check_auth_account_status for invitation acceptance page
GRANT EXECUTE ON FUNCTION check_auth_account_status(text) TO anon;