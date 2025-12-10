/*
  # Allow Demo User Access

  ## Overview
  This migration updates RLS policies to allow the demo user to work without authentication.
  
  ## Changes
  1. Add policies for anonymous users to access data for the demo user ID
  2. Keep existing authenticated user policies intact
  
  ## Security Note
  This only allows access to records with user_id = '00000000-0000-0000-0000-000000000001'
  which is the designated demo user for the application.
*/

-- Drop existing policies for facilities
DROP POLICY IF EXISTS "Users can view own facilities" ON facilities;
DROP POLICY IF EXISTS "Users can insert own facilities" ON facilities;
DROP POLICY IF EXISTS "Users can update own facilities" ON facilities;
DROP POLICY IF EXISTS "Users can delete own facilities" ON facilities;

-- Create new policies for facilities with demo user support
CREATE POLICY "Users can view own facilities"
  ON facilities FOR SELECT
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can insert own facilities"
  ON facilities FOR INSERT
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can update own facilities"
  ON facilities FOR UPDATE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  )
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can delete own facilities"
  ON facilities FOR DELETE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

-- Drop existing policies for home_base
DROP POLICY IF EXISTS "Users can view own home base" ON home_base;
DROP POLICY IF EXISTS "Users can insert own home base" ON home_base;
DROP POLICY IF EXISTS "Users can update own home base" ON home_base;
DROP POLICY IF EXISTS "Users can delete own home base" ON home_base;

-- Create new policies for home_base with demo user support
CREATE POLICY "Users can view own home base"
  ON home_base FOR SELECT
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can insert own home base"
  ON home_base FOR INSERT
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can update own home base"
  ON home_base FOR UPDATE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  )
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can delete own home base"
  ON home_base FOR DELETE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

-- Drop existing policies for route_plans
DROP POLICY IF EXISTS "Users can view own route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can insert own route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can update own route plans" ON route_plans;
DROP POLICY IF EXISTS "Users can delete own route plans" ON route_plans;

-- Create new policies for route_plans with demo user support
CREATE POLICY "Users can view own route plans"
  ON route_plans FOR SELECT
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can insert own route plans"
  ON route_plans FOR INSERT
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can update own route plans"
  ON route_plans FOR UPDATE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  )
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can delete own route plans"
  ON route_plans FOR DELETE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

-- Drop existing policies for user_settings
DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can delete own settings" ON user_settings;

-- Create new policies for user_settings with demo user support
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  )
  WITH CHECK (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );

CREATE POLICY "Users can delete own settings"
  ON user_settings FOR DELETE
  USING (
    (auth.uid() = user_id) OR 
    (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  );
