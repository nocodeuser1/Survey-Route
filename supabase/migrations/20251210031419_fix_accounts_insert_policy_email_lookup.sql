/*
  # Fix Accounts INSERT RLS Policy

  1. Problem
    - Current policy uses auth.jwt()->>'email' which returns null in some contexts
    - This prevents agency owners from creating new accounts

  2. Solution
    - Create a helper function to reliably get email from auth.users
    - Update the INSERT policy to use this function instead

  3. Security
    - Only agency owners can create accounts in their agency
    - Uses direct lookup to auth.users table for reliable email retrieval
*/

CREATE OR REPLACE FUNCTION public.get_auth_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;

CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = public.get_auth_user_email()
    )
  );

DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;

CREATE POLICY "Agency owners can update accounts"
  ON accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = public.get_auth_user_email()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = public.get_auth_user_email()
    )
  );

DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;

CREATE POLICY "Agency owners can delete accounts"
  ON accounts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = public.get_auth_user_email()
    )
  );