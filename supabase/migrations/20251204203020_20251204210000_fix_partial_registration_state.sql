/*
  # Fix Partial Registration State for Invitations

  1. Changes
    - Update `check_auth_account_status` to detect "partial registration" state
    - Add `is_partial_registration` flag for users with auth+profile but no memberships
    - Improve `can_be_invited` logic to allow completing partial registrations
    - Update `prepare_email_for_invitation` to handle partial registrations

  2. What This Fixes
    - Users who created auth accounts but failed to join the account can now complete signup
    - Prevents "already registered" error for users in partial state
    - Allows invitation acceptance to complete the missing account membership
    - Distinguishes between fully registered users and partial registrations

  3. Security
    - All existing security checks remain in place
    - No breaking changes to existing functionality
*/

-- Drop and recreate with enhanced logic
DROP FUNCTION IF EXISTS check_auth_account_status(text, uuid);

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

  -- Count total account memberships
  IF user_profile_record.id IS NOT NULL THEN
    SELECT COUNT(*)
    INTO account_memberships_count
    FROM account_users
    WHERE user_id = user_profile_record.id;
  ELSE
    account_memberships_count := 0;
  END IF;

  -- Detect partial registration: auth exists, profile exists with link, but NO memberships
  is_partial_registration := (
    auth_user_record.id IS NOT NULL AND 
    user_profile_record.id IS NOT NULL AND 
    user_profile_record.auth_user_id IS NOT NULL AND
    account_memberships_count = 0
  );

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
    'profile_id', user_profile_record.id,
    'profile_linked_to_auth', user_profile_record.auth_user_id IS NOT NULL,
    'profile_signature_completed', user_profile_record.signature_completed,
    'account_memberships', account_memberships_count,
    'is_member_of_target_account', is_member_of_target,
    'has_memberships_to_other_accounts', other_account_memberships_count > 0,
    'is_orphaned', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NULL),
    'is_partial_registration', is_partial_registration,
    'is_fully_registered', (auth_user_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NOT NULL AND account_memberships_count > 0),
    'can_be_invited', (
      auth_user_record.id IS NULL OR 
      user_profile_record.auth_user_id IS NULL OR 
      is_partial_registration OR
      NOT is_member_of_target
    ),
    'needs_membership_only', is_partial_registration
  );

  RETURN result;
END;
$$;

-- Update prepare_email_for_invitation to handle partial registrations
DROP FUNCTION IF EXISTS prepare_email_for_invitation(text);

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

  -- If partial registration (auth+profile but no memberships), allow invitation
  IF (status_check->>'is_partial_registration')::boolean = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'User has partial registration, can complete via invitation',
      'state', 'partial_registration',
      'can_invite', true,
      'needs_membership_only', true
    );
  END IF;

  -- If already fully registered with memberships, don't clean up
  IF (status_check->>'is_fully_registered')::boolean = true THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'User is already registered and has account memberships',
      'state', 'fully_registered',
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
      'state', 'cleaned_up',
      'cleanup_performed', true,
      'cleanup_result', cleanup_result,
      'can_invite', true
    );
  END IF;

  -- Email is clean and ready
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Email is ready for invitation',
    'state', 'clean',
    'cleanup_performed', false,
    'can_invite', true
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_auth_account_status(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION check_auth_account_status(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION prepare_email_for_invitation(text) TO authenticated;
