/*
  # Add DELETE policies for user_invitations table

  1. Changes
    - Add DELETE policy for account admins to delete invitations
    - Add DELETE policy for agency owners to delete invitations

  2. Security
    - Only account admins can delete invitations for their accounts
    - Only agency owners can delete invitations for accounts in their agency
    - This allows proper cleanup when re-adding users and revoking invitations
*/

-- Account admins can delete invitations for their accounts
CREATE POLICY "Account admins can delete invitations for their accounts"
  ON user_invitations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
      AND account_users.role = 'account_admin'
    )
  );

-- Agency owners can delete invitations for accounts in their agency
CREATE POLICY "Agency owners can delete invitations for their agency"
  ON user_invitations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON ag.id = a.agency_id
      WHERE a.id = user_invitations.account_id
      AND ag.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );