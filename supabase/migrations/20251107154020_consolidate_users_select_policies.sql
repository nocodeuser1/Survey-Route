/*
  # Consolidate Users Table SELECT Policies

  ## Problem
  There are two SELECT policies which may conflict or cause confusion.

  ## Solution
  Remove both old policies and create a single comprehensive SELECT policy.

  ## Security
  - Users can view their own record
  - Account admins can view all users (needed for team management)
  - Regular users can only see themselves
*/

-- Remove existing SELECT policies
DROP POLICY IF EXISTS "Users can view their own record" ON users;
DROP POLICY IF EXISTS "Account admins can view users for team management" ON users;

-- Create single comprehensive SELECT policy
CREATE POLICY "Users view policy"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    -- User can see themselves
    auth_user_id = auth.uid()
    OR
    -- User is an account admin (can see all users for team management)
    EXISTS (
      SELECT 1 
      FROM account_users au
      INNER JOIN users u ON u.id = au.user_id
      WHERE u.auth_user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );
