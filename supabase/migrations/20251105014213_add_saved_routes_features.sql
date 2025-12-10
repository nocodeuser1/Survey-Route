/*
  # Add Saved Routes Features

  ## Changes Made
  
  1. **Enhanced route_plans Table**
    - Add `name` column for user-friendly route names
    - Add `is_last_viewed` column to track the most recently viewed route
    - Add `settings` column to store the settings used to generate the route
    - Add indexes for performance
  
  2. **Security**
    - RLS already enabled on route_plans table
    - Policies already exist for user access
  
  ## Purpose
  This migration enables users to:
  - Save routes with custom names
  - Load previously saved routes
  - Automatically load the last viewed route on page refresh
  - Rename existing routes
*/

-- Add name column for saved routes (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_plans' AND column_name = 'name'
  ) THEN
    ALTER TABLE route_plans ADD COLUMN name text DEFAULT '';
  END IF;
END $$;

-- Add is_last_viewed flag (only one per user should be true)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_plans' AND column_name = 'is_last_viewed'
  ) THEN
    ALTER TABLE route_plans ADD COLUMN is_last_viewed boolean DEFAULT false;
  END IF;
END $$;

-- Add settings column to store generation settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_plans' AND column_name = 'settings'
  ) THEN
    ALTER TABLE route_plans ADD COLUMN settings jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Add home_base_data column to store home base information
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_plans' AND column_name = 'home_base_data'
  ) THEN
    ALTER TABLE route_plans ADD COLUMN home_base_data jsonb;
  END IF;
END $$;

-- Create index for faster queries on is_last_viewed
CREATE INDEX IF NOT EXISTS idx_route_plans_last_viewed 
  ON route_plans(user_id, is_last_viewed) 
  WHERE is_last_viewed = true;

-- Create index for faster queries on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_route_plans_created_at 
  ON route_plans(user_id, created_at DESC);