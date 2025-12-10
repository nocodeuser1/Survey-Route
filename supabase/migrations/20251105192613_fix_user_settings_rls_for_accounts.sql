/*
  # Fix User Settings RLS Policies for Multi-Tenant Architecture

  1. Changes
    - Drop old RLS policies that check user_id against users table
    - Create new RLS policies that check account_id against accounts table
    - Allow users to manage settings for accounts they created
  
  2. Security
    - Users can only access settings for accounts they own (created_by = auth.uid())
    - All CRUD operations are properly secured
*/

-- Drop old policies
DROP POLICY IF EXISTS "Users can view settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update settings" ON user_settings;
DROP POLICY IF EXISTS "Users can delete settings" ON user_settings;

-- Create new policies based on account ownership
CREATE POLICY "Users can view their account settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT id FROM accounts WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can insert their account settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT id FROM accounts WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update their account settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT id FROM accounts WHERE created_by = auth.uid()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT id FROM accounts WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete their account settings"
  ON user_settings FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT id FROM accounts WHERE created_by = auth.uid()
    )
  );
