/*
  # Fix Inspection Photos RLS to Use Account Access Function

  1. Changes
    - Drop existing RLS policies for inspection_photos
    - Create new policies using user_has_account_access() function
    - This matches the pattern used by inspections table
    - Ensures consistent access control across related tables

  2. Security
    - Uses the same security model as inspections
    - Checks both agency owner and account membership
    - Handles auth properly through security definer function
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their inspection photos" ON inspection_photos;
DROP POLICY IF EXISTS "Users can insert photos for their inspections" ON inspection_photos;
DROP POLICY IF EXISTS "Users can delete their inspection photos" ON inspection_photos;

-- Create new policies using the same function as inspections table
CREATE POLICY "Users can view their inspection photos"
  ON inspection_photos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE inspections.id = inspection_photos.inspection_id
      AND user_has_account_access(inspections.account_id)
    )
  );

CREATE POLICY "Users can insert photos for their inspections"
  ON inspection_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE inspections.id = inspection_photos.inspection_id
      AND user_has_account_access(inspections.account_id)
    )
  );

CREATE POLICY "Users can delete their inspection photos"
  ON inspection_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE inspections.id = inspection_photos.inspection_id
      AND user_has_account_access(inspections.account_id)
    )
  );
