/*
  # Fix Inspection Photos RLS Policies

  1. Changes
    - Drop existing RLS policies that have complex subqueries
    - Create simpler policies that directly check inspection ownership
    - Ensure users can insert/view/delete photos for inspections they own

  2. Security
    - Users can only access photos for inspections in their account
    - Authenticated users only
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own inspection photos" ON inspection_photos;
DROP POLICY IF EXISTS "Users can insert photos for their inspections" ON inspection_photos;
DROP POLICY IF EXISTS "Users can delete their inspection photos" ON inspection_photos;

-- Create new simplified policies
CREATE POLICY "Users can view their inspection photos"
  ON inspection_photos FOR SELECT
  TO authenticated
  USING (
    inspection_id IN (
      SELECT i.id FROM inspections i
      INNER JOIN account_users au ON au.account_id = i.account_id
      WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert photos for their inspections"
  ON inspection_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    inspection_id IN (
      SELECT i.id FROM inspections i
      INNER JOIN account_users au ON au.account_id = i.account_id
      WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their inspection photos"
  ON inspection_photos FOR DELETE
  TO authenticated
  USING (
    inspection_id IN (
      SELECT i.id FROM inspections i
      INNER JOIN account_users au ON au.account_id = i.account_id
      WHERE au.user_id = auth.uid()
    )
  );
