/*
  # Add User Auth Status Function for Invitation Flow

  1. New Function
    - `get_user_auth_status` - Returns user_id and whether user has auth credentials
      - Used to distinguish between users who exist but never set up auth vs users who are fully registered
      - Critical for proper invitation acceptance flow

  2. Security
    - Function is SECURITY DEFINER to allow checking user existence without authentication
    - Returns minimal data (just ID and boolean) to avoid exposing sensitive information
*/

-- Create function to check if user exists and has auth credentials
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
BEGIN
  RETURN QUERY
  SELECT
    u.id as user_id,
    (u.auth_user_id IS NOT NULL) as has_auth
  FROM users u
  WHERE u.email = user_email
  LIMIT 1;
END;
$$;