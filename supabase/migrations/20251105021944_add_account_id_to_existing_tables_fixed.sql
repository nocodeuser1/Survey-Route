/*
  # Add account_id to existing tables for multi-tenant support

  ## Overview
  This migration adds account_id foreign key to all existing data tables to enable multi-tenant functionality.
  
  ## Tables Modified
  
  ### 1. facilities
  - Added `account_id` (uuid, foreign key) - Links facility to account
  
  ### 2. home_base
  - Added `account_id` (uuid, foreign key) - Links home base to account
  
  ### 3. route_plans
  - Added `account_id` (uuid, foreign key) - Links route plan to account
  
  ### 4. user_settings
  - Added `account_id` (uuid, foreign key) - Links settings to account
  
  ### 5. inspections
  - Added `account_id` (uuid, foreign key) - Links inspection to account
  
  ### 6. team_members
  - Added `account_id` (uuid, foreign key) - Links team member to account
  
  ### 7. team_signatures
  - Added `account_id` (uuid, foreign key) - Links signature to account
  
  ### 8. inspection_templates
  - Added `account_id` (uuid, foreign key) - Links template to account
  
  ## Indexes
  - Added indexes on all account_id columns for query performance
  
  ## Notes
  - All account_id columns allow NULL temporarily for migration
  - Will be updated to NOT NULL after data migration is complete
*/

-- Add account_id to facilities table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'facilities' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE facilities ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_facilities_account_id ON facilities(account_id);
  END IF;
END $$;

-- Add account_id to home_base table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'home_base' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE home_base ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_home_base_account_id ON home_base(account_id);
  END IF;
END $$;

-- Add account_id to route_plans table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_plans' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE route_plans ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_route_plans_account_id ON route_plans(account_id);
  END IF;
END $$;

-- Add account_id to user_settings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_user_settings_account_id ON user_settings(account_id);
  END IF;
END $$;

-- Add account_id to inspections table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inspections' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE inspections ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_inspections_account_id ON inspections(account_id);
  END IF;
END $$;

-- Add account_id to team_members table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_members' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE team_members ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_team_members_account_id ON team_members(account_id);
  END IF;
END $$;

-- Add account_id to team_signatures table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_signatures' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE team_signatures ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_team_signatures_account_id ON team_signatures(account_id);
  END IF;
END $$;

-- Add account_id to inspection_templates table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inspection_templates' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE inspection_templates ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_inspection_templates_account_id ON inspection_templates(account_id);
  END IF;
END $$;
