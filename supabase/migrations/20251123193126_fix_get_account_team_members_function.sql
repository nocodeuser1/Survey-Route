/*
  # Fix get_account_team_members Function

  1. Changes
    - Update the get_account_team_members function to return all required fields
    - Add signature_completed and joined_at to the return type
    - Fixes the error: "Could not find the function public.get_account_team_members(account_id_param) in the schema cache"

  2. Fields Returned
    - user_id (uuid)
    - email (text)
    - full_name (text)
    - role (text)
    - signature_completed (boolean)
    - joined_at (timestamptz)
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_account_team_members(uuid) CASCADE;

-- Create updated function with all required fields
CREATE FUNCTION get_account_team_members(target_account_id uuid)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text,
  signature_completed boolean,
  joined_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.full_name,
    au.role,
    u.signature_completed,
    au.created_at
  FROM users u
  INNER JOIN account_users au ON au.user_id = u.id
  WHERE au.account_id = target_account_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_account_team_members(UUID) TO authenticated;
