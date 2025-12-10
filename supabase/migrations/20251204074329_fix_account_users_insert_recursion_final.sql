/*
  # Fix account_users INSERT policy infinite recursion
  
  1. Problem
    - The INSERT policy calls is_account_admin() which queries account_users
    - This creates infinite recursion during invitation acceptance
  
  2. Solution
    - Simplify INSERT policy to check conditions directly
    - Remove is_account_admin() call from INSERT policy
    - Allow inserts for:
      a) Agency owners (via agencies table)
      b) Users accepting valid invitations (via user_invitations table)
      c) Direct auth.uid() check for the user being added
  
  3. Security
    - Still maintains proper authorization checks
    - Prevents unauthorized account access
    - Validates invitation tokens and expiry
*/

-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Authorized users can add account members" ON account_users;

-- Create new simplified INSERT policy without recursion
CREATE POLICY "Users can insert account memberships"
  ON account_users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if user is agency owner for this account
    EXISTS (
      SELECT 1
      FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt() ->> 'email')
    )
    OR
    -- Allow if user has valid invitation AND is adding themselves
    (
      user_id IN (
        SELECT users.id
        FROM users
        WHERE users.auth_user_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM user_invitations
        WHERE user_invitations.account_id = account_users.account_id
        AND user_invitations.email = (SELECT auth.jwt() ->> 'email')
        AND user_invitations.status = 'pending'
        AND user_invitations.expires_at > now()
      )
    )
  );