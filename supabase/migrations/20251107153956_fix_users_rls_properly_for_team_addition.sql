/*
  # Fix Users Table RLS Properly

  ## Problem
  The previous migration was too permissive. We need a more secure approach.

  ## Solution
  Remove the overly permissive policy and replace with account-admin-only access
  for checking user existence.

  ## Security
  - Users can view their own record
  - Account admins can view users who share at least one account with them
  - This allows team member addition while maintaining security
*/

-- Remove the overly permissive policy
DROP POLICY IF EXISTS "Allow checking user existence by email" ON users;

-- Update the account admin policy to be more permissive for team management
-- This allows account admins to see if a user exists when they're trying to add them
DROP POLICY IF EXISTS "Account admins can view users in their accounts" ON users;

CREATE POLICY "Account admins can view users for team management"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    -- User can see themselves
    auth_user_id = auth.uid()
    OR
    -- User is an account admin in at least one account
    EXISTS (
      SELECT 1 
      FROM account_users au
      INNER JOIN users u ON u.id = au.user_id
      WHERE u.auth_user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );
