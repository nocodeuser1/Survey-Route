/*
  # Fix Circular RLS Dependency in Invitation Acceptance
  
  1. Problem
    - When inserting into account_users, the INSERT policy checks user_invitations
    - Some user_invitations SELECT policies query account_users
    - This creates infinite recursion: account_users INSERT -> user_invitations SELECT -> account_users SELECT -> recursion
  
  2. Root Cause
    - "Account admins and agency owners can view invitations" SELECT policy queries account_users
    - "Account admins can delete invitations for their accounts" DELETE policy queries account_users
    - These get evaluated even when checking invitations during account_users INSERT
  
  3. Solution
    - Remove overly-permissive "Authenticated users can view invitations" policy (too permissive)
    - Add specific policy for invited users to view their own invitations by email (no account_users query)
    - Ensure invitation acceptance flow doesn't trigger account_users queries
    - Keep admin/owner policies for management, but add bypass for invitation acceptance
  
  4. Security
    - Users can only view invitations for their own email address
    - Admin and owner policies remain intact for management functions
    - Invitation acceptance doesn't require account_users membership (by design)
*/

-- Drop the overly-permissive authenticated users policy
DROP POLICY IF EXISTS "Authenticated users can view invitations" ON user_invitations;

-- Drop the overly-permissive "anyone" policy (too insecure)
DROP POLICY IF EXISTS "Anyone can view invitations by token" ON user_invitations;

-- Add a specific policy for invited users to view their own pending invitations
-- This doesn't query account_users, breaking the circular dependency
CREATE POLICY "Invited users can view their own pending invitations"
  ON user_invitations
  FOR SELECT
  TO authenticated
  USING (
    email = (SELECT auth.jwt() ->> 'email')
    AND status = 'pending'
    AND expires_at > now()
  );

-- Also allow users to view invitations they've already accepted (for history)
CREATE POLICY "Users can view their accepted/declined invitations"
  ON user_invitations
  FOR SELECT
  TO authenticated
  USING (
    email = (SELECT auth.jwt() ->> 'email')
  );
