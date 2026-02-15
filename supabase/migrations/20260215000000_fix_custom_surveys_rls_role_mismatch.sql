-- Fix RLS role mismatch in custom surveys tables
-- The original migration used role IN ('owner', 'admin') but the
-- account_users table only allows 'account_admin' and 'user'
-- This fixes all admin-gated policies to use the correct role value

-- ============================================
-- 1. Fix survey_types RLS policies
-- ============================================

DROP POLICY IF EXISTS "Admins can insert survey types" ON survey_types;
CREATE POLICY "Admins can insert survey types"
  ON survey_types FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update survey types" ON survey_types;
CREATE POLICY "Admins can update survey types"
  ON survey_types FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete custom survey types" ON survey_types;
CREATE POLICY "Admins can delete custom survey types"
  ON survey_types FOR DELETE
  TO authenticated
  USING (
    is_system = false AND
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  );

-- ============================================
-- 2. Fix survey_fields RLS policies
-- ============================================

DROP POLICY IF EXISTS "Admins can insert survey fields" ON survey_fields;
CREATE POLICY "Admins can insert survey fields"
  ON survey_fields FOR INSERT
  TO authenticated
  WITH CHECK (
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update survey fields" ON survey_fields;
CREATE POLICY "Admins can update survey fields"
  ON survey_fields FOR UPDATE
  TO authenticated
  USING (
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  )
  WITH CHECK (
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete non-system survey fields" ON survey_fields;
CREATE POLICY "Admins can delete non-system survey fields"
  ON survey_fields FOR DELETE
  TO authenticated
  USING (
    is_system = false AND
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  );

-- ============================================
-- 3. Fix facility_survey_data RLS policies
-- ============================================

DROP POLICY IF EXISTS "Admins can delete facility survey data" ON facility_survey_data;
CREATE POLICY "Admins can delete facility survey data"
  ON facility_survey_data FOR DELETE
  TO authenticated
  USING (
    facility_id IN (
      SELECT f.id FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE au.user_id = auth.uid() AND au.role = 'account_admin'
    )
  );
