/*
  # Fix Partial Registration Detection to be Account-Specific

  1. Changes
    - Update `prepare_email_for_invitation` to accept target_account_id parameter
    - Make partial registration detection account-specific
    - User with memberships to OTHER accounts should not be treated as "partial"
    - Only treat as partial if user has NO membership to the TARGET account

  2. What This Fixes
    - Users who are members of Account A won't see "partial registration" when invited to Account B
    - Clear distinction between "existing user joining new account" vs "failed signup"
    - Better user experience for multi-account scenarios

  3. Security
    - All existing security checks remain in place
    - Account-specific membership checks prevent confusion
*/

-- Update prepare_email_for_invitation to be account-aware
CREATE OR REPLACE FUNCTION prepare_email_for_invitation(
  target_email text,
  target_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  status_check jsonb;
  cleanup_result jsonb;
  is_member_of_target boolean;
  has_other_memberships boolean;
BEGIN
  -- Check current auth status with account-specific context
  SELECT check_auth_account_status(target_email, target_account_id) INTO status_check;

  -- Extract account membership information
  is_member_of_target := COALESCE((status_check->>'is_member_of_target_account')::boolean, false);
  has_other_memberships := COALESCE((status_check->>'has_memberships_to_other_accounts')::boolean, false);

  -- If user is already member of the target account, block invitation
  IF is_member_of_target THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'User is already a member of this account',
      'state', 'already_member',
      'can_invite', false
    );
  END IF;

  -- If user has auth + profile but NO membership to target account
  -- This could be either:
  --   1. Failed signup attempt (no memberships anywhere) - treat as partial
  --   2. Existing user from another account - allow joining this account
  IF (status_check->>'auth_exists')::boolean = true AND
     (status_check->>'profile_linked_to_auth')::boolean = true THEN
    
    -- Case 1: No memberships anywhere - partial registration that failed
    IF NOT has_other_memberships THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'User has partial registration, can complete via invitation',
        'state', 'partial_registration',
        'can_invite', true,
        'needs_membership_only', true
      );
    END IF;

    -- Case 2: Has memberships to other accounts - existing user joining new account
    IF has_other_memberships THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'Existing user can join this account',
        'state', 'existing_user_new_account',
        'can_invite', true,
        'needs_membership_only', true,
        'is_existing_user', true
      );
    END IF;
  END IF;

  -- If already fully registered with memberships to target account specifically
  IF (status_check->>'is_fully_registered')::boolean = true AND is_member_of_target THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'User is already registered and member of this account',
      'state', 'fully_registered_target',
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

GRANT EXECUTE ON FUNCTION prepare_email_for_invitation(text, uuid) TO authenticated;
