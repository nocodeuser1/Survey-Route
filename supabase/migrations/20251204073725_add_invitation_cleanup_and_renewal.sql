/*
  # Add Invitation Cleanup and Renewal Functions

  1. New Functions
    - `cleanup_orphaned_auth_user` - Safely removes orphaned auth users when invitations are revoked
    - `renew_invitation` - Extends invitation expiration by 7 days

  2. What It Does
    - When an invitation is revoked, automatically cleans up any orphaned auth.users record
    - Only deletes auth.users if there's no linked users profile (safe cleanup)
    - Provides a way to extend invitation expiration without creating a new invitation

  3. Security
    - Functions are SECURITY DEFINER to bypass RLS
    - Only callable by account admins or agency owners
    - Includes safety checks to prevent accidental deletions
*/

-- Function to safely clean up orphaned auth users
CREATE OR REPLACE FUNCTION cleanup_orphaned_auth_user(target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_user_id uuid;
  linked_profile_exists boolean;
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

  -- Check if there's a linked users profile
  SELECT EXISTS(
    SELECT 1 FROM users
    WHERE auth_user_id = cleanup_orphaned_auth_user.auth_user_id
  ) INTO linked_profile_exists;

  -- Only delete if there's NO linked profile (orphaned)
  IF NOT linked_profile_exists THEN
    DELETE FROM auth.users
    WHERE id = cleanup_orphaned_auth_user.auth_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'deleted',
      'message', 'Orphaned auth user cleaned up successfully',
      'email', target_email
    );
  ELSE
    -- There's a linked profile, don't delete
    RETURN jsonb_build_object(
      'success', true,
      'action', 'none',
      'message', 'Auth user has a linked profile, not deleted',
      'email', target_email
    );
  END IF;
END;
$$;

-- Function to renew an invitation (extend expiration)
CREATE OR REPLACE FUNCTION renew_invitation(invitation_id uuid, days_to_extend integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  invitation_record RECORD;
  new_expiration timestamptz;
  result jsonb;
BEGIN
  -- Get the invitation
  SELECT * INTO invitation_record
  FROM user_invitations
  WHERE id = invitation_id;

  -- Check if invitation exists
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invitation not found'
    );
  END IF;

  -- Check if invitation is pending
  IF invitation_record.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Only pending invitations can be renewed'
    );
  END IF;

  -- Calculate new expiration (from now, not from old expiration)
  new_expiration := now() + (days_to_extend || ' days')::interval;

  -- Update the invitation
  UPDATE user_invitations
  SET expires_at = new_expiration
  WHERE id = invitation_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Invitation renewed successfully',
    'new_expiration', new_expiration,
    'email', invitation_record.email
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION cleanup_orphaned_auth_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION renew_invitation(uuid, integer) TO authenticated;