/*
  # Fix Invitation Acceptance to Check Account-Specific Membership

  1. Changes
    - Update `check_auth_account_status` function to accept optional `target_account_id` parameter
    - Add `is_member_of_target_account` field to return value
    - Add `has_memberships_to_other_accounts` field to distinguish scenarios
    - Keep existing fields for backward compatibility

  2. What This Fixes
    - Users who are members of Account A can now be invited to Account B
    - Invitation acceptance checks if user is member of the SPECIFIC account being invited to
    - Prevents "already registered" error for users with existing accounts in other accounts
    - Only blocks acceptance if user is already a member of the specific target account

  3. Security
    - Function remains SECURITY DEFINER to access auth.users table
    - All existing security checks remain in place
    - No breaking changes to existing functionality
*/

-- Drop and recreate the function with the new parameter
DROP FUNCTION IF EXISTS check_auth_account_status(text);

CREATE OR REPLACE FUNCTION check_auth_account_status(
  target_email text,
  target_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_user_record RECORD;
  user_profile_record RECORD;
  account_memberships_count integer;
  is_member_of_target boolean;
  other_account_memberships_count integer;
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

  -- Count total account memberships
  SELECT COUNT(*)
  INTO account_memberships_count
  FROM account_users
  WHERE user_id = user_profile_record.id;

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
    'is_member_of_target_account', is_member_of_target,
    'has_memberships_to_other_accounts', other_account_memberships_count > 0,
    'is_orphaned', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NULL),
    'is_fully_registered', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NOT NULL AND account_memberships_count > 0),
    'can_be_invited', (auth_user_record.id IS NULL OR user_profile_record.auth_user_id IS NULL)
  );

  RETURN result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_auth_account_status(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION check_auth_account_status(text, uuid) TO anon;
