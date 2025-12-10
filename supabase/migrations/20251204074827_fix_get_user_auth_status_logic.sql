/*
  # Fix get_user_auth_status function logic

  1. Changes
    - Fix boolean logic in get_user_auth_status function
    - COALESCE doesn't work correctly with boolean expressions - need to use OR instead
    - This ensures has_auth returns true when auth account exists
  
  2. Testing
    - Function should return has_auth=true for users with auth accounts
    - This fixes the invitation acceptance flow
*/

-- Drop and recreate the function with correct logic
DROP FUNCTION IF EXISTS get_user_auth_status(text);

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
    (u.auth_user_id IS NOT NULL OR auth_exists) as has_auth
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
