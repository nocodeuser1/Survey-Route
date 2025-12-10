/*
  # Fix Ambiguous Column Reference in Cleanup Functions

  ## Problem
  The `cleanup_orphaned_auth_user` and `force_cleanup_auth_account` functions use a local variable 
  named `auth_user_id` which conflicts with the `auth_user_id` column in the `users` table.
  This causes "column reference 'auth_user_id' is ambiguous" errors during execution.

  ## Changes
  1. Rename `auth_user_id` variable to `v_auth_user_id` in `cleanup_orphaned_auth_user`.
  2. Rename `auth_user_id` variable to `v_auth_user_id` in `force_cleanup_auth_account`.
  3. Rename other variables to `v_` prefix for consistency and safety.

  ## Security
  - Functions remain SECURITY DEFINER.
*/

CREATE OR REPLACE FUNCTION cleanup_orphaned_auth_user(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth_user_id uuid;
  v_user_profile_record RECORD;
  v_account_memberships_count integer;
BEGIN
  -- Find the auth.users record for this email
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = target_email;

  -- Find the users profile record
  SELECT id, auth_user_id, email
  INTO v_user_profile_record
  FROM users
  WHERE email = target_email;

  -- Count memberships if profile exists
  IF v_user_profile_record.id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_account_memberships_count
    FROM account_users
    WHERE user_id = v_user_profile_record.id;
  ELSE
    v_account_memberships_count := 0;
  END IF;

  -- Case 1: Profile has memberships - don't delete, just unlink if orphaned
  IF v_account_memberships_count > 0 THEN
    IF v_user_profile_record.auth_user_id IS NULL OR v_auth_user_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'action', 'blocked',
        'message', 'User has active memberships, cannot clean up completely',
        'memberships', v_account_memberships_count
      );
    END IF;
  END IF;

  -- Case 2: Profile exists with NO memberships - delete it entirely
  IF v_user_profile_record.id IS NOT NULL AND v_account_memberships_count = 0 THEN
    DELETE FROM users
    WHERE id = v_user_profile_record.id;
  END IF;

  -- Delete auth account if it exists
  IF v_auth_user_id IS NOT NULL THEN
    DELETE FROM auth.users
    WHERE id = v_auth_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'cleaned',
    'message', 'Orphaned auth and profile cleaned up successfully',
    'email', target_email,
    'auth_deleted', v_auth_user_id IS NOT NULL,
    'profile_deleted', v_user_profile_record.id IS NOT NULL AND v_account_memberships_count = 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION force_cleanup_auth_account(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth_user_id uuid;
  v_user_profile_id uuid;
  v_account_memberships_count integer;
BEGIN
  -- Get auth user ID
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = target_email;

  -- If no auth user exists, nothing to clean up
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'none',
      'message', 'No auth account found for this email'
    );
  END IF;

  -- Check for linked user profile
  -- Note: We use the variable v_auth_user_id here
  SELECT id INTO v_user_profile_id
  FROM users
  WHERE auth_user_id = v_auth_user_id;

  -- If there's a linked profile, check memberships
  IF v_user_profile_id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_account_memberships_count
    FROM account_users
    WHERE user_id = v_user_profile_id;

    IF v_account_memberships_count > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'action', 'blocked',
        'message', 'Cannot delete: user has active account memberships',
        'email', target_email,
        'memberships', v_account_memberships_count
      );
    END IF;

    -- Delete the profile entirely since it has no memberships
    DELETE FROM users
    WHERE id = v_user_profile_id;
  END IF;

  -- Delete the auth account
  DELETE FROM auth.users
  WHERE id = v_auth_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'deleted',
    'message', 'Auth account and profile cleaned up successfully',
    'email', target_email,
    'profile_deleted', v_user_profile_id IS NOT NULL
  );
END;
$$;
