/*
  # Fix get_account_team_members Function - Correct Column Name
  
  1. Changes
    - Fix the get_account_team_members function to use au.joined_at instead of au.created_at
    - The account_users table has a joined_at column, not created_at
    
  2. Impact
    - Fixes the error: "column au.created_at does not exist"
    - Team Management tab will now load correctly
*/

-- Drop existing function
DROP FUNCTION IF EXISTS get_account_team_members(uuid) CASCADE;

-- Create updated function with correct column name
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
    au.joined_at
  FROM users u
  INNER JOIN account_users au ON au.user_id = u.id
  WHERE au.account_id = target_account_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_account_team_members(UUID) TO authenticated;