/*
  # Fix User Invitations Visibility for Account Admins

  1. Changes
    - Add RLS policy to allow account admins to view invitations for their account
    - This allows team management features to work properly for account admins
  
  2. Security
    - Policy checks that user is an authenticated account_admin for the account
    - Uses the get_account_team_members helper function to verify membership
*/

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Account admins can view invitations for their account" ON user_invitations;

-- Create policy allowing account admins to view their account's invitations
CREATE POLICY "Account admins can view invitations for their account"
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
  );
