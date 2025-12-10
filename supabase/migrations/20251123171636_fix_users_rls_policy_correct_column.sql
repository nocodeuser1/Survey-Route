/*
  # Fix Users RLS Policy - Use Correct Column

  1. Issue
    - The "Users can view own record" policy was checking `id = (SELECT auth.uid())`
    - But auth.uid() returns the auth_user_id, not the users table id
    - This prevented users from loading their profile after sign-in

  2. Changes
    - Update policy to check `auth_user_id = (SELECT auth.uid())`
    - This allows users to view their own profile record correctly
*/

DROP POLICY IF EXISTS "Users can view own record" ON users;
CREATE POLICY "Users can view own record"
  ON users FOR SELECT
  TO authenticated
  USING (auth_user_id = (SELECT auth.uid()));