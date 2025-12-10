/*
  # Fix Accounts INSERT RLS Policy - Comprehensive Fix

  1. Changes
    - Drop and recreate the INSERT policy for accounts table
    - Allow agency owners to create accounts for their agencies
    - Allow the create_agency_owner_account function to bypass RLS
    
  2. Security
    - Only agency owners can create accounts for their agencies
    - Validates that the user's email matches the agency owner_email
    
  3. Notes
    - Uses auth.email() function for reliable email checking
    - Ensures pending signup approval can create accounts properly
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
      WHERE agencies.id = agency_id
      AND agencies.owner_email = auth.email()
    )
  );

-- Ensure the create_agency_owner_account function can bypass RLS
-- This is needed for signup approval flow
CREATE OR REPLACE FUNCTION create_agency_owner_account(
  p_user_id uuid,
  p_agency_name text,
  p_account_name text,
  p_user_email text
)
RETURNS TABLE (
  agency_id uuid,
  account_id uuid
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_agency_id uuid;
  v_account_id uuid;
BEGIN
  -- Create agency
  INSERT INTO agencies (owner_email, name)
  VALUES (p_user_email, p_agency_name)
  RETURNING id INTO v_agency_id;

  -- Create default account
  INSERT INTO accounts (agency_id, account_name, created_by, status)
  VALUES (v_agency_id, p_account_name, p_user_id, 'active')
  RETURNING id INTO v_account_id;

  -- Add owner to account as admin
  INSERT INTO account_users (account_id, user_id, role)
  VALUES (v_account_id, p_user_id, 'account_admin')
  ON CONFLICT (account_id, user_id) DO NOTHING;

  RETURN QUERY SELECT v_agency_id, v_account_id;
END;
$$;
