/*
  # Fix User Invitations INSERT Policy

  1. Changes
    - Drop old INSERT policy that checks for wrong role names ('owner', 'admin')
    - Create new INSERT policy that checks for correct roles ('account_admin')
    - Also allow agency owners to create invitations
  
  2. Security
    - Policy allows both account admins AND agency owners to create invitations
    - Matches the pattern used in SELECT, UPDATE, and DELETE policies
*/

-- Drop the broken INSERT policy
DROP POLICY IF EXISTS "Authorized users can create invitations" ON user_invitations;

-- Create correct INSERT policy for account admins and agency owners
CREATE POLICY "Account admins and agency owners can create invitations"
  ON user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Account admins can create invitations
    EXISTS (
      SELECT 1 FROM account_users au
      INNER JOIN users u ON u.id = au.user_id
      WHERE au.account_id = user_invitations.account_id
      AND u.auth_user_id = auth.uid()
      AND au.role = 'account_admin'
    )
    OR
    -- Agency owners can create invitations for their agency's accounts
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );
