/*
  # Fix Infinite Recursion in RLS Policies - Comprehensive Solution

  ## Problem
  Multiple RLS policies create infinite recursion by querying the same table they protect:
  1. users table SELECT policy uses wrong column (id instead of auth_user_id)
  2. account_users INSERT policy queries account_users table within itself
  3. account_users DELETE policy queries account_users table within itself
  4. Missing basic account_users SELECT policy for users to view their own memberships

  ## Solution
  1. Fix users table SELECT policy to use correct column (auth_user_id)
  2. Add non-recursive account_users SELECT policy for user's own memberships
  3. Rewrite account_users INSERT policy to avoid self-referential queries
  4. Rewrite account_users DELETE policy to avoid self-referential queries
  5. Use agencies table and user_invitations table for authorization checks

  ## Security
  - Users can only see their own profile
  - Users can only see their own account memberships
  - Agency owners can see all memberships in their agency
  - Users can only insert themselves when they have valid invitations
  - Only agency owners can delete team members
  - All policies avoid circular table references

  ## Changes
  1. Users table: Fix SELECT policy
  2. account_users table: Add SELECT policy for own memberships
  3. account_users table: Fix INSERT policy (no recursion)
  4. account_users table: Fix DELETE policy (no recursion)
*/

-- ============================================================================
-- PART 1: Fix Users Table SELECT Policy
-- ============================================================================

-- Drop incorrect policy that checks users.id = auth.uid()
DROP POLICY IF EXISTS "Users can view own record" ON users;

-- Create correct policy that checks users.auth_user_id = auth.uid()
CREATE POLICY "Users can view own record"
  ON users FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- ============================================================================
-- PART 2: Fix account_users SELECT Policies
-- ============================================================================

-- Drop any existing SELECT policies
DROP POLICY IF EXISTS "Users can view own account memberships" ON account_users;
DROP POLICY IF EXISTS "Users can view their account memberships" ON account_users;
DROP POLICY IF EXISTS "Agency owners can view account memberships" ON account_users;

-- Allow users to view their own memberships (no recursion)
CREATE POLICY "Users can view own account memberships"
  ON account_users FOR SELECT
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = auth.uid()
    )
  );

-- Allow agency owners to view all memberships in their agency (no recursion)
CREATE POLICY "Agency owners can view account memberships"
  ON account_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

-- ============================================================================
-- PART 3: Fix account_users INSERT Policy (No Recursion)
-- ============================================================================

-- Drop all existing INSERT policies
DROP POLICY IF EXISTS "Authorized users can add account members" ON account_users;
DROP POLICY IF EXISTS "Users can insert account memberships" ON account_users;

-- Create new INSERT policy without querying account_users table
CREATE POLICY "Users can insert account memberships"
  ON account_users FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Path 1: Agency owners can add members to accounts in their agency
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
    OR
    -- Path 2: Users can add themselves if they have a valid pending invitation
    (
      user_id IN (
        SELECT id FROM users WHERE auth_user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM user_invitations
        WHERE user_invitations.account_id = account_users.account_id
        AND user_invitations.email = (SELECT auth.jwt()->>'email')
        AND user_invitations.status = 'pending'
        AND user_invitations.expires_at > now()
      )
    )
  );

-- ============================================================================
-- PART 4: Fix account_users DELETE Policy (No Recursion)
-- ============================================================================

-- Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can delete team members in their accounts" ON account_users;

-- Create new DELETE policy without querying account_users table
-- Only agency owners can delete team members to avoid complexity
CREATE POLICY "Agency owners can delete account members"
  ON account_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

-- ============================================================================
-- PART 5: Update Helper Function (if needed for future use)
-- ============================================================================

-- The is_account_admin function can stay for other uses, but we don't use it
-- in the policies above to avoid recursion
-- Recreate with proper configuration
DROP FUNCTION IF EXISTS is_account_admin(uuid);

CREATE OR REPLACE FUNCTION is_account_admin(check_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  -- This function uses SECURITY DEFINER to bypass RLS
  -- Safe to use when called from application code, but avoided in RLS policies
  RETURN EXISTS (
    SELECT 1
    FROM account_users au
    INNER JOIN users u ON u.id = au.user_id
    WHERE au.account_id = check_account_id
    AND u.auth_user_id = auth.uid()
    AND au.role IN ('owner', 'admin', 'account_admin')
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_account_admin(uuid) TO authenticated;
