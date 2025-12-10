/*
  # Improve Auth Status Check with Better Membership Detection

  1. Changes
    - Add explicit search_path for SECURITY DEFINER safety
    - Better detection of "membership already exists to target account" state
    - Clearer state reporting for invitation acceptance flow
    - Fix potential RLS bypass issues

  2. New States
    - `has_target_membership`: User already has membership to the specific account
    - `needs_membership_only`: User can just be added to account (has auth+profile)
    - More accurate `can_be_invited` logic

  3. Security
    - Proper search_path configuration
    - SECURITY DEFINER to query across tables safely
*/

DROP FUNCTION IF EXISTS check_auth_account_status(text, uuid);

CREATE OR REPLACE FUNCTION check_auth_account_status(
  target_email text,
  target_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  auth_user_record RECORD;
  user_profile_record RECORD;
  account_memberships_count integer;
  is_member_of_target boolean;
  other_account_memberships_count integer;
  is_partial_registration boolean;
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

  -- Count total account memberships (bypass RLS with SECURITY DEFINER)
  IF user_profile_record.id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO account_memberships_count
    FROM account_users
    WHERE user_id = user_profile_record.id;
  ELSE
    account_memberships_count := 0;
  END IF;

  -- Check if user is member of the specific target account (if provided)
  IF target_account_id IS NOT NULL AND user_profile_record.id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM account_users
      WHERE user_id = user_profile_record.id
        AND account_id = target_account_id
    ) INTO is_member_of_target;

    -- Count memberships to OTHER accounts
    SELECT COUNT(*)
    INTO other_account_memberships_count
    FROM account_users
    WHERE user_id = user_profile_record.id
      AND account_id != target_account_id;
  ELSE
    is_member_of_target := false;
    other_account_memberships_count := account_memberships_count;
  END IF;

  -- Detect partial registration: auth exists, profile exists with link, but NO memberships
  is_partial_registration := (
    auth_user_record.id IS NOT NULL AND 
    user_profile_record.id IS NOT NULL AND 
    user_profile_record.auth_user_id IS NOT NULL AND
    account_memberships_count = 0
  );

  -- Build comprehensive status
  result := jsonb_build_object(
    'email', target_email,
    'auth_exists', auth_user_record.id IS NOT NULL,
    'auth_user_id', auth_user_record.id,
    'auth_created_at', auth_user_record.created_at,
    'auth_confirmed', auth_user_record.confirmed_at IS NOT NULL,
    'profile_exists', user_profile_record.id IS NOT NULL,
    'profile_id', user_profile_record.id,
    'profile_linked_to_auth', user_profile_record.auth_user_id IS NOT NULL,
    'profile_signature_completed', user_profile_record.signature_completed,
    'account_memberships', account_memberships_count,
    'is_member_of_target_account', is_member_of_target,
    'has_memberships_to_other_accounts', other_account_memberships_count > 0,
    'is_orphaned', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NULL),
    'is_partial_registration', is_partial_registration,
    'is_fully_registered', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NOT NULL AND account_memberships_count > 0),
    'state', CASE
      WHEN auth_user_record.id IS NULL THEN 'no_auth'
      WHEN user_profile_record.auth_user_id IS NULL THEN 'orphaned'
      WHEN is_member_of_target THEN 'has_target_membership'
      WHEN account_memberships_count = 0 THEN 'partial_no_memberships'
      ELSE 'partial_other_memberships'
    END,
    'can_be_invited', (
      auth_user_record.id IS NULL OR 
      user_profile_record.auth_user_id IS NULL OR 
      NOT is_member_of_target
    ),
    'needs_membership_only', (
      auth_user_record.id IS NOT NULL AND
      user_profile_record.auth_user_id IS NOT NULL AND
      NOT is_member_of_target
    )
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION check_auth_account_status(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION check_auth_account_status(text, uuid) TO anon;
