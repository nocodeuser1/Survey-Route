/*
  # Fix Accounts INSERT RLS Policy for Agency Owners

  1. Changes
    - Drop and recreate the INSERT policy for accounts table
    - Allow agency owners to create accounts for their agencies
    - Use auth.jwt() instead of auth.email() for better compatibility
    
  2. Security
    - Only agency owners can create accounts for their agencies
    - Validates that the user's email matches the agency owner_email
    
  3. Notes
    - This fixes the "new row violates row-level security policy" error
    - Agency owners can now approve pending signup requests properly
*/

-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;

-- Create new INSERT policy that allows agency owners to create accounts
CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (auth.jwt() ->> 'email')
    )
  );
