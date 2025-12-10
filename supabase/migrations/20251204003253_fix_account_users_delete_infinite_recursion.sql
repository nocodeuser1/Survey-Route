/*
  # Fix Account Users DELETE Policy Infinite Recursion

  ## Problem
  The current account_users DELETE policy queries the account_users table 
  directly within the policy, causing infinite recursion:

  ```sql
  account_id IN (
    SELECT account_id FROM account_users
    WHERE user_id = (SELECT auth.uid())
    AND role IN ('owner', 'admin')
  )
  ```

  This creates the error: "infinite recursion detected in policy for relation account_users"

  ## Solution
  Use the existing is_account_admin helper function that was created for the INSERT policy.
  This function uses SECURITY DEFINER to bypass RLS and break the recursion chain.

  ## Changes
  - Replace problematic DELETE policy with one that uses the helper function
  - Allows agency owners and account admins to remove team members
  - Prevents users from deleting themselves (must be done through proper leave mechanism)

  ## Security
  - Uses is_account_admin function which bypasses RLS via SECURITY DEFINER
  - Ensures only admins can delete team members
  - Prevents accidental self-deletion
*/

-- ============================================================================
-- Fix DELETE Policy for account_users
-- ============================================================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can delete team members in their accounts" ON account_users;

-- Create new DELETE policy using the helper function (no recursion)
CREATE POLICY "Users can delete team members in their accounts"
  ON account_users FOR DELETE
  TO authenticated
  USING (
    -- Case 1: Agency owner can delete members from any account in their agency
    EXISTS (
      SELECT 1
      FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
        AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
    OR
    -- Case 2: Account admin can delete members from their account (using helper function)
    (
      is_account_admin(account_users.account_id)
      -- Prevent users from deleting themselves
      AND account_users.user_id != (
        SELECT id FROM users WHERE auth_user_id = auth.uid()
      )
    )
  );