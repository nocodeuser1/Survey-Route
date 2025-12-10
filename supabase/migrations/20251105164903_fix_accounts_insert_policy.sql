/*
  # Fix Accounts INSERT RLS Policy

  1. Changes
    - Update the INSERT policy for accounts table to properly check agency ownership
    - Use auth.email() function instead of JWT parsing
    
  2. Security
    - Only agency owners can create accounts for their agencies
    - Validates that the authenticated user's email matches the agency owner_email
*/

-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;

-- Create improved INSERT policy
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