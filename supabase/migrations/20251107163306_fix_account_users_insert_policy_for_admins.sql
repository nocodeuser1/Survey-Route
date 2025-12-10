/*
  # Fix account_users INSERT Policy to Allow Account Admins
  
  ## Problem
  The current INSERT policy on account_users only allows agency owners to add team members.
  Account admins should also be able to add team members to their own accounts.
  
  ## Solution
  Update the INSERT policy to allow BOTH:
  1. Agency owners adding members to any account in their agency
  2. Account admins adding members to their own account
  
  ## Security
  - Agency owners can add members to any account in their agency
  - Account admins can only add members to accounts where they are admins
  - Regular users cannot add members
*/

-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Agency owners can add account members" ON account_users;

-- Create comprehensive INSERT policy for both agency owners AND account admins
CREATE POLICY "Authorized users can add account members"
  ON account_users FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Case 1: Agency owner adding member to any account in their agency
    EXISTS (
      SELECT 1
      FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
        AND agencies.owner_email = auth.email()
    )
    OR
    -- Case 2: Account admin adding member to their own account
    EXISTS (
      SELECT 1
      FROM account_users au_check
      JOIN users ON users.id = au_check.user_id
      WHERE au_check.account_id = account_users.account_id
        AND users.auth_user_id = auth.uid()
        AND au_check.role = 'account_admin'
    )
  );
