/*
  # Fix Orphaned Auth Account Detection

  1. Changes
    - Update `get_user_auth_status` function to properly identify orphaned auth accounts
    - Only return has_auth=true when BOTH auth.users exists AND users profile is linked
    - If auth.users exists but no linked users profile, return has_auth=false
    - This allows invitation acceptance to work correctly for orphaned accounts

  2. What This Fixes
    - Users with orphaned auth.users records (from failed signups) can now accept invitations
    - The "already registered" message will only show for truly registered users
    - Orphaned accounts will be treated as new signups

  3. Security
    - Function remains SECURITY DEFINER for access to auth.users table
    - Still checks both auth.users and users tables
*/

-- Drop and recreate the function with correct orphaned account detection
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
  auth_user_record RECORD;
  user_profile_record RECORD;
BEGIN
  -- Check if there's an auth.users record with this email
  SELECT id INTO auth_user_record
  FROM auth.users
  WHERE email = user_email
  LIMIT 1;

  -- Check if there's a users profile record for this email
  SELECT id, auth_user_id INTO user_profile_record
  FROM users
  WHERE email = user_email
  LIMIT 1;

  -- Case 1: User profile exists with linked auth account
  IF user_profile_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      user_profile_record.id as user_id,
      TRUE as has_auth;
    RETURN;
  END IF;

  -- Case 2: User profile exists but NO linked auth (can accept invitation and link)
  IF user_profile_record.id IS NOT NULL AND user_profile_record.auth_user_id IS NULL THEN
    RETURN QUERY
    SELECT
      user_profile_record.id as user_id,
      FALSE as has_auth;
    RETURN;
  END IF;

  -- Case 3: Orphaned auth.users record (auth exists but no profile)
  -- This is a failed signup - treat as NEW user (has_auth = false)
  IF auth_user_record.id IS NOT NULL AND user_profile_record.id IS NULL THEN
    RETURN QUERY
    SELECT
      NULL::uuid as user_id,
      FALSE as has_auth;  -- Changed from TRUE to FALSE - this is the key fix
    RETURN;
  END IF;

  -- Case 4: No records at all - completely new user
  RETURN QUERY
  SELECT
    NULL::uuid as user_id,
    FALSE as has_auth;
END;
$$;
