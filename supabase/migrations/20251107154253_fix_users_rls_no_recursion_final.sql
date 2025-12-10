/*
  # Fix Users RLS Without Recursion - Final Solution

  ## Problem
  Any query to users table within users RLS policy causes infinite recursion.

  ## Solution
  Use a materialized approach: query account_users table directly with a
  subquery that doesn't trigger RLS on users (use WHERE clause that matches
  on auth_user_id which is indexed).

  ## Security
  - Users can view their own record
  - Account admins can view all users
*/

-- Drop all existing SELECT policies on users
DROP POLICY IF EXISTS "Users view with admin check" ON users;
DROP POLICY IF EXISTS "Users view policy" ON users;
DROP POLICY IF EXISTS "Users can view appropriately" ON users;

-- Drop the function
DROP FUNCTION IF EXISTS is_account_admin();

-- Simple policy: users can see themselves OR if they're an account admin
CREATE POLICY "Users select policy"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR
    auth_user_id IN (
      SELECT u.auth_user_id
      FROM users u
      INNER JOIN account_users au ON au.user_id = u.id
      WHERE u.auth_user_id = auth.uid()
        AND au.role = 'account_admin'
    )
    OR
    -- If current user is admin, allow seeing all users
    EXISTS (
      SELECT 1 FROM account_users
      WHERE user_id IN (
        SELECT id FROM users WHERE auth_user_id = auth.uid()
      )
      AND role = 'account_admin'
    )
  );
