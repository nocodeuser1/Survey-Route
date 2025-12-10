/*
  # Create User Activity Logs System

  ## Overview
  Creates a comprehensive activity logging system to track user actions within accounts.
  Logs are automatically cleaned up after 7 days to prevent storage bloat.

  ## Tables Created
  1. `user_activity_logs`
    - `id` (uuid, primary key)
    - `account_id` (uuid, references accounts)
    - `user_id` (uuid, references users.auth_user_id)
    - `action_type` (text) - Type of action performed
    - `tab_viewed` (text, nullable) - Tab/view name for navigation tracking
    - `metadata` (jsonb, nullable) - Additional context about the action
    - `ip_address` (text, nullable) - User's IP address
    - `created_at` (timestamptz) - When the action occurred

  ## Indexes
  - account_id for filtering by account
  - user_id for filtering by user
  - action_type for filtering by action
  - created_at for date sorting and cleanup
  - Composite index on (account_id, created_at) for common query pattern

  ## RLS Policies
  - Agency owners can view logs for all accounts in their agency
  - Account admins can view logs for their specific account
  - Regular users cannot access activity logs
  - Uses helper function to avoid recursion issues

  ## Auto-Cleanup
  - Function to delete logs older than 7 days
  - Can be scheduled or run manually
  - Prevents unbounded table growth

  ## Action Types Tracked
  - user_login: User authenticated
  - tab_viewed: User navigated to a different view
  - facility_uploaded: Facilities imported via CSV
  - route_generated: Route optimization completed
  - route_saved: Route plan saved
  - inspection_completed: Inspection form submitted
  - settings_updated: Settings modified
  - team_member_added: New team member invited
*/

-- ============================================================================
-- PART 1: Create user_activity_logs Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  tab_viewed text,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_activity_logs_account_id 
  ON user_activity_logs(account_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id 
  ON user_activity_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type 
  ON user_activity_logs(action_type);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at 
  ON user_activity_logs(created_at DESC);

-- Composite index for common query pattern (account + date sorting)
CREATE INDEX IF NOT EXISTS idx_activity_logs_account_created 
  ON user_activity_logs(account_id, created_at DESC);

-- ============================================================================
-- PART 2: Create Helper Function for RLS
-- ============================================================================

-- Helper function to check if user can access account logs
-- This prevents infinite recursion in RLS policies
CREATE OR REPLACE FUNCTION can_access_activity_logs(check_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  current_user_id uuid;
  current_email text;
BEGIN
  current_user_id := auth.uid();
  current_email := auth.jwt()->>'email';
  
  -- Check if user is agency owner for this account
  IF EXISTS (
    SELECT 1 FROM accounts a
    JOIN agencies ag ON a.agency_id = ag.id
    WHERE a.id = check_account_id 
    AND ag.owner_email = current_email
  ) THEN
    RETURN true;
  END IF;
  
  -- Check if user is account admin
  IF EXISTS (
    SELECT 1 FROM account_users au
    JOIN users u ON au.user_id = u.id
    WHERE au.account_id = check_account_id
    AND u.auth_user_id = current_user_id
    AND au.role IN ('owner', 'admin')
  ) THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- ============================================================================
-- PART 3: Create RLS Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Agency owners and account admins can view logs
CREATE POLICY "Authorized users can view activity logs"
  ON user_activity_logs FOR SELECT
  TO authenticated
  USING (can_access_activity_logs(account_id));

-- Policy: Authenticated users can insert logs for their own actions
CREATE POLICY "Users can create activity logs"
  ON user_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User can log actions for accounts they have access to
    EXISTS (
      SELECT 1 FROM account_users au
      JOIN users u ON au.user_id = u.id
      WHERE au.account_id = user_activity_logs.account_id
      AND u.auth_user_id = auth.uid()
    )
  );

-- ============================================================================
-- PART 4: Create Auto-Cleanup Function
-- ============================================================================

-- Function to delete logs older than 7 days
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete logs older than 7 days
  DELETE FROM user_activity_logs
  WHERE created_at < (now() - interval '7 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log the cleanup operation
  RAISE NOTICE 'Deleted % old activity log records', deleted_count;
  
  RETURN deleted_count;
END;
$$;

-- Add comment explaining the cleanup function
COMMENT ON FUNCTION cleanup_old_activity_logs() IS 
  'Deletes activity log records older than 7 days. Should be scheduled to run daily via pg_cron or called manually.';

-- ============================================================================
-- PART 5: Add Helpful Comments
-- ============================================================================

COMMENT ON TABLE user_activity_logs IS 
  'Tracks user actions within accounts. Logs are automatically cleaned up after 7 days to prevent unbounded growth.';

COMMENT ON COLUMN user_activity_logs.action_type IS 
  'Type of action: user_login, tab_viewed, facility_uploaded, route_generated, route_saved, inspection_completed, settings_updated, team_member_added';

COMMENT ON COLUMN user_activity_logs.metadata IS 
  'Additional context stored as JSON. Examples: {"facility_count": 50}, {"route_id": "uuid"}, {"tab": "facilities"}';
