/*
  # Fix Accounts INSERT RLS - Search Path and Case Sensitivity

  1. Problem
    - The get_auth_user_email() function has search_path set to 'public' only
    - This may prevent access to auth.uid() function
    - Email comparison is case-sensitive which could cause mismatches

  2. Solution
    - Drop dependent policies first
    - Recreate the helper function with proper search_path including auth schema
    - Recreate policies with case-insensitive email comparison

  3. Security
    - Function remains SECURITY DEFINER to access auth.users
    - Only agency owners can manage accounts in their agency
*/

DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;

DROP FUNCTION IF EXISTS public.get_auth_user_email();

CREATE OR REPLACE FUNCTION public.get_auth_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_user_email() TO authenticated;

CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(public.get_auth_user_email())
    )
  );

CREATE POLICY "Agency owners can update accounts"
  ON accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(public.get_auth_user_email())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(public.get_auth_user_email())
    )
  );

CREATE POLICY "Agency owners can delete accounts"
  ON accounts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND LOWER(agencies.owner_email) = LOWER(public.get_auth_user_email())
    )
  );