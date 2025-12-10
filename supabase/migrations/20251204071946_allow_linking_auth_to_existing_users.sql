/*
  # Allow Linking Auth Credentials to Existing Users

  1. New Policy
    - "Users can link auth to unlinked accounts" - Allows users to update their auth_user_id
      when accepting invitations for user records that exist but have no auth credentials
      
  2. Security
    - Only allows update when auth_user_id is currently NULL (unlinked user)
    - User can only set auth_user_id to their own auth.uid()
    - This enables the invitation flow for users who were created but never completed signup
    
  3. Use Case
    - When a user is invited but user record already exists without auth credentials
    - User creates password (gets auth.uid())
    - System needs to link the new auth credentials to existing user record
*/

-- Allow users to link their auth credentials to existing user records without auth
CREATE POLICY "Users can link auth to unlinked accounts"
  ON users FOR UPDATE
  TO authenticated
  USING (auth_user_id IS NULL)
  WITH CHECK (auth_user_id = (SELECT auth.uid()));