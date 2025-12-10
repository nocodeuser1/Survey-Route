/*
  # Fix Account Users RLS Role Mismatch

  ## Problem
  The `is_account_admin` helper function checks for roles 'owner' and 'admin',
  but the account_users table constraint only allows 'account_admin' and 'user'.

  This mismatch causes the RLS policy to fail when legitimate account admins
  try to invite new team members, resulting in:
  "new row violates row-level security policy for table account_users"

  ## Solution
  Update the `is_account_admin` function to check for the correct role:
  - Change from: role IN ('owner', 'admin')
  - Change to: role = 'account_admin'

  ## Security
  - Maintains SECURITY DEFINER to prevent infinite recursion
  - Preserves all existing security checks
  - Only fixes the role name mismatch
*/

-- ============================================================================
-- PART 1: Drop Dependent Policy
-- ============================================================================

DROP POLICY IF EXISTS "Authorized users can add account members" ON account_users;

-- ============================================================================
-- PART 2: Fix is_account_admin Function
-- ============================================================================

DROP FUNCTION IF EXISTS is_account_admin(uuid);

CREATE OR REPLACE FUNCTION is_account_admin(check_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  -- Check if current user is an account_admin of the specified account
  -- SECURITY DEFINER allows this to bypass RLS and break recursion
  -- NOTE: The role must be 'account_admin' to match the table constraint
  RETURN EXISTS (
    SELECT 1
    FROM account_users au
    JOIN users u ON u.id = au.user_id
    WHERE au.account_id = check_account_id
      AND u.auth_user_id = auth.uid()
      AND au.role = 'account_admin'
  );
END;
$$;

-- ============================================================================
-- PART 3: Recreate INSERT Policy with Fixed Function
-- ============================================================================

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