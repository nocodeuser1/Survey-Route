/*
  # Fix Users RLS to Allow Viewing Team Members

  ## Problem
  Users can't see other users in their account because RLS only allows
  viewing own record. This breaks the team members list.

  ## Solution
  Allow users to view other users who are in the same account(s) as them.
  This is safe because they're part of the same team.

  ## Security
  - Users can view their own record
  - Users can view other users who share at least one account
  - This allows team member lists to work properly
*/

-- Drop existing simple policy
DROP POLICY IF EXISTS "Users can read own record" ON users;

-- Create new policy that allows viewing team members
CREATE POLICY "Users can view team members"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    -- User can see themselves
    auth_user_id = auth.uid()
    OR
    -- User can see others in their accounts
    id IN (
      SELECT DISTINCT au2.user_id
      FROM account_users au1
      INNER JOIN account_users au2 ON au2.account_id = au1.account_id
      WHERE au1.user_id IN (
        SELECT id FROM users WHERE auth_user_id = auth.uid()
      )
    )
  );
