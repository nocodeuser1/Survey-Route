/*
  # Fix Account Users INSERT Policy Infinite Recursion

  ## Problem
  The current account_users INSERT policy (from migration 20251123171352)
  queries the account_users table directly within the policy:

  ```sql
  account_id IN (
    SELECT account_id FROM account_users
    WHERE user_id = (SELECT auth.uid())
    AND role IN ('owner', 'admin')
  )
  ```

  This creates infinite recursion: "infinite recursion detected in policy for relation account_users"

  ## Solution
  1. Restore the is_account_admin helper function with improved configuration
  2. Update INSERT policy to use this helper function instead of direct table query
  3. This breaks the recursion chain by using a SECURITY DEFINER function

  ## Changes
  - Recreate is_account_admin function with proper search_path and STABLE marking
  - Replace problematic INSERT policy with one that uses the helper function
  - Allows agency owners and account admins to add team members

  ## Security
  - Function uses SECURITY DEFINER to bypass RLS (breaks recursion)
  - Only checks if current user is an admin of specific account
  - Returns boolean, no data exposure
  - Uses auth.uid() to ensure correct user context
*/

-- ============================================================================
-- PART 1: Create/Update Helper Function
-- ============================================================================

-- Drop and recreate the helper function with improved configuration
DROP FUNCTION IF EXISTS is_account_admin(uuid);

CREATE OR REPLACE FUNCTION is_account_admin(check_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  -- Check if current user is an admin of the specified account
  -- SECURITY DEFINER allows this to bypass RLS and break recursion
  RETURN EXISTS (
    SELECT 1
    FROM account_users au
    JOIN users u ON u.id = au.user_id
    WHERE au.account_id = check_account_id
      AND u.auth_user_id = auth.uid()
      AND au.role IN ('owner', 'admin')
  );
END;
$$;

-- ============================================================================
-- PART 2: Fix INSERT Policy
-- ============================================================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "Authorized users can add account members" ON account_users;

-- Create new INSERT policy using the helper function (no recursion)
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
        AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
    OR
    -- Case 2: Account admin adding member to their own account (using helper function)
    is_account_admin(account_users.account_id)
  );
