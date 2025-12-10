/*
  # Fix Users RLS with Helper Function

  ## Problem
  Cannot query users table within users table RLS policy (causes infinite recursion).

  ## Solution
  Create a helper function that checks if current user is an account admin
  without querying the users table recursively.

  ## Security
  - Users can view their own record
  - Account admins can view all users
*/

-- Drop problematic policy
DROP POLICY IF EXISTS "Users can view appropriately" ON users;

-- Create helper function to check if user is account admin
CREATE OR REPLACE FUNCTION is_account_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM account_users au
    INNER JOIN users u ON u.id = au.user_id
    WHERE u.auth_user_id = auth.uid()
      AND au.role = 'account_admin'
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Create policy using the function
CREATE POLICY "Users view with admin check"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    -- User can see themselves
    auth_user_id = auth.uid()
    OR
    -- User is an account admin
    is_account_admin()
  );
