/*
  # Fix User Invitations DELETE and UPDATE Policies for Account Admins

  1. Changes
    - Fix DELETE policy to properly check account_admin role
    - Add UPDATE policy for account admins (for resending invitations)
    - Use correct role name 'account_admin' instead of 'admin' or 'owner'
  
  2. Security
    - Policies check that user is an authenticated account_admin for the account
    - Properly join through users table to match auth.uid() to account_users
*/

-- Drop and recreate DELETE policy with correct role check
DROP POLICY IF EXISTS "Authorized users can delete invitations" ON user_invitations;
CREATE POLICY "Authorized users can delete invitations"
  ON user_invitations FOR DELETE
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

-- Add UPDATE policy for account admins (for updating invitation status, resending, etc.)
DROP POLICY IF EXISTS "Account admins can update invitations for their account" ON user_invitations;
CREATE POLICY "Account admins can update invitations for their account"
  ON user_invitations FOR UPDATE
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
  )
  WITH CHECK (
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
