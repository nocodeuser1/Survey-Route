/*
  # Remove Duplicate DELETE Policy on account_users

  ## Issue
  There are two DELETE policies on account_users table:
  1. "Agency owners can remove account members" - older policy
  2. "Users can delete team members in their accounts" - newer, more comprehensive policy

  ## Solution
  Remove the older "Agency owners can remove account members" policy since the newer policy
  already includes agency owner functionality plus additional safety checks.

  ## Security
  The remaining policy ensures:
  - Only account admins can delete members
  - Agency owners cannot be removed from accounts
*/

-- Remove duplicate DELETE policy
DROP POLICY IF EXISTS "Agency owners can remove account members" ON account_users;

-- Keep only: "Users can delete team members in their accounts"
-- This policy already covers both account admins AND prevents removing agency owners
