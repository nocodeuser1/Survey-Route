/*
  # Fix All RLS Policies to Use Helper Function

  1. Problem
    - Many tables use complex subqueries to check user access
    - These subqueries can fail due to nested RLS policy checks
    - Pattern: user_id IN (SELECT users.id FROM users WHERE auth_user_id = auth.uid())
    - This creates circular dependencies and can fail

  2. Solution
    - Use the existing user_has_account_access() function consistently
    - This function is SECURITY DEFINER and bypasses RLS
    - It checks both agency ownership and account membership
    - More reliable and performant

  3. Tables Fixed
    - user_settings (INSERT, UPDATE, SELECT, DELETE)
    - facilities (INSERT, UPDATE, DELETE)
    - home_base (INSERT, UPDATE, DELETE)
    - route_plans (INSERT, UPDATE, DELETE)
    - user_signatures (INSERT, UPDATE, DELETE)
    - team_signatures (INSERT, UPDATE, DELETE)

  Important Notes:
    - All policies now use user_has_account_access() for consistency
    - This ensures reliable access checks across the application
    - Security is maintained while improving reliability
*/

-- ============================================================================
-- PART 1: Fix user_settings RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their account settings" ON user_settings;
CREATE POLICY "Users can view their account settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can insert their account settings" ON user_settings;
CREATE POLICY "Users can insert their account settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can update their account settings" ON user_settings;
CREATE POLICY "Users can update their account settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (user_has_account_access(account_id))
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can delete their account settings" ON user_settings;
CREATE POLICY "Users can delete their account settings"
  ON user_settings FOR DELETE
  TO authenticated
  USING (user_has_account_access(account_id));

-- ============================================================================
-- PART 2: Fix facilities RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can view facilities" ON facilities;
CREATE POLICY "Users can view facilities"
  ON facilities FOR SELECT
  TO authenticated
  USING (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can insert facilities" ON facilities;
CREATE POLICY "Users can insert facilities"
  ON facilities FOR INSERT
  TO authenticated
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can update facilities" ON facilities;
CREATE POLICY "Users can update facilities"
  ON facilities FOR UPDATE
  TO authenticated
  USING (user_has_account_access(account_id))
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can delete facilities" ON facilities;
CREATE POLICY "Users can delete facilities"
  ON facilities FOR DELETE
  TO authenticated
  USING (user_has_account_access(account_id));

-- ============================================================================
-- PART 3: Fix home_base RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can view home base" ON home_base;
CREATE POLICY "Users can view home base"
  ON home_base FOR SELECT
  TO authenticated
  USING (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can insert home base" ON home_base;
CREATE POLICY "Users can insert home base"
  ON home_base FOR INSERT
  TO authenticated
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can update home base" ON home_base;
CREATE POLICY "Users can update home base"
  ON home_base FOR UPDATE
  TO authenticated
  USING (user_has_account_access(account_id))
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can delete home base" ON home_base;
CREATE POLICY "Users can delete home base"
  ON home_base FOR DELETE
  TO authenticated
  USING (user_has_account_access(account_id));

-- ============================================================================
-- PART 4: Fix route_plans RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can view route plans" ON route_plans;
CREATE POLICY "Users can view route plans"
  ON route_plans FOR SELECT
  TO authenticated
  USING (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can insert route plans" ON route_plans;
CREATE POLICY "Users can insert route plans"
  ON route_plans FOR INSERT
  TO authenticated
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can update route plans" ON route_plans;
CREATE POLICY "Users can update route plans"
  ON route_plans FOR UPDATE
  TO authenticated
  USING (user_has_account_access(account_id))
  WITH CHECK (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can delete route plans" ON route_plans;
CREATE POLICY "Users can delete route plans"
  ON route_plans FOR DELETE
  TO authenticated
  USING (user_has_account_access(account_id));

-- ============================================================================
-- PART 5: Fix user_signatures RLS Policies
-- ============================================================================

-- Create a helper function to check if user owns a signature
CREATE OR REPLACE FUNCTION user_owns_signature(signature_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE users.id = signature_user_id
    AND users.auth_user_id = auth.uid()
  );
END;
$$;

DROP POLICY IF EXISTS "Users can view own signatures" ON user_signatures;
CREATE POLICY "Users can view own signatures"
  ON user_signatures FOR SELECT
  TO authenticated
  USING (user_owns_signature(user_id) OR user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can insert their own signatures" ON user_signatures;
CREATE POLICY "Users can insert their own signatures"
  ON user_signatures FOR INSERT
  TO authenticated
  WITH CHECK (user_owns_signature(user_id) AND user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can update their own signatures" ON user_signatures;
CREATE POLICY "Users can update their own signatures"
  ON user_signatures FOR UPDATE
  TO authenticated
  USING (user_owns_signature(user_id) AND user_has_account_access(account_id))
  WITH CHECK (user_owns_signature(user_id) AND user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can delete their own signatures" ON user_signatures;
CREATE POLICY "Users can delete their own signatures"
  ON user_signatures FOR DELETE
  TO authenticated
  USING (user_owns_signature(user_id) AND user_has_account_access(account_id));

-- ============================================================================
-- PART 6: Fix team_signatures RLS Policies (if table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_signatures') THEN
    DROP POLICY IF EXISTS "Users can view team signatures" ON team_signatures;
    EXECUTE 'CREATE POLICY "Users can view team signatures"
      ON team_signatures FOR SELECT
      TO authenticated
      USING (user_has_account_access(account_id))';

    DROP POLICY IF EXISTS "Users can insert team signatures" ON team_signatures;
    EXECUTE 'CREATE POLICY "Users can insert team signatures"
      ON team_signatures FOR INSERT
      TO authenticated
      WITH CHECK (user_has_account_access(account_id))';

    DROP POLICY IF EXISTS "Users can update team signatures" ON team_signatures;
    EXECUTE 'CREATE POLICY "Users can update team signatures"
      ON team_signatures FOR UPDATE
      TO authenticated
      USING (user_has_account_access(account_id))
      WITH CHECK (user_has_account_access(account_id))';

    DROP POLICY IF EXISTS "Users can delete team signatures" ON team_signatures;
    EXECUTE 'CREATE POLICY "Users can delete team signatures"
      ON team_signatures FOR DELETE
      TO authenticated
      USING (user_has_account_access(account_id))';
  END IF;
END $$;