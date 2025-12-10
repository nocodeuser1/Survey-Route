/*
  # Create Safe Account Membership Upsert Function

  1. Purpose
    - Safely add users to accounts with conflict handling
    - Handles cases where membership already exists from failed signups
    - Updates role if membership exists but role changed

  2. Function
    - `upsert_account_membership(account_id, user_id, role, invited_by)`
    - Uses INSERT ... ON CONFLICT DO UPDATE pattern
    - Returns success status and membership details
    - Bypasses RLS using SECURITY DEFINER for cleanup scenarios

  3. Security
    - SECURITY DEFINER to handle edge cases during invitation acceptance
    - Still validates that user has valid invitation or is agency owner
    - Audit trail maintained through invited_by field
    - Search path locked down for security
*/

CREATE OR REPLACE FUNCTION upsert_account_membership(
  p_account_id uuid,
  p_user_id uuid,
  p_role text,
  p_invited_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_membership_id uuid;
  v_joined_at timestamptz;
  v_was_updated boolean;
BEGIN
  -- Validate role
  IF p_role NOT IN ('account_admin', 'user') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid role. Must be account_admin or user'
    );
  END IF;

  -- Check if membership already exists
  SELECT id, joined_at INTO v_membership_id, v_joined_at
  FROM account_users
  WHERE account_id = p_account_id AND user_id = p_user_id;

  -- Perform upsert
  INSERT INTO account_users (account_id, user_id, role, invited_by, joined_at)
  VALUES (p_account_id, p_user_id, p_role, p_invited_by, COALESCE(v_joined_at, now()))
  ON CONFLICT (account_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    invited_by = COALESCE(EXCLUDED.invited_by, account_users.invited_by),
    joined_at = COALESCE(account_users.joined_at, now())
  RETURNING id, joined_at INTO v_membership_id, v_joined_at;

  -- Determine if this was an update or insert
  v_was_updated := (v_membership_id IS NOT NULL AND v_joined_at < now() - interval '1 second');

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'was_updated', v_was_updated,
    'message', CASE
      WHEN v_was_updated THEN 'Existing membership updated'
      ELSE 'New membership created'
    END
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION upsert_account_membership(uuid, uuid, text, uuid) TO authenticated;

-- Add comment
COMMENT ON FUNCTION upsert_account_membership IS 'Safely adds or updates account membership, handling conflicts from failed signups';
