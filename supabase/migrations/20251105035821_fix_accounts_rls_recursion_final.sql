/*
  # Fix Infinite Recursion in Accounts RLS Policies

  1. Problem
    - The SELECT policy on accounts checks account_users
    - account_users has RLS policies that reference accounts
    - This creates circular dependency causing infinite recursion
  
  2. Solution
    - Use security definer function to bypass RLS when checking account membership
    - This breaks the circular dependency
    - Keep security tight with direct checks
*/

-- Create a security definer function to check if user is in account
-- This bypasses RLS and breaks the recursion cycle
CREATE OR REPLACE FUNCTION public.user_has_account_access(account_id_param uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  current_email text;
BEGIN
  -- Get current auth user id
  current_user_id := auth.uid();
  current_email := auth.jwt()->>'email';
  
  -- Check if user is agency owner
  IF EXISTS (
    SELECT 1 FROM accounts a
    JOIN agencies ag ON a.agency_id = ag.id
    WHERE a.id = account_id_param 
    AND ag.owner_email = current_email
  ) THEN
    RETURN true;
  END IF;
  
  -- Check if user is member of the account (bypasses RLS)
  IF EXISTS (
    SELECT 1 FROM account_users au
    JOIN users u ON au.user_id = u.id
    WHERE au.account_id = account_id_param
    AND u.auth_user_id = current_user_id
  ) THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Drop and recreate the accounts SELECT policy using the new function
DROP POLICY IF EXISTS "Agency owners can view accounts" ON accounts;

CREATE POLICY "Agency owners can view accounts" ON accounts
  FOR SELECT TO authenticated
  USING (
    user_has_account_access(id)
  );

-- Also update account_users policies to not reference accounts
DROP POLICY IF EXISTS "Users can view own account memberships" ON account_users;
DROP POLICY IF EXISTS "Agency owners can view account memberships" ON account_users;
DROP POLICY IF EXISTS "Agency owners can add account members" ON account_users;
DROP POLICY IF EXISTS "Agency owners can update account members" ON account_users;
DROP POLICY IF EXISTS "Agency owners can remove account members" ON account_users;

-- Recreate simpler account_users policies that don't cause recursion
CREATE POLICY "Users can view own account memberships" ON account_users
  FOR SELECT TO authenticated
  USING (
    user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
  );

CREATE POLICY "Agency owners can view account memberships" ON account_users
  FOR SELECT TO authenticated
  USING (
    -- Check agencies directly without going through accounts
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can add account members" ON account_users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can update account members" ON account_users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can remove account members" ON account_users
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt()->>'email')
    )
  );
