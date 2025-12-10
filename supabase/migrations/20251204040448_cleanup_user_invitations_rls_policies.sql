/*
  # Cleanup User Invitations RLS Policies

  1. Problem
    - Multiple duplicate policies exist for user_invitations table
    - Some policies check for wrong role name ('admin' instead of 'account_admin')
    - Duplicate SELECT, UPDATE, and DELETE policies causing confusion

  2. Changes
    - Drop all old/duplicate policies with incorrect role checks
    - Keep only the correct policies that check for 'account_admin' role
    - Ensure clean, non-conflicting set of policies

  3. Security
    - After cleanup, only proper account_admins and agency owners can access invitations
    - Maintains security while fixing access issues
*/

-- Drop old SELECT policy with wrong role name
DROP POLICY IF EXISTS "Account admins can view invitations for their accounts" ON user_invitations;

-- Drop old UPDATE policy with wrong role name
DROP POLICY IF EXISTS "Account admins can update invitations" ON user_invitations;

-- Drop duplicate DELETE policy (we keep the one from the comprehensive fix)
DROP POLICY IF EXISTS "Authorized users can delete invitations" ON user_invitations;

-- Verify the correct policies remain:
-- ✓ "Account admins and agency owners can view invitations" (SELECT with account_admin)
-- ✓ "Account admins and agency owners can create invitations" (INSERT with account_admin)
-- ✓ "Account admins can update invitations for their account" (UPDATE with account_admin)
-- ✓ "Account admins can delete invitations for their accounts" (DELETE with account_admin)
-- ✓ "Agency owners can view all invitations in their agency" (SELECT for agency owners)
-- ✓ "Agency owners can delete invitations for their agency" (DELETE for agency owners)
-- ✓ "Anyone can view invitations by token" (SELECT for anon users with token)
-- ✓ "Invited users can accept their invitations" (UPDATE for accepting invitations)
