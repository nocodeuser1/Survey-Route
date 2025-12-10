/*
  # Fix Security and Performance Issues

  1. Add Missing Indexes
    - Add index for `inspections.template_id` foreign key
    - Add index for `user_invitations.invited_by` foreign key

  2. Optimize RLS Policies  
    - Replace all `auth.uid()`, `auth.email()`, and `auth.jwt()` calls 
      with `(select ...)` wrapped versions for better performance
    - This prevents re-evaluation of auth functions for each row
    - Applies to all tables with RLS policies

  3. Notes
    - Unused indexes are kept as they will be useful as data grows
    - Multiple permissive policies are intentional for different access patterns
    - Function search path and password protection require Supabase dashboard configuration
*/

-- ============================================================================
-- 1. ADD MISSING INDEXES FOR FOREIGN KEYS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_inspections_template_id 
ON public.inspections(template_id);

CREATE INDEX IF NOT EXISTS idx_user_invitations_invited_by 
ON public.user_invitations(invited_by);

-- ============================================================================
-- 2. OPTIMIZE RLS POLICIES - AGENCIES TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Users can create own agency" ON public.agencies;
DROP POLICY IF EXISTS "Users can view own agency" ON public.agencies;
DROP POLICY IF EXISTS "Users can update own agency" ON public.agencies;
DROP POLICY IF EXISTS "Users can delete own agency" ON public.agencies;

CREATE POLICY "Users can create own agency"
  ON public.agencies FOR INSERT
  TO authenticated
  WITH CHECK (owner_email = (select auth.jwt() ->> 'email'));

CREATE POLICY "Users can view own agency"
  ON public.agencies FOR SELECT
  TO authenticated
  USING (owner_email = (select auth.jwt() ->> 'email'));

CREATE POLICY "Users can update own agency"
  ON public.agencies FOR UPDATE
  TO authenticated
  USING (owner_email = (select auth.jwt() ->> 'email'))
  WITH CHECK (owner_email = (select auth.jwt() ->> 'email'));

CREATE POLICY "Users can delete own agency"
  ON public.agencies FOR DELETE
  TO authenticated
  USING (owner_email = (select auth.jwt() ->> 'email'));

-- ============================================================================
-- 3. OPTIMIZE RLS POLICIES - ACCOUNTS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Agency owners can create accounts" ON public.accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON public.accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON public.accounts;

CREATE POLICY "Agency owners can create accounts"
  ON public.accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Agency owners can update accounts"
  ON public.accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Agency owners can delete accounts"
  ON public.accounts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );

-- ============================================================================
-- 4. OPTIMIZE RLS POLICIES - ACCOUNT_USERS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Agency owners can view account memberships" ON public.account_users;
DROP POLICY IF EXISTS "Agency owners can add account members" ON public.account_users;
DROP POLICY IF EXISTS "Agency owners can update account members" ON public.account_users;
DROP POLICY IF EXISTS "Agency owners can remove account members" ON public.account_users;
DROP POLICY IF EXISTS "Users can view own account memberships" ON public.account_users;

CREATE POLICY "Agency owners can view account memberships"
  ON public.account_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts a
      JOIN public.agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Agency owners can add account members"
  ON public.account_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accounts a
      JOIN public.agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Agency owners can update account members"
  ON public.account_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts a
      JOIN public.agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accounts a
      JOIN public.agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Agency owners can remove account members"
  ON public.account_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts a
      JOIN public.agencies ag ON a.agency_id = ag.id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Users can view own account memberships"
  ON public.account_users FOR SELECT
  TO authenticated
  USING (
    user_id IN (
      SELECT users.id FROM users
      WHERE users.auth_user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- 5. OPTIMIZE RLS POLICIES - FACILITIES TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Users can view facilities" ON public.facilities;
DROP POLICY IF EXISTS "Users can insert facilities" ON public.facilities;
DROP POLICY IF EXISTS "Users can update facilities" ON public.facilities;
DROP POLICY IF EXISTS "Users can delete facilities" ON public.facilities;

CREATE POLICY "Users can view facilities"
  ON public.facilities FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = facilities.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can insert facilities"
  ON public.facilities FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = facilities.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can update facilities"
  ON public.facilities FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = facilities.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = facilities.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can delete facilities"
  ON public.facilities FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = facilities.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

-- ============================================================================
-- 6. OPTIMIZE RLS POLICIES - HOME_BASE TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Users can view home base" ON public.home_base;
DROP POLICY IF EXISTS "Users can insert home base" ON public.home_base;
DROP POLICY IF EXISTS "Users can update home base" ON public.home_base;
DROP POLICY IF EXISTS "Users can delete home base" ON public.home_base;

CREATE POLICY "Users can view home base"
  ON public.home_base FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = home_base.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can insert home base"
  ON public.home_base FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = home_base.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can update home base"
  ON public.home_base FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = home_base.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = home_base.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can delete home base"
  ON public.home_base FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = home_base.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

-- ============================================================================
-- 7. OPTIMIZE RLS POLICIES - ROUTE_PLANS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Users can view route plans" ON public.route_plans;
DROP POLICY IF EXISTS "Users can insert route plans" ON public.route_plans;
DROP POLICY IF EXISTS "Users can update route plans" ON public.route_plans;
DROP POLICY IF EXISTS "Users can delete route plans" ON public.route_plans;

CREATE POLICY "Users can view route plans"
  ON public.route_plans FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = route_plans.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can insert route plans"
  ON public.route_plans FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = route_plans.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can update route plans"
  ON public.route_plans FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = route_plans.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = route_plans.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can delete route plans"
  ON public.route_plans FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = route_plans.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

-- ============================================================================
-- 8. OPTIMIZE RLS POLICIES - USER_SETTINGS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Users can view settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can insert settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can update settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can delete settings" ON public.user_settings;

CREATE POLICY "Users can view settings"
  ON public.user_settings FOR SELECT
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can insert settings"
  ON public.user_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can update settings"
  ON public.user_settings FOR UPDATE
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can delete settings"
  ON public.user_settings FOR DELETE
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- 9. OPTIMIZE RLS POLICIES - TEAM_MEMBERS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Users can view team members in their accounts" ON public.team_members;
DROP POLICY IF EXISTS "Users can insert team members in their accounts" ON public.team_members;
DROP POLICY IF EXISTS "Users can update team members in their accounts" ON public.team_members;
DROP POLICY IF EXISTS "Users can delete team members in their accounts" ON public.team_members;

CREATE POLICY "Users can view team members in their accounts"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = team_members.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can insert team members in their accounts"
  ON public.team_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = team_members.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can update team members in their accounts"
  ON public.team_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = team_members.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = team_members.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Users can delete team members in their accounts"
  ON public.team_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = team_members.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
    )
  );

