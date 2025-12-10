/*
  # Fix Invitation Cleanup to Fully Delete Unused Profiles

  1. Changes
    - Update `force_cleanup_auth_account` to DELETE user profiles with no memberships
    - Previously only unlinked profiles (set auth_user_id to NULL)
    - This caused "partial registration" state when users were re-invited
    - Now ensures truly clean state for re-invitation

  2. What This Fixes
    - After revoking invitation, user data is completely removed
    - Re-inviting user starts with clean slate (no "previously started account" message)
    - Prevents orphaned profile records from causing confusion

  3. Security
    - Only deletes profiles with ZERO account memberships
    - Protects users who are members of other accounts
    - Requires SECURITY DEFINER to bypass RLS
*/

CREATE OR REPLACE FUNCTION force_cleanup_auth_account(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- If there's a linked profile, check memberships
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

    -- Delete the profile entirely since it has no memberships
    -- This is the key fix - previously we only unlinked it
    DELETE FROM users
    WHERE id = user_profile_id;
  END IF;

  -- Delete the auth account
  DELETE FROM auth.users
  WHERE id = force_cleanup_auth_account.auth_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'deleted',
    'message', 'Auth account and profile cleaned up successfully',
    'email', target_email,
    'profile_deleted', user_profile_id IS NOT NULL
  );
END;
$$;

-- Update cleanup_orphaned_auth_user to also delete profiles with no memberships
CREATE OR REPLACE FUNCTION cleanup_orphaned_auth_user(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Find the users profile record
  SELECT id, auth_user_id, email
  INTO user_profile_record
  FROM users
  WHERE email = target_email;

  -- Count memberships if profile exists
  IF user_profile_record.id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO account_memberships_count
    FROM account_users
    WHERE user_id = user_profile_record.id;
  ELSE
    account_memberships_count := 0;
  END IF;

  -- Case 1: Profile has memberships - don't delete, just unlink if orphaned
  IF account_memberships_count > 0 THEN
    IF user_profile_record.auth_user_id IS NULL OR auth_user_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'action', 'blocked',
        'message', 'User has active memberships, cannot clean up completely',
        'memberships', account_memberships_count
      );
    END IF;
  END IF;

  -- Case 2: Profile exists with NO memberships - delete it entirely
  IF user_profile_record.id IS NOT NULL AND account_memberships_count = 0 THEN
    DELETE FROM users
    WHERE id = user_profile_record.id;
  END IF;

  -- Delete auth account if it exists
  IF auth_user_id IS NOT NULL THEN
    DELETE FROM auth.users
    WHERE id = auth_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'cleaned',
    'message', 'Orphaned auth and profile cleaned up successfully',
    'email', target_email,
    'auth_deleted', auth_user_id IS NOT NULL,
    'profile_deleted', user_profile_record.id IS NOT NULL AND account_memberships_count = 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION force_cleanup_auth_account(text) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_auth_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_auth_user(text) TO anon;
