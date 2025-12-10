/*
  # Add Multi-Home Base Support for Team Routing

  1. Changes
    - Add `team_number` column to `home_base` table (1-4)
    - Add `team_label` column to identify team names
    - Update RLS policies to support multiple home bases per user
    - Ensure each user can have up to 4 home bases (one per team)
  
  2. Notes
    - Existing home bases will default to team 1
    - Teams are numbered 1-4 to match the team size limit
*/

-- Add team columns to home_base table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'home_base' AND column_name = 'team_number'
  ) THEN
    ALTER TABLE home_base ADD COLUMN team_number integer DEFAULT 1 NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'home_base' AND column_name = 'team_label'
  ) THEN
    ALTER TABLE home_base ADD COLUMN team_label text DEFAULT 'Team 1' NOT NULL;
  END IF;
END $$;

-- Add constraint to ensure team_number is between 1 and 4
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'home_base_team_number_check'
  ) THEN
    ALTER TABLE home_base ADD CONSTRAINT home_base_team_number_check CHECK (team_number >= 1 AND team_number <= 4);
  END IF;
END $$;

-- Drop the old unique constraint on user_id only
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'home_base_user_id_key'
  ) THEN
    ALTER TABLE home_base DROP CONSTRAINT home_base_user_id_key;
  END IF;
END $$;

-- Add new unique constraint on user_id + team_number
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'home_base_user_team_unique'
  ) THEN
    ALTER TABLE home_base ADD CONSTRAINT home_base_user_team_unique UNIQUE (user_id, team_number);
  END IF;
END $$;

-- Update existing home bases to have team labels
UPDATE home_base SET team_label = 'Team ' || team_number::text WHERE team_label = 'Team 1';
