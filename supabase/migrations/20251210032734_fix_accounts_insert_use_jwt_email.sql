/*
  # Fix Accounts INSERT RLS - Use JWT Email Directly

  1. Problem
    - The helper function approach may have issues accessing auth context
    - Need to use JWT claims directly for reliable email access

  2. Solution
    - Update policies to use auth.jwt()->>'email' directly
    - This extracts email from the JWT token without database queries
    - More reliable in RLS context

  3. Security
    - Only agency owners can manage accounts in their agency
    - Email comparison is case-insensitive
*/

DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;

CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can update accounts"
  ON accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can delete accounts"
  ON accounts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(auth.jwt()->>'email')
    )
  );