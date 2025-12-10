/*
  # Fix User Invitations INSERT RLS Policy for Agency Owners

  1. Changes
    - Add policy to allow agency owners to insert invitations for accounts in their agency
    - This is needed for the pending signup approval flow
    
  2. Security
    - Only agency owners can create invitations for accounts in their agency
    - Validates that the user's email matches the agency owner_email
*/

-- Drop existing INSERT policy if it exists
DROP POLICY IF EXISTS "Agency owners can insert user_invitations for their agency accounts" ON user_invitations;

-- Create new INSERT policy that allows agency owners to create invitations
CREATE POLICY "Agency owners can insert user_invitations for their agency accounts"
  ON user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
      AND agencies.owner_email = auth.email()
    )
  );
