/*
  # Create Agency Owner Account and Migrate Existing Data

  ## Overview
  This migration creates the agency owner account and sets up a default account
  to migrate existing demo user data.
  
  ## Steps
  
  ### 1. Create Agency Owner Auth User
  - Uses Supabase Auth to create user with email: contact@myaileads.co
  - Password: Route1234
  
  ### 2. Create User Profile
  - Links to auth user
  - Sets is_agency_owner = true
  
  ### 3. Create Agency
  - Creates default agency for the owner
  
  ### 4. Create Default Account
  - Creates a default account for existing data
  - Links to the agency
  
  ### 5. Add Owner to Account
  - Creates account_users entry as account_admin
  
  ### 6. Migrate Existing Data
  - Updates all existing facilities, home_base, route_plans, etc. with account_id
  - Preserves all existing data and functionality
  
  ## Important Notes
  - Existing demo user ID (00000000-0000-0000-0000-000000000001) data will be migrated
  - All data remains accessible after migration
  - Agency owner will have full access to the default account
*/

-- Note: We cannot create auth users directly from migrations
-- The agency owner account must be created manually through Supabase Auth UI
-- or by running: supabase auth signup --email contact@myaileads.co --password Route1234

-- This migration will check if the auth user exists and create the necessary records

DO $$
DECLARE
  v_auth_user_id uuid;
  v_user_id uuid;
  v_agency_id uuid;
  v_account_id uuid;
BEGIN
  -- Check if auth user exists with email contact@myaileads.co
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = 'contact@myaileads.co';

  -- Only proceed if auth user exists
  IF v_auth_user_id IS NOT NULL THEN
    -- Check if user profile already exists
    SELECT id INTO v_user_id
    FROM users
    WHERE auth_user_id = v_auth_user_id;

    -- Create user profile if it doesn't exist
    IF v_user_id IS NULL THEN
      INSERT INTO users (auth_user_id, email, full_name, is_agency_owner)
      VALUES (v_auth_user_id, 'contact@myaileads.co', 'Agency Owner', true)
      RETURNING id INTO v_user_id;
    END IF;

    -- Check if agency exists
    SELECT id INTO v_agency_id
    FROM agencies
    WHERE owner_email = 'contact@myaileads.co';

    -- Create agency if it doesn't exist
    IF v_agency_id IS NULL THEN
      INSERT INTO agencies (name, owner_email, status)
      VALUES ('My AI Leads Agency', 'contact@myaileads.co', 'active')
      RETURNING id INTO v_agency_id;
    END IF;

    -- Check if default account exists
    SELECT id INTO v_account_id
    FROM accounts
    WHERE agency_id = v_agency_id
    AND account_name = 'Default Account';

    -- Create default account if it doesn't exist
    IF v_account_id IS NULL THEN
      INSERT INTO accounts (agency_id, account_name, created_by, status)
      VALUES (v_agency_id, 'Default Account', v_user_id, 'active')
      RETURNING id INTO v_account_id;
    END IF;

    -- Add owner to account as admin if not already added
    IF NOT EXISTS (
      SELECT 1 FROM account_users
      WHERE account_id = v_account_id AND user_id = v_user_id
    ) THEN
      INSERT INTO account_users (account_id, user_id, role, invited_by)
      VALUES (v_account_id, v_user_id, 'account_admin', v_user_id);
    END IF;

    -- Migrate existing facilities data
    UPDATE facilities
    SET account_id = v_account_id
    WHERE account_id IS NULL
    AND user_id = '00000000-0000-0000-0000-000000000001';

    -- Migrate existing home_base data
    UPDATE home_base
    SET account_id = v_account_id
    WHERE account_id IS NULL
    AND user_id = '00000000-0000-0000-0000-000000000001';

    -- Migrate existing route_plans data
    UPDATE route_plans
    SET account_id = v_account_id
    WHERE account_id IS NULL
    AND user_id = '00000000-0000-0000-0000-000000000001';

    -- Migrate existing user_settings data
    UPDATE user_settings
    SET account_id = v_account_id
    WHERE account_id IS NULL
    AND user_id = '00000000-0000-0000-0000-000000000001';

    -- Migrate existing inspections data
    UPDATE inspections
    SET account_id = v_account_id
    WHERE account_id IS NULL
    AND user_id = '00000000-0000-0000-0000-000000000001';

    -- Migrate existing team_members data
    UPDATE team_members
    SET account_id = v_account_id
    WHERE account_id IS NULL
    AND user_id = '00000000-0000-0000-0000-000000000001';

    -- Migrate existing team_signatures data
    UPDATE team_signatures
    SET account_id = v_account_id
    WHERE account_id IS NULL
    AND user_id = '00000000-0000-0000-0000-000000000001';

    -- Migrate existing inspection_templates data
    UPDATE inspection_templates
    SET account_id = v_account_id
    WHERE account_id IS NULL;

    RAISE NOTICE 'Agency owner account setup completed successfully';
  ELSE
    RAISE NOTICE 'Auth user with email contact@myaileads.co not found. Please create the user first.';
  END IF;
END $$;
