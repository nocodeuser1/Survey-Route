/*
  # Fix Accounts INSERT RLS - Use auth.uid() with Join

  1. Problem
    - JWT email extraction may have issues
    - Need to use auth.uid() which is always reliable

  2. Solution
    - Join agencies with auth.users using owner_email
    - Compare auth.uid() with the user id from auth.users
    - This is more reliable as auth.uid() is always in JWT

  3. Security
    - Only agency owners can manage accounts in their agency
*/

DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;

CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM agencies a
      JOIN auth.users u ON LOWER(a.owner_email) = LOWER(u.email)
      WHERE a.id = accounts.agency_id
      AND u.id = auth.uid()
    )
  );

CREATE POLICY "Agency owners can update accounts"
  ON accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM agencies a
      JOIN auth.users u ON LOWER(a.owner_email) = LOWER(u.email)
      WHERE a.id = accounts.agency_id
      AND u.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM agencies a
      JOIN auth.users u ON LOWER(a.owner_email) = LOWER(u.email)
      WHERE a.id = accounts.agency_id
      AND u.id = auth.uid()
    )
  );

CREATE POLICY "Agency owners can delete accounts"
  ON accounts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM agencies a
      JOIN auth.users u ON LOWER(a.owner_email) = LOWER(u.email)
      WHERE a.id = accounts.agency_id
      AND u.id = auth.uid()
    )
  );