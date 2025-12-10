/*
  # Fix Security and Performance Issues

  1. Add Missing Indexes for Foreign Keys
    - Add indexes for all unindexed foreign key columns
    - Improves query performance for join operations

  2. Optimize RLS Policies
    - Replace auth.<function>() with (select auth.<function>())
    - Prevents re-evaluation of auth functions for each row
    - Significantly improves query performance at scale

  3. Remove Duplicate Policies
    - Drop old duplicate policies to prevent confusion
    - Keep only the account-based policies

  4. Add RLS Policies for account_users
    - Enable proper access control for account membership

  5. Clean Up Unused Indexes
    - Remove indexes that are not being used
*/

-- ============================================================================
-- 1. ADD MISSING INDEXES FOR FOREIGN KEYS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_account_users_invited_by 
  ON account_users(invited_by);

CREATE INDEX IF NOT EXISTS idx_account_users_user_id 
  ON account_users(user_id);

CREATE INDEX IF NOT EXISTS idx_account_users_account_id 
  ON account_users(account_id);

CREATE INDEX IF NOT EXISTS idx_accounts_agency_id 
  ON accounts(agency_id);

CREATE INDEX IF NOT EXISTS idx_accounts_created_by 
  ON accounts(created_by);

CREATE INDEX IF NOT EXISTS idx_team_members_account_id 
  ON team_members(account_id);

CREATE INDEX IF NOT EXISTS idx_facilities_account_id 
  ON facilities(account_id);

CREATE INDEX IF NOT EXISTS idx_home_base_account_id 
  ON home_base(account_id);

CREATE INDEX IF NOT EXISTS idx_user_settings_account_id 
  ON user_settings(account_id);

-- ============================================================================
-- 2. DROP UNUSED INDEXES
-- ============================================================================

DROP INDEX IF EXISTS idx_route_plans_account_id;
DROP INDEX IF EXISTS idx_facilities_user_id;
DROP INDEX IF EXISTS idx_facilities_upload_batch_id;
DROP INDEX IF EXISTS idx_route_plans_user_id;
DROP INDEX IF EXISTS idx_route_plans_created_at;

-- ============================================================================
-- 3. DROP DUPLICATE/OLD POLICIES
-- ============================================================================

-- Drop old home_base policies (keep the account-based ones)
DROP POLICY IF EXISTS "Users can view own home base" ON home_base;
DROP POLICY IF EXISTS "Users can insert own home base" ON home_base;
DROP POLICY IF EXISTS "Users can update own home base" ON home_base;
DROP POLICY IF EXISTS "Users can delete own home base" ON home_base;

-- Drop old route_plans policies
DROP POLICY IF EXISTS "Users can view own route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can insert own route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can update own route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can delete own route plans" ON route_plans;

-- Drop old user_settings policies
DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can delete own settings" ON user_settings;

-- ============================================================================
-- 4. RECREATE OPTIMIZED RLS POLICIES WITH (SELECT auth.<function>())
-- ============================================================================

-- USERS TABLE
DROP POLICY IF EXISTS "Users can view themselves" ON users;
DROP POLICY IF EXISTS "Users can update themselves" ON users;
DROP POLICY IF EXISTS "Users can insert themselves" ON users;

CREATE POLICY "Users can view themselves" ON users
  FOR SELECT TO authenticated
  USING (auth_user_id = (select auth.uid()));

CREATE POLICY "Users can update themselves" ON users
  FOR UPDATE TO authenticated
  USING (auth_user_id = (select auth.uid()))
  WITH CHECK (auth_user_id = (select auth.uid()));

CREATE POLICY "Users can insert themselves" ON users
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = (select auth.uid()));

-- AGENCIES TABLE
DROP POLICY IF EXISTS "Users can create own agency" ON agencies;
DROP POLICY IF EXISTS "Users can view own agency" ON agencies;
DROP POLICY IF EXISTS "Users can update own agency" ON agencies;
DROP POLICY IF EXISTS "Users can delete own agency" ON agencies;

CREATE POLICY "Users can create own agency" ON agencies
  FOR INSERT TO authenticated
  WITH CHECK (owner_email = (select auth.jwt()->>'email'));

CREATE POLICY "Users can view own agency" ON agencies
  FOR SELECT TO authenticated
  USING (owner_email = (select auth.jwt()->>'email'));

CREATE POLICY "Users can update own agency" ON agencies
  FOR UPDATE TO authenticated
  USING (owner_email = (select auth.jwt()->>'email'))
  WITH CHECK (owner_email = (select auth.jwt()->>'email'));

CREATE POLICY "Users can delete own agency" ON agencies
  FOR DELETE TO authenticated
  USING (owner_email = (select auth.jwt()->>'email'));

-- ACCOUNTS TABLE
DROP POLICY IF EXISTS "Agency owners can create accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can view accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON accounts;

CREATE POLICY "Agency owners can create accounts" ON accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can view accounts" ON accounts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
    OR id IN (SELECT account_id FROM account_users WHERE user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    ))
  );

CREATE POLICY "Agency owners can update accounts" ON accounts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can delete accounts" ON accounts
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- FACILITIES TABLE
DROP POLICY IF EXISTS "Users can view facilities" ON facilities;
DROP POLICY IF EXISTS "Users can insert facilities" ON facilities;
DROP POLICY IF EXISTS "Users can update facilities" ON facilities;
DROP POLICY IF EXISTS "Users can delete facilities" ON facilities;

CREATE POLICY "Users can view facilities" ON facilities
  FOR SELECT TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert facilities" ON facilities
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update facilities" ON facilities
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete facilities" ON facilities
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
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
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert home base" ON home_base
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update home base" ON home_base
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete home base" ON home_base
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
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
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert route plans" ON route_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update route plans" ON route_plans
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete route plans" ON route_plans
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
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
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert settings" ON user_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update settings" ON user_settings
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete settings" ON user_settings
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- TEAM_MEMBERS TABLE (already optimized in previous migration, but recreating for consistency)
DROP POLICY IF EXISTS "Users can view team members in their accounts" ON team_members;
DROP POLICY IF EXISTS "Users can insert team members in their accounts" ON team_members;
DROP POLICY IF EXISTS "Users can update team members in their accounts" ON team_members;
DROP POLICY IF EXISTS "Users can delete team members in their accounts" ON team_members;

CREATE POLICY "Users can view team members in their accounts" ON team_members
  FOR SELECT TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can insert team members in their accounts" ON team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can update team members in their accounts" ON team_members
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Users can delete team members in their accounts" ON team_members
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users 
      WHERE user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- ============================================================================
-- 5. ADD RLS POLICIES FOR ACCOUNT_USERS TABLE
-- ============================================================================

-- Users can view their own account memberships
CREATE POLICY "Users can view own account memberships" ON account_users
  FOR SELECT TO authenticated
  USING (
    user_id IN (SELECT id FROM users WHERE auth_user_id = (select auth.uid()))
  );

-- Agency owners can view all account memberships in their agency
CREATE POLICY "Agency owners can view account memberships" ON account_users
  FOR SELECT TO authenticated
  USING (
    account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- Agency owners can add users to accounts
CREATE POLICY "Agency owners can add account members" ON account_users
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- Agency owners can update account memberships
CREATE POLICY "Agency owners can update account members" ON account_users
  FOR UPDATE TO authenticated
  USING (
    account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

-- Agency owners can remove account memberships
CREATE POLICY "Agency owners can remove account members" ON account_users
  FOR DELETE TO authenticated
  USING (
    account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = (select auth.jwt()->>'email')
    )
  );
