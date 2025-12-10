/*
  # Fix Performance and Security Issues - Complete

  1. Performance Improvements
    - Add missing index for pending_signup_requests.reviewed_by foreign key
    - Optimize RLS policies to use (select auth.uid()) pattern
    - Fix function search paths to be immutable

  2. Security Improvements
    - Ensure all RLS policies use optimized auth function calls
    - Fix function search paths

  3. Changes Made
    - Add index: idx_pending_signup_requests_reviewed_by
    - Update all RLS policies with (select auth.uid()) pattern
    - Update function search paths to SET search_path = public, pg_temp
    - Note: Unused indexes are kept for potential future use

  Important Notes:
    - The (select auth.uid()) pattern prevents re-evaluation for each row
    - This significantly improves query performance at scale
    - Multiple permissive policies are acceptable for different access patterns
*/

-- ============================================================================
-- PART 1: Add Missing Index
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pending_signup_requests_reviewed_by 
  ON pending_signup_requests(reviewed_by);

-- ============================================================================
-- PART 2: Fix Function Search Paths
-- ============================================================================

-- Fix user_can_access_inspection_photo function
DROP FUNCTION IF EXISTS user_can_access_inspection_photo(uuid) CASCADE;
CREATE FUNCTION user_can_access_inspection_photo(photo_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  photo_account_id uuid;
  user_has_access boolean;
BEGIN
  SELECT ip.account_id INTO photo_account_id
  FROM inspection_photos ip
  WHERE ip.id = photo_id;

  IF photo_account_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM account_users au
    WHERE au.account_id = photo_account_id
    AND au.user_id = auth.uid()
  ) INTO user_has_access;

  RETURN user_has_access;
END;
$$;

-- Fix update_user_signature_status function
DROP FUNCTION IF EXISTS update_user_signature_status() CASCADE;
CREATE FUNCTION update_user_signature_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE users
  SET signature_completed = true
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_update_signature_status ON user_signatures;
CREATE TRIGGER trigger_update_signature_status
  AFTER INSERT ON user_signatures
  FOR EACH ROW
  EXECUTE FUNCTION update_user_signature_status();

-- Fix mark_signature_incomplete function
DROP FUNCTION IF EXISTS mark_signature_incomplete() CASCADE;
CREATE FUNCTION mark_signature_incomplete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE users
  SET signature_completed = false
  WHERE id = OLD.user_id;
  RETURN OLD;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_mark_signature_incomplete ON user_signatures;
CREATE TRIGGER trigger_mark_signature_incomplete
  AFTER DELETE ON user_signatures
  FOR EACH ROW
  EXECUTE FUNCTION mark_signature_incomplete();

-- Fix get_user_id_by_email function
DROP FUNCTION IF EXISTS get_user_id_by_email(text) CASCADE;
CREATE FUNCTION get_user_id_by_email(user_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id
  FROM users
  WHERE email = user_email
  LIMIT 1;
  
  RETURN user_id;
END;
$$;

-- Fix get_account_team_members function
DROP FUNCTION IF EXISTS get_account_team_members(uuid) CASCADE;
CREATE FUNCTION get_account_team_members(target_account_id uuid)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.full_name, au.role
  FROM users u
  INNER JOIN account_users au ON au.user_id = u.id
  WHERE au.account_id = target_account_id;
END;
$$;

-- ============================================================================
-- PART 3: Optimize RLS Policies - Agencies Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own agency" ON agencies;
CREATE POLICY "Users can view own agency"
  ON agencies FOR SELECT
  TO authenticated
  USING (owner_email = (SELECT auth.jwt()->>'email'));

DROP POLICY IF EXISTS "Users can update own agency" ON agencies;
CREATE POLICY "Users can update own agency"
  ON agencies FOR UPDATE
  TO authenticated
  USING (owner_email = (SELECT auth.jwt()->>'email'))
  WITH CHECK (owner_email = (SELECT auth.jwt()->>'email'));

DROP POLICY IF EXISTS "Users can create own agency" ON agencies;
CREATE POLICY "Users can create own agency"
  ON agencies FOR INSERT
  TO authenticated
  WITH CHECK (owner_email = (SELECT auth.jwt()->>'email'));

DROP POLICY IF EXISTS "Users can delete own agency" ON agencies;
CREATE POLICY "Users can delete own agency"
  ON agencies FOR DELETE
  TO authenticated
  USING (owner_email = (SELECT auth.jwt()->>'email'));

-- ============================================================================
-- PART 4: Optimize RLS Policies - Accounts Table
-- ============================================================================

DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
CREATE POLICY "Agency owners can create accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;
CREATE POLICY "Agency owners can update accounts"
  ON accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;
CREATE POLICY "Agency owners can delete accounts"
  ON accounts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

-- ============================================================================
-- PART 5: Optimize RLS Policies - Account Users Table
-- ============================================================================

DROP POLICY IF EXISTS "Agency owners can view account memberships" ON account_users;
CREATE POLICY "Agency owners can view account memberships"
  ON account_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Agency owners can update account members" ON account_users;
CREATE POLICY "Agency owners can update account members"
  ON account_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Users can delete team members in their accounts" ON account_users;
CREATE POLICY "Users can delete team members in their accounts"
  ON account_users FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = (SELECT auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Authorized users can add account members" ON account_users;
CREATE POLICY "Authorized users can add account members"
  ON account_users FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = (SELECT auth.uid())
      AND role IN ('owner', 'admin')
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = account_users.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

-- ============================================================================
-- PART 6: Optimize RLS Policies - Users Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own record" ON users;
CREATE POLICY "Users can view own record"
  ON users FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

-- ============================================================================
-- PART 7: Optimize RLS Policies - User Invitations Table
-- ============================================================================

DROP POLICY IF EXISTS "Authorized users can create invitations" ON user_invitations;
CREATE POLICY "Authorized users can create invitations"
  ON user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = (SELECT auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Authorized users can delete invitations" ON user_invitations;
CREATE POLICY "Authorized users can delete invitations"
  ON user_invitations FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = (SELECT auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Agency owners can view all invitations in their agency" ON user_invitations;
CREATE POLICY "Agency owners can view all invitations in their agency"
  ON user_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts
      INNER JOIN agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Invited users can accept their invitations" ON user_invitations;
CREATE POLICY "Invited users can accept their invitations"
  ON user_invitations FOR UPDATE
  TO authenticated
  USING (email = (SELECT auth.jwt()->>'email'))
  WITH CHECK (email = (SELECT auth.jwt()->>'email'));

-- ============================================================================
-- PART 8: Optimize RLS Policies - Agency Ownership Transfers Table
-- ============================================================================

DROP POLICY IF EXISTS "Agency owners can create ownership transfers" ON agency_ownership_transfers;
CREATE POLICY "Agency owners can create ownership transfers"
  ON agency_ownership_transfers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = agency_ownership_transfers.agency_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Agency owners can view ownership transfers" ON agency_ownership_transfers;
CREATE POLICY "Agency owners can view ownership transfers"
  ON agency_ownership_transfers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = agency_ownership_transfers.agency_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

DROP POLICY IF EXISTS "Agency owners can delete pending transfers" ON agency_ownership_transfers;
CREATE POLICY "Agency owners can delete pending transfers"
  ON agency_ownership_transfers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = agency_ownership_transfers.agency_id
      AND agencies.owner_email = (SELECT auth.jwt()->>'email')
    )
  );

-- ============================================================================
-- PART 9: Optimize RLS Policies - Pending Signup Requests Table
-- ============================================================================

DROP POLICY IF EXISTS "Agency owners can view signup requests" ON pending_signup_requests;
CREATE POLICY "Agency owners can view signup requests"
  ON pending_signup_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = (SELECT auth.uid())
      AND users.is_agency_owner = true
    )
  );

DROP POLICY IF EXISTS "Agency owners can update signup requests" ON pending_signup_requests;
CREATE POLICY "Agency owners can update signup requests"
  ON pending_signup_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = (SELECT auth.uid())
      AND users.is_agency_owner = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = (SELECT auth.uid())
      AND users.is_agency_owner = true
    )
  );

-- ============================================================================
-- PART 10: Optimize RLS Policies - User Settings Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their account settings" ON user_settings;
CREATE POLICY "Users can view their account settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert their account settings" ON user_settings;
CREATE POLICY "Users can insert their account settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their account settings" ON user_settings;
CREATE POLICY "Users can update their account settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete their account settings" ON user_settings;
CREATE POLICY "Users can delete their account settings"
  ON user_settings FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- PART 11: Optimize RLS Policies - Inspection Templates Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view global and account templates" ON inspection_templates;
CREATE POLICY "Users can view global and account templates"
  ON inspection_templates FOR SELECT
  TO authenticated
  USING (
    account_id IS NULL
    OR account_id IN (
      SELECT account_id FROM account_users WHERE user_id = (SELECT auth.uid())
    )
  );