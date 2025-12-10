/*
  # Fix Team Member Viewing with Security Definer Function

  ## Problem
  RLS policies that query users table within users table RLS cause infinite recursion.

  ## Solution
  1. Keep simple RLS on users table (users can only see themselves)
  2. Create a security definer function to get team members
  3. Update the app to use this function instead of direct queries

  ## Security
  - Function checks that user has access to the account
  - Only returns team members for accounts user belongs to
  - No sensitive data exposed
*/

-- Revert to simple RLS policy
DROP POLICY IF EXISTS "Users can view team members" ON users;

CREATE POLICY "Users can view own record"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- Create function to get team members for an account
CREATE OR REPLACE FUNCTION get_account_team_members(account_id_param UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  signature_completed BOOLEAN,
  joined_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Verify the caller has access to this account
  IF NOT EXISTS (
    SELECT 1 
    FROM account_users au
    INNER JOIN users u ON u.id = au.user_id
    WHERE au.account_id = account_id_param
      AND u.auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to this account';
  END IF;

  -- Return team members
  RETURN QUERY
  SELECT 
    u.id as user_id,
    u.email,
    u.full_name,
    au.role,
    u.signature_completed,
    au.joined_at
  FROM account_users au
  INNER JOIN users u ON u.id = au.user_id
  WHERE au.account_id = account_id_param
  ORDER BY au.joined_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_account_team_members(UUID) TO authenticated;
