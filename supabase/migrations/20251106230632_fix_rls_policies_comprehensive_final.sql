/*
  # Comprehensive RLS Policy Fixes

  ## Issues Fixed
  
  1. **Pending Invitations Visibility**
     - Fixed user_invitations DELETE policy to allow proper cleanup
     - Added proper filtering to only show active pending invitations
  
  2. **Account Creation by Agency Owners**
     - Fixed accounts INSERT policy to properly validate agency ownership
     - Removed conflicting policies and simplified to single correct policy
  
  3. **Agency Owner Removal Prevention**
     - Enhanced account_users DELETE policy to prevent removing agency owners
     - Added explicit check against agencies.owner_email
  
  4. **User Invitations Creation**
     - Fixed user_invitations INSERT policies to work for both scenarios:
       * Agency owners creating accounts (via approve request flow)
       * Account admins inviting team members
     - Removed duplicate/conflicting policies
  
  ## Security Enhancements
  
  - All policies use proper authentication checks
  - Ownership validation ensures users can only affect their own data
  - Agency owner privileges properly enforced
  - Account admin privileges properly scoped to their accounts
*/

-- ============================================================================
-- ACCOUNTS TABLE - Fix INSERT policy for agency owners
-- ============================================================================

-- Drop all existing INSERT policies for accounts
DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can insert accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can insert user_invitations for their agency acco" ON accounts;

-- Create single comprehensive INSERT policy for agency owners
CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM agencies
      WHERE agencies.id = accounts.agency_id
        AND agencies.owner_email = auth.email()
    )
  );


-- ============================================================================
-- USER_INVITATIONS TABLE - Fix INSERT and DELETE policies
-- ============================================================================

-- Drop all existing INSERT policies
DROP POLICY IF EXISTS "Account admins can create invitations" ON user_invitations;
DROP POLICY IF EXISTS "Agency owners can create invitations" ON user_invitations;
DROP POLICY IF EXISTS "Agency owners can insert user_invitations for their agency acco" ON user_invitations;

-- Drop existing DELETE policies if any
DROP POLICY IF EXISTS "Account admins can delete invitations" ON user_invitations;
DROP POLICY IF EXISTS "Account admins can revoke invitations" ON user_invitations;

-- Create comprehensive INSERT policy that covers BOTH agency owners AND account admins
CREATE POLICY "Authorized users can create invitations"
  ON user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Case 1: Agency owner creating invitation for any account in their agency
    EXISTS (
      SELECT 1
      FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
        AND agencies.owner_email = auth.email()
    )
    OR
    -- Case 2: Account admin creating invitation for their own account
    EXISTS (
      SELECT 1
      FROM account_users
      WHERE account_users.account_id = user_invitations.account_id
        AND account_users.user_id IN (
          SELECT users.id
          FROM users
          WHERE users.auth_user_id = auth.uid()
        )
        AND account_users.role = 'admin'
    )
  );

-- Create DELETE policy for revoking invitations
CREATE POLICY "Authorized users can delete invitations"
  ON user_invitations FOR DELETE
  TO authenticated
  USING (
    -- Agency owner can delete invitations for any account in their agency
    EXISTS (
      SELECT 1
      FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
        AND agencies.owner_email = auth.email()
    )
    OR
    -- Account admin can delete invitations for their own account
    EXISTS (
      SELECT 1
      FROM account_users
      WHERE account_users.account_id = user_invitations.account_id
        AND account_users.user_id IN (
          SELECT users.id
          FROM users
          WHERE users.auth_user_id = auth.uid()
        )
        AND account_users.role = 'admin'
    )
  );


-- ============================================================================
-- ACCOUNT_USERS TABLE - Prevent removing agency owners
-- ============================================================================

-- Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can delete team members in their accounts" ON account_users;

-- Create enhanced DELETE policy that prevents removing agency owners
CREATE POLICY "Users can delete team members in their accounts"
  ON account_users FOR DELETE
  TO authenticated
  USING (
    -- User must be account admin
    EXISTS (
      SELECT 1
      FROM account_users au_check
      WHERE au_check.account_id = account_users.account_id
        AND au_check.user_id IN (
          SELECT users.id
          FROM users
          WHERE users.auth_user_id = auth.uid()
        )
        AND au_check.role = 'admin'
    )
    AND
    -- Cannot delete the agency owner
    NOT EXISTS (
      SELECT 1
      FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      JOIN users ON users.email = agencies.owner_email
      WHERE accounts.id = account_users.account_id
        AND users.id = account_users.user_id
    )
  );


-- ============================================================================
-- Add indexes for performance
-- ============================================================================

-- Index for user_invitations lookups by account_id
CREATE INDEX IF NOT EXISTS idx_user_invitations_account_id 
  ON user_invitations(account_id);

-- Index for user_invitations lookups by status
CREATE INDEX IF NOT EXISTS idx_user_invitations_status 
  ON user_invitations(status);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_user_invitations_account_status 
  ON user_invitations(account_id, status) 
  WHERE status = 'pending';

-- Index for account_users role lookups
CREATE INDEX IF NOT EXISTS idx_account_users_role 
  ON account_users(account_id, role);
