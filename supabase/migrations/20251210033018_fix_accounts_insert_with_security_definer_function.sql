/*
  # Fix Accounts INSERT RLS - Security Definer Function

  1. Problem
    - Authenticated role cannot access auth.users table
    - RLS policies that join auth.users will fail

  2. Solution
    - Create a SECURITY DEFINER function that checks agency ownership
    - Function runs with elevated privileges to access auth.users
    - Policies use this function instead of direct joins

  3. Security
    - Function only returns boolean (no data exposure)
    - Uses auth.uid() for current user identification
*/

CREATE OR REPLACE FUNCTION public.is_agency_owner(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM agencies a
    JOIN auth.users u ON LOWER(a.owner_email) = LOWER(u.email)
    WHERE a.id = p_agency_id
    AND u.id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_agency_owner(uuid) TO authenticated;

DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;

CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (public.is_agency_owner(agency_id));

CREATE POLICY "Agency owners can update accounts"
  ON accounts FOR UPDATE
  TO authenticated
  USING (public.is_agency_owner(agency_id))
  WITH CHECK (public.is_agency_owner(agency_id));

CREATE POLICY "Agency owners can delete accounts"
  ON accounts FOR DELETE
  TO authenticated
  USING (public.is_agency_owner(agency_id));