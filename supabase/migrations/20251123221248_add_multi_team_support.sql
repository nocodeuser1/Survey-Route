/*
  # Add Multi-Team Support

  This migration adds support for multiple field teams that can work simultaneously.
  Each team sees only their assigned facilities in Route Planning and Survey Mode.

  1. Changes to facilities table
    - Add `team_assignment` column to track which team owns each facility
    - NULL means unassigned, 1-10 represents team numbers
    - Defaults to 1 for backward compatibility

  2. Changes to account_users table
    - Add `team_assignment` column to track which team each user belongs to
    - NULL or 0 means "View All Teams" (for admins/owners)
    - Defaults to NULL (will default to Team 1 in app logic)

  3. Changes to user_settings table
    - Add `team_count` column to track how many teams the account uses
    - Defaults to 1 (single team mode - existing behavior)
    - Maximum of 10 teams

  4. Security
    - No RLS changes needed - team filtering happens at application level
    - Existing RLS policies continue to work based on account_id

  5. Data Migration
    - Set all existing facilities to team_assignment = 1 for backward compatibility
    - Existing accounts continue to work with single team (team_count = 1)
*/

-- Add team_assignment to facilities table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'facilities' AND column_name = 'team_assignment'
  ) THEN
    ALTER TABLE facilities ADD COLUMN team_assignment integer DEFAULT 1;

    -- Create index for efficient team filtering
    CREATE INDEX IF NOT EXISTS idx_facilities_team_assignment ON facilities(team_assignment);

    -- Create compound index for common query patterns
    CREATE INDEX IF NOT EXISTS idx_facilities_account_team ON facilities(account_id, team_assignment) WHERE account_id IS NOT NULL;

    -- Add check constraint to ensure valid team numbers
    ALTER TABLE facilities ADD CONSTRAINT check_team_assignment_range
      CHECK (team_assignment IS NULL OR (team_assignment >= 1 AND team_assignment <= 10));
  END IF;
END $$;

-- Add team_assignment to account_users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'account_users' AND column_name = 'team_assignment'
  ) THEN
    ALTER TABLE account_users ADD COLUMN team_assignment integer DEFAULT NULL;

    -- Create index for efficient user team lookups
    CREATE INDEX IF NOT EXISTS idx_account_users_team_assignment ON account_users(team_assignment);

    -- Add check constraint to ensure valid team numbers (NULL = view all)
    ALTER TABLE account_users ADD CONSTRAINT check_user_team_assignment_range
      CHECK (team_assignment IS NULL OR (team_assignment >= 1 AND team_assignment <= 10));
  END IF;
END $$;

-- Add team_count to user_settings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'team_count'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN team_count integer DEFAULT 1 NOT NULL;

    -- Add check constraint to ensure valid team count
    ALTER TABLE user_settings ADD CONSTRAINT check_team_count_range
      CHECK (team_count >= 1 AND team_count <= 10);
  END IF;
END $$;

-- Update all existing facilities to team 1 for backward compatibility
UPDATE facilities
SET team_assignment = 1
WHERE team_assignment IS NULL;

-- Add helpful comments
COMMENT ON COLUMN facilities.team_assignment IS 'Team number (1-10) that this facility is assigned to. NULL = unassigned. Used for multi-team field operations.';
COMMENT ON COLUMN account_users.team_assignment IS 'Team number (1-10) that this user belongs to. NULL = can view all teams (admin). Used for filtering route planning and survey mode.';
COMMENT ON COLUMN user_settings.team_count IS 'Number of field teams (1-10) this account uses. Defaults to 1 for single-team operations.';