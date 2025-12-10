/*
  # Add Function to Find User by Email

  ## Purpose
  Allow account admins to find a user by email when adding team members,
  without exposing all user data through RLS.

  ## Security
  - Function is SECURITY DEFINER (runs with elevated privileges)
  - Only returns user_id, nothing sensitive
  - Can only be called by authenticated users
  - Returns NULL if user doesn't exist

  ## Usage
  Used by team management to check if user exists before creating new account
*/

-- Create function to find user ID by email
CREATE OR REPLACE FUNCTION get_user_id_by_email(user_email TEXT)
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT id 
    FROM users 
    WHERE email = user_email
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_user_id_by_email(TEXT) TO authenticated;
