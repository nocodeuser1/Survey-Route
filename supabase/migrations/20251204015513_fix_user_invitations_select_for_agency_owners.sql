/*
  # Fix User Invitations SELECT Policy for Agency Owners

  1. Changes
    - Update SELECT policy to allow BOTH account admins AND agency owners to view invitations
    - This matches the pattern used in DELETE and UPDATE policies
    - Fixes bug where agency owners can create invitations but cannot see them
  
  2. Security
    - Policy checks that user is either:
      - An authenticated account_admin for the account, OR
      - The agency owner (verified via agencies.owner_email)
*/

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Account admins can view invitations for their account" ON user_invitations;

-- Create new SELECT policy that allows both account admins AND agency owners
CREATE POLICY "Account admins and agency owners can view invitations"
  ON user_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users au
      INNER JOIN users u ON u.id = au.user_id
      WHERE au.account_id = user_invitations.account_id
      AND u.auth_user_id = auth.uid()
      AND au.role = 'account_admin'
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );
