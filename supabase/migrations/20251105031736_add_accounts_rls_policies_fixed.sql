/*
  # Add RLS Policies for Accounts Table

  1. Changes
    - Add INSERT policy to allow agency owners to create accounts for their agency
    - Add SELECT policy to allow agency owners to view accounts in their agency
    - Add UPDATE policy to allow agency owners to update accounts in their agency
    - Add DELETE policy to allow agency owners to delete accounts in their agency
    
  2. Security
    - Agency owners can only create/manage accounts that belong to their agency
    - Verified by checking the agency's owner_email matches the authenticated user's email
    - All policies verify authentication and agency ownership
*/

-- Drop existing policies if any
DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can view accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;

-- Allow agency owners to create accounts for their agency
CREATE POLICY "Agency owners can create accounts"
  ON accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = auth.jwt()->>'email'
    )
  );

-- Allow agency owners to view accounts in their agency
CREATE POLICY "Agency owners can view accounts"
  ON accounts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = auth.jwt()->>'email'
    )
  );

-- Allow agency owners to update accounts in their agency
CREATE POLICY "Agency owners can update accounts"
  ON accounts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = auth.jwt()->>'email'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = auth.jwt()->>'email'
    )
  );

-- Allow agency owners to delete accounts in their agency
CREATE POLICY "Agency owners can delete accounts"
  ON accounts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = auth.jwt()->>'email'
    )
  );
