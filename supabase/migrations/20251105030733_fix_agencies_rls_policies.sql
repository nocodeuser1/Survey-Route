/*
  # Fix RLS Policies for Agencies Table

  1. Changes
    - Add INSERT policy to allow authenticated users to create their own agency
    - Add SELECT policy to allow users to view their own agency
    - Add UPDATE policy to allow agency owners to update their agency
    - Add DELETE policy to allow agency owners to delete their agency
    
  2. Security
    - Users can only create agencies with their own email as owner
    - Users can only view/update/delete agencies where they are the owner
    - All policies verify authentication and ownership
*/

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can create own agency" ON agencies;
DROP POLICY IF EXISTS "Users can view own agency" ON agencies;
DROP POLICY IF EXISTS "Users can update own agency" ON agencies;
DROP POLICY IF EXISTS "Users can delete own agency" ON agencies;

-- Allow authenticated users to create an agency with their email as owner
CREATE POLICY "Users can create own agency"
  ON agencies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.jwt()->>'email' = owner_email
  );

-- Allow users to view their own agency
CREATE POLICY "Users can view own agency"
  ON agencies
  FOR SELECT
  TO authenticated
  USING (
    auth.jwt()->>'email' = owner_email
  );

-- Allow users to update their own agency
CREATE POLICY "Users can update own agency"
  ON agencies
  FOR UPDATE
  TO authenticated
  USING (
    auth.jwt()->>'email' = owner_email
  )
  WITH CHECK (
    auth.jwt()->>'email' = owner_email
  );

-- Allow users to delete their own agency
CREATE POLICY "Users can delete own agency"
  ON agencies
  FOR DELETE
  TO authenticated
  USING (
    auth.jwt()->>'email' = owner_email
  );
