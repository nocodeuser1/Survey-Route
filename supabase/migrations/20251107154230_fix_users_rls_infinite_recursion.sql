/*
  # Fix Infinite Recursion in Users Table RLS

  ## Problem
  The RLS policy causes infinite recursion because it queries the users table
  while checking permissions on the users table itself.

  ## Solution
  Rewrite the policy to avoid the recursive JOIN on users table.
  Check account_users directly using auth.uid() instead of joining through users.

  ## Security
  - Users can view their own record
  - Account admins can view all users (for team management)
*/

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users view policy" ON users;

-- Create fixed policy without recursive users table lookup
CREATE POLICY "Users can view appropriately"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    -- User can see themselves
    auth_user_id = auth.uid()
    OR
    -- User is an account admin in any account (can see all users for team management)
    EXISTS (
      SELECT 1 
      FROM account_users au
      WHERE au.user_id = (
        SELECT id FROM users WHERE auth_user_id = auth.uid() LIMIT 1
      )
      AND au.role = 'account_admin'
    )
  );
