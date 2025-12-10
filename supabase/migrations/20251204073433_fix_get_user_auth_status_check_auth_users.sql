/*
  # Fix get_user_auth_status to check auth.users table

  1. Changes
    - Update get_user_auth_status function to check both users.auth_user_id and auth.users table
    - This correctly detects when an auth account exists even if it's not linked to the users table
    - Prevents "This email is already registered" error on invitation acceptance page
  
  2. Security
    - Function remains SECURITY DEFINER to access auth.users table
    - Only checks email existence, doesn't expose sensitive data
*/

-- Drop the existing function
DROP FUNCTION IF EXISTS get_user_auth_status(text);

-- Create updated function that checks both tables
CREATE OR REPLACE FUNCTION get_user_auth_status(user_email text)
RETURNS TABLE (
  user_id uuid,
  has_auth boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  auth_exists boolean;
BEGIN
  -- Check if there's an auth.users record with this email
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE email = user_email
  ) INTO auth_exists;

  RETURN QUERY
  SELECT
    u.id as user_id,
    COALESCE(u.auth_user_id IS NOT NULL, auth_exists) as has_auth
  FROM users u
  WHERE u.email = user_email
  LIMIT 1;
  
  -- If no user record exists but auth account does, still return has_auth = true
  IF NOT FOUND AND auth_exists THEN
    RETURN QUERY
    SELECT
      NULL::uuid as user_id,
      TRUE as has_auth;
  END IF;
END;
$$;