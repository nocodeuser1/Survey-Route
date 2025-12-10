/*
  # Fix Accounts INSERT RLS Policy - Comprehensive Fix

  1. Changes
    - Drop and recreate the INSERT policy for accounts table
    - Allow agency owners to create accounts for their agencies
    - Use both auth.jwt() email check and users table lookup for flexibility
    
  2. Security
    - Only agency owners can create accounts for their agencies
    - Validates that either:
      a) The JWT email matches the agency owner_email, OR
      b) The creating user's email matches the agency owner_email
    
  3. Notes
    - This ensures pending signup approval works correctly
    - Handles both direct agency owner actions and delegated actions
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
      AND (
        agencies.owner_email = (auth.jwt() ->> 'email')
        OR agencies.owner_email = (
          SELECT email FROM users WHERE id = accounts.created_by
        )
      )
    )
  );
