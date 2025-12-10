/*
  # Fix account_users INSERT policy for invitation acceptance

  1. Changes
    - Update the INSERT policy to allow users to add themselves to an account when they have a valid pending invitation
    - The policy now checks if there's a pending invitation for the user's email and the target account
  
  2. Security
    - Users can only add themselves (their user_id matches their auth user)
    - Only if they have a valid pending invitation for that specific account
    - Existing permissions for agency owners and account admins remain intact
*/

-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Authorized users can add account members" ON account_users;

-- Create a new INSERT policy that allows invitation acceptance
CREATE POLICY "Authorized users can add account members"
  ON account_users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Agency owners can add members to their accounts
    (EXISTS (
      SELECT 1
      FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt() ->> 'email')
    ))
    OR
    -- Account admins can add members
    is_account_admin(account_id)
    OR
    -- Users can add themselves if they have a valid pending invitation
    (
      user_id IN (
        SELECT id FROM users WHERE auth_user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM user_invitations
        WHERE user_invitations.account_id = account_users.account_id
        AND user_invitations.email = (SELECT auth.jwt() ->> 'email')
        AND user_invitations.status = 'pending'
        AND user_invitations.expires_at > NOW()
      )
    )
  );