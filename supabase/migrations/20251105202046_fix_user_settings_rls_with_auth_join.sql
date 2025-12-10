/*
  # Fix User Settings RLS Policies with Proper Auth User Join

  1. Changes
    - Drop current RLS policies that only check created_by
    - Create new RLS policies that properly join accounts -> users -> auth.uid()
    - This fixes the relationship: auth.uid() -> users.auth_user_id -> users.id -> accounts.created_by
  
  2. Security
    - Users can only access settings for accounts they own (through proper auth chain)
    - All CRUD operations are properly secured
*/

-- Drop current policies
DROP POLICY IF EXISTS "Users can view their account settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert their account settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update their account settings" ON user_settings;
DROP POLICY IF EXISTS "Users can delete their account settings" ON user_settings;

-- Create new policies with proper auth user join
CREATE POLICY "Users can view their account settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT a.id 
      FROM accounts a
      JOIN users u ON a.created_by = u.id
      WHERE u.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their account settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT a.id 
      FROM accounts a
      JOIN users u ON a.created_by = u.id
      WHERE u.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their account settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT a.id 
      FROM accounts a
      JOIN users u ON a.created_by = u.id
      WHERE u.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT a.id 
      FROM accounts a
      JOIN users u ON a.created_by = u.id
      WHERE u.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their account settings"
  ON user_settings FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT a.id 
      FROM accounts a
      JOIN users u ON a.created_by = u.id
      WHERE u.auth_user_id = auth.uid()
    )
  );