-- ============================================================================
-- 10. OPTIMIZE RLS POLICIES - USER_SIGNATURES TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own signatures" ON public.user_signatures;
DROP POLICY IF EXISTS "Users can insert their own signatures" ON public.user_signatures;
DROP POLICY IF EXISTS "Users can update their own signatures" ON public.user_signatures;
DROP POLICY IF EXISTS "Users can delete their own signatures" ON public.user_signatures;

CREATE POLICY "Users can view their own signatures"
  ON public.user_signatures FOR SELECT
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can insert their own signatures"
  ON public.user_signatures FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can update their own signatures"
  ON public.user_signatures FOR UPDATE
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can delete their own signatures"
  ON public.user_signatures FOR DELETE
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = (select auth.uid())
    )
  );

-- ============================================================================
-- 11. OPTIMIZE RLS POLICIES - USER_INVITATIONS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Account admins can view invitations for their accounts" ON public.user_invitations;
DROP POLICY IF EXISTS "Agency owners can view all invitations in their agency" ON public.user_invitations;
DROP POLICY IF EXISTS "Account admins can create invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Agency owners can create invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Account admins can update invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Invited users can accept their invitations" ON public.user_invitations;

CREATE POLICY "Account admins can view invitations for their accounts"
  ON public.user_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
      AND account_users.role = 'admin'
    )
  );

CREATE POLICY "Agency owners can view all invitations in their agency"
  ON public.user_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts
      JOIN public.agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Account admins can create invitations"
  ON public.user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
      AND account_users.role = 'admin'
    )
  );

CREATE POLICY "Agency owners can create invitations"
  ON public.user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accounts
      JOIN public.agencies ON agencies.id = accounts.agency_id
      WHERE accounts.id = user_invitations.account_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Account admins can update invitations"
  ON public.user_invitations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
      AND account_users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id IN (
        SELECT id FROM users WHERE auth_user_id = (select auth.uid())
      )
      AND account_users.role = 'admin'
    )
  );

CREATE POLICY "Invited users can accept their invitations"
  ON public.user_invitations FOR UPDATE
  TO authenticated
  USING (email = (select auth.jwt() ->> 'email'))
  WITH CHECK (email = (select auth.jwt() ->> 'email'));

-- ============================================================================
-- 12. OPTIMIZE RLS POLICIES - AGENCY_OWNERSHIP_TRANSFERS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "Agency owners can create ownership transfers" ON public.agency_ownership_transfers;
DROP POLICY IF EXISTS "Agency owners can view ownership transfers" ON public.agency_ownership_transfers;
DROP POLICY IF EXISTS "Agency owners can delete pending transfers" ON public.agency_ownership_transfers;

CREATE POLICY "Agency owners can create ownership transfers"
  ON public.agency_ownership_transfers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.id = agency_ownership_transfers.agency_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Agency owners can view ownership transfers"
  ON public.agency_ownership_transfers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.id = agency_ownership_transfers.agency_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Agency owners can delete pending transfers"
  ON public.agency_ownership_transfers FOR DELETE
  TO authenticated
  USING (
    completed_at IS NULL AND
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.id = agency_ownership_transfers.agency_id
      AND agencies.owner_email = (select auth.jwt() ->> 'email')
    )
  );