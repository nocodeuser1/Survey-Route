/*
  # Update RLS Policies for Multi-Tenant Architecture

  ## Overview
  This migration updates all existing RLS policies to work with the new multi-tenant architecture
  based on account_id instead of user_id.
  
  ## Security Changes
  
  ### Facilities Table
  - Removed demo user policies
  - Added account-based access control
  - Users can only access facilities in their account
  
  ### Home Base Table
  - Updated policies to use account membership
  - Agency owners can access all accounts
  
  ### Route Plans Table
  - Account-scoped access control
  - Maintains existing functionality with new security model
  
  ### User Settings Table
  - Account-scoped settings
  - Users can manage settings within their account
  
  ### Inspections Table
  - Account-based access
  - Inspector visibility limited to their account
  
  ### Team Members Table
  - Account-scoped team management
  - Account admins can manage their team
  
  ### Team Signatures Table
  - Account-based signature storage
  - Team-specific access within accounts
  
  ### Inspection Templates Table
  - Account-scoped templates
  - Shared within account only
  
  ## Helper Functions
  - Uses existing helper functions from multi-tenant migration
  - Leverages is_account_member, is_account_admin, is_agency_owner
*/

-- Drop all existing RLS policies on facilities table
DROP POLICY IF EXISTS "Allow demo user full access" ON facilities;
DROP POLICY IF EXISTS "Demo user can manage facilities" ON facilities;

-- New RLS policies for facilities table
CREATE POLICY "Account members can view facilities in their account"
  ON facilities FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert facilities in their account"
  ON facilities FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update facilities in their account"
  ON facilities FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete facilities in their account"
  ON facilities FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

-- Drop existing policies on home_base table
DROP POLICY IF EXISTS "Allow demo user full access" ON home_base;
DROP POLICY IF EXISTS "Demo user can manage home base" ON home_base;

-- New RLS policies for home_base table
CREATE POLICY "Account members can view home base in their account"
  ON home_base FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert home base in their account"
  ON home_base FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update home base in their account"
  ON home_base FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete home base in their account"
  ON home_base FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

-- Drop existing policies on route_plans table
DROP POLICY IF EXISTS "Allow demo user full access" ON route_plans;
DROP POLICY IF EXISTS "Demo user can manage route plans" ON route_plans;

-- New RLS policies for route_plans table
CREATE POLICY "Account members can view route plans in their account"
  ON route_plans FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert route plans in their account"
  ON route_plans FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update route plans in their account"
  ON route_plans FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete route plans in their account"
  ON route_plans FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

-- Drop existing policies on user_settings table
DROP POLICY IF EXISTS "Allow demo user full access" ON user_settings;
DROP POLICY IF EXISTS "Demo user can manage user settings" ON user_settings;

-- New RLS policies for user_settings table
CREATE POLICY "Account members can view settings in their account"
  ON user_settings FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert settings in their account"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update settings in their account"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete settings in their account"
  ON user_settings FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

-- Drop existing policies on inspections table
DROP POLICY IF EXISTS "Allow demo user full access" ON inspections;
DROP POLICY IF EXISTS "Demo user can manage inspections" ON inspections;
DROP POLICY IF EXISTS "Demo user can view all inspections" ON inspections;

-- New RLS policies for inspections table
CREATE POLICY "Account members can view inspections in their account"
  ON inspections FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert inspections in their account"
  ON inspections FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update inspections in their account"
  ON inspections FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete inspections in their account"
  ON inspections FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

-- Drop existing policies on team_members table
DROP POLICY IF EXISTS "Demo user can manage team members" ON team_members;

-- New RLS policies for team_members table
CREATE POLICY "Account members can view team members in their account"
  ON team_members FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert team members in their account"
  ON team_members FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update team members in their account"
  ON team_members FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete team members in their account"
  ON team_members FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

-- Drop existing policies on team_signatures table
DROP POLICY IF EXISTS "Demo user can manage team signatures" ON team_signatures;

-- New RLS policies for team_signatures table
CREATE POLICY "Account members can view team signatures in their account"
  ON team_signatures FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert team signatures in their account"
  ON team_signatures FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update team signatures in their account"
  ON team_signatures FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete team signatures in their account"
  ON team_signatures FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

-- Drop existing policies on inspection_templates table
DROP POLICY IF EXISTS "Demo user can manage inspection templates" ON inspection_templates;
DROP POLICY IF EXISTS "Demo user can view inspection templates" ON inspection_templates;

-- New RLS policies for inspection_templates table
CREATE POLICY "Account members can view templates in their account"
  ON inspection_templates FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can insert templates in their account"
  ON inspection_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can update templates in their account"
  ON inspection_templates FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Account members can delete templates in their account"
  ON inspection_templates FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = get_user_id_from_auth()
    )
  );
