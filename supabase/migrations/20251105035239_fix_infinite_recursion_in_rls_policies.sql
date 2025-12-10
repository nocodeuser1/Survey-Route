/*
  # Fix Infinite Recursion in RLS Policies

  1. Problem
    - RLS policies were causing infinite recursion when checking nested table relationships
    - Policies on accounts were checking account_users which checks accounts again
  
  2. Solution
    - Simplify policies to avoid circular dependencies
    - Use direct auth checks where possible
    - Cache auth values at the start of policy evaluation
*/

-- ============================================================================
-- DROP EXISTING POLICIES THAT CAUSE RECURSION
-- ============================================================================

-- ACCOUNTS TABLE
DROP POLICY IF EXISTS "Agency owners can view accounts" ON accounts;

-- Recreate with simpler logic that doesn't cause recursion
CREATE POLICY "Agency owners can view accounts" ON accounts
  FOR SELECT TO authenticated
  USING (
    -- Agency owners can see all their accounts
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = accounts.agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
    OR 
    -- Users can see accounts they belong to (check via user_id instead of nested query)
    EXISTS (
      SELECT 1 FROM account_users 
      WHERE account_users.account_id = accounts.id 
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

-- ============================================================================
-- SIMPLIFY OTHER POLICIES TO PREVENT RECURSION
-- ============================================================================

-- FACILITIES TABLE
DROP POLICY IF EXISTS "Users can view facilities" ON facilities;
DROP POLICY IF EXISTS "Users can insert facilities" ON facilities;
DROP POLICY IF EXISTS "Users can update facilities" ON facilities;
DROP POLICY IF EXISTS "Users can delete facilities" ON facilities;

CREATE POLICY "Users can view facilities" ON facilities
  FOR SELECT TO authenticated
  USING (
    -- Check account_users directly without nested subqueries
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = facilities.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = facilities.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert facilities" ON facilities
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = facilities.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = facilities.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update facilities" ON facilities
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = facilities.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = facilities.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = facilities.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = facilities.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete facilities" ON facilities
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = facilities.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = facilities.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- HOME_BASE TABLE
DROP POLICY IF EXISTS "Users can view home base" ON home_base;
DROP POLICY IF EXISTS "Users can insert home base" ON home_base;
DROP POLICY IF EXISTS "Users can update home base" ON home_base;
DROP POLICY IF EXISTS "Users can delete home base" ON home_base;

CREATE POLICY "Users can view home base" ON home_base
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = home_base.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = home_base.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert home base" ON home_base
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = home_base.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = home_base.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update home base" ON home_base
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = home_base.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = home_base.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = home_base.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = home_base.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete home base" ON home_base
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = home_base.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = home_base.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- ROUTE_PLANS TABLE
DROP POLICY IF EXISTS "Users can view route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can insert route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can update route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can delete route plans" ON route_plans;

CREATE POLICY "Users can view route plans" ON route_plans
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = route_plans.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = route_plans.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert route plans" ON route_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = route_plans.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = route_plans.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update route plans" ON route_plans
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = route_plans.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = route_plans.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = route_plans.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = route_plans.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete route plans" ON route_plans
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = route_plans.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = route_plans.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- USER_SETTINGS TABLE
DROP POLICY IF EXISTS "Users can view settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update settings" ON user_settings;
DROP POLICY IF EXISTS "Users can delete settings" ON user_settings;

CREATE POLICY "Users can view settings" ON user_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = user_settings.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = user_settings.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert settings" ON user_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = user_settings.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = user_settings.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update settings" ON user_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = user_settings.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = user_settings.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = user_settings.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = user_settings.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete settings" ON user_settings
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = user_settings.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = user_settings.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- TEAM_MEMBERS TABLE
DROP POLICY IF EXISTS "Users can view team members in their accounts" ON team_members;
DROP POLICY IF EXISTS "Users can insert team members in their accounts" ON team_members;
DROP POLICY IF EXISTS "Users can update team members in their accounts" ON team_members;
DROP POLICY IF EXISTS "Users can delete team members in their accounts" ON team_members;

CREATE POLICY "Users can view team members in their accounts" ON team_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = team_members.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = team_members.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert team members in their accounts" ON team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = team_members.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = team_members.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update team members in their accounts" ON team_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = team_members.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = team_members.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = team_members.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = team_members.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete team members in their accounts" ON team_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users 
      JOIN users ON account_users.user_id = users.id
      WHERE account_users.account_id = team_members.account_id
      AND users.auth_user_id = (select auth.uid())
    )
    OR
    EXISTS (
      SELECT 1 FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE accounts.id = team_members.account_id
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );
