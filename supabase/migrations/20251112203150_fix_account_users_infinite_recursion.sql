/*
  # Fix Infinite Recursion in account_users RLS Policies

  ## Problem
  The account_users INSERT policy checks account_users table to verify if user is an admin,
  causing infinite recursion: "infinite recursion detected in policy for relation account_users"

  ## Solution
  1. Create a helper function with SECURITY DEFINER to check if user is account admin
  2. Update INSERT policy to use this function instead of direct table query
  3. This breaks the recursion chain by using a privileged function

  ## Security
  - Function only checks if the current user is an admin of a specific account
  - Returns boolean, no data exposure
  - Uses auth.uid() to ensure correct user context
*/

-- Drop existing problematic policy
DROP POLICY IF EXISTS "Authorized users can add account members" ON account_users;

-- Create helper function to check if user is account admin (breaks recursion)
CREATE OR REPLACE FUNCTION is_account_admin(check_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

-- Create new INSERT policy using the helper function
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
    -- Case 2: Account admin adding member to their own account (using helper function)
    is_account_admin(account_users.account_id)
  );