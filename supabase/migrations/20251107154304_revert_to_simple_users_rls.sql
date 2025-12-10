/*
  # Revert to Simple Users RLS Policy

  ## Problem
  Complex RLS policies with subqueries on users table cause infinite recursion.

  ## Solution
  Revert to simple policy: users can only see themselves.
  We'll handle team member checking differently in the application code.

  ## Security
  - Users can only view their own record
  - This prevents infinite recursion
  - Team management will use a different approach
*/

-- Drop all complex policies
DROP POLICY IF EXISTS "Users select policy" ON users;
DROP POLICY IF EXISTS "Users view with admin check" ON users;
DROP POLICY IF EXISTS "Users view policy" ON users;
DROP POLICY IF EXISTS "Users can view appropriately" ON users;

-- Create simple, safe policy
CREATE POLICY "Users can read own record"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());
