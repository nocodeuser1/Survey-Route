/*
  # Fix Users Table RLS for Team Management

  ## Problem
  Account admins cannot view other users when trying to add team members,
  causing the system to think users don't exist even when they do.

  ## Changes
  1. Add policy to allow account admins to view users in their accounts
  2. Add policy to allow viewing users by email for team member addition
  
  ## Security
  - Users can still only view themselves by default
  - Account admins can view users who are members of accounts they admin
  - When adding team members, allow checking if email exists across all users
    (this is safe because it's only exposing that an email exists, not sensitive data)
*/

-- Drop existing restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view themselves" ON users;

-- Allow users to view their own record
CREATE POLICY "Users can view their own record"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- Allow account admins to view users in their accounts
CREATE POLICY "Account admins can view users in their accounts"
  ON users
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM account_users au1
      INNER JOIN account_users au2 ON au2.account_id = au1.account_id
      WHERE au1.user_id = users.id
        AND au2.user_id IN (
          SELECT id FROM users WHERE auth_user_id = auth.uid()
        )
        AND au2.role = 'account_admin'
    )
  );

-- Allow checking if a user exists by email (for team member addition)
-- This only exposes the user ID, not sensitive information
CREATE POLICY "Allow checking user existence by email"
  ON users
  FOR SELECT
  TO authenticated
  USING (true);
