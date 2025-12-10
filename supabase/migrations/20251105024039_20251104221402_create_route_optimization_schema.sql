/*
  # Route Optimization Application Schema

  ## Overview
  This migration creates the complete database schema for a multi-day route optimization
  application that solves the traveling salesman problem for facility visits.

  ## New Tables
  
  ### 1. `facilities`
  Stores facility data imported from CSV files
  - `id` (uuid, primary key) - Unique identifier for each facility
  - `user_id` (uuid) - Reference to the user who owns this facility data
  - `name` (text) - Name of the facility
  - `latitude` (decimal) - Facility latitude coordinate
  - `longitude` (decimal) - Facility longitude coordinate
  - `visit_duration_minutes` (integer) - Time to spend at this facility in minutes
  - `upload_batch_id` (uuid) - Groups facilities from the same CSV upload
  - `created_at` (timestamptz) - Timestamp of when facility was added
  
  ### 2. `home_base`
  Stores user's home base address and coordinates
  - `id` (uuid, primary key) - Unique identifier
  - `user_id` (uuid, unique) - Reference to user (one home base per user)
  - `address` (text) - Human-readable address
  - `latitude` (decimal) - Home base latitude
  - `longitude` (decimal) - Home base longitude
  - `updated_at` (timestamptz) - Last update timestamp
  
  ### 3. `route_plans`
  Stores generated route optimization plans
  - `id` (uuid, primary key) - Unique identifier for each plan
  - `user_id` (uuid) - Reference to the user who owns this plan
  - `upload_batch_id` (uuid) - Links to the facilities used for this plan
  - `plan_data` (jsonb) - Complete route plan with daily breakdowns
  - `total_days` (integer) - Number of days in the route plan
  - `total_miles` (decimal) - Total miles across all days
  - `total_facilities` (integer) - Total number of facilities in plan
  - `created_at` (timestamptz) - When the plan was generated
  
  ### 4. `user_settings`
  Stores user preferences for route optimization
  - `id` (uuid, primary key) - Unique identifier
  - `user_id` (uuid, unique) - Reference to user (one settings record per user)
  - `max_facilities_per_day` (integer) - Maximum facilities to visit per day
  - `max_hours_per_day` (decimal) - Maximum working hours per day
  - `default_visit_duration_minutes` (integer) - Default time to spend at each facility
  - `use_facilities_constraint` (boolean) - Whether to apply max facilities limit
  - `use_hours_constraint` (boolean) - Whether to apply max hours limit
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable Row Level Security (RLS) on all tables
  - Add policies for authenticated users to manage only their own data
  - Users can read, insert, update, and delete only records where user_id matches their auth.uid()

  ## Indexes
  - Add indexes on user_id columns for efficient queries
  - Add index on upload_batch_id for grouping facilities
  - Add index on created_at for sorting route plans by date

  ## Notes
  - All coordinates use decimal type for precision
  - JSONB format for plan_data allows flexible route plan structure
  - Timestamps use timestamptz for timezone awareness
  - Default values set for visit duration and constraints
*/

-- Create facilities table
CREATE TABLE IF NOT EXISTS facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  latitude decimal(10, 7) NOT NULL,
  longitude decimal(10, 7) NOT NULL,
  visit_duration_minutes integer DEFAULT 30,
  upload_batch_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create home_base table
CREATE TABLE IF NOT EXISTS home_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  address text NOT NULL,
  latitude decimal(10, 7) NOT NULL,
  longitude decimal(10, 7) NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Create route_plans table
CREATE TABLE IF NOT EXISTS route_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  upload_batch_id uuid NOT NULL,
  plan_data jsonb NOT NULL,
  total_days integer NOT NULL,
  total_miles decimal(10, 2) NOT NULL,
  total_facilities integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  max_facilities_per_day integer DEFAULT 8,
  max_hours_per_day decimal(4, 2) DEFAULT 8.0,
  default_visit_duration_minutes integer DEFAULT 30,
  use_facilities_constraint boolean DEFAULT true,
  use_hours_constraint boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for facilities table
CREATE POLICY "Users can view own facilities"
  ON facilities FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own facilities"
  ON facilities FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own facilities"
  ON facilities FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own facilities"
  ON facilities FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for home_base table
CREATE POLICY "Users can view own home base"
  ON home_base FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own home base"
  ON home_base FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own home base"
  ON home_base FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own home base"
  ON home_base FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for route_plans table
CREATE POLICY "Users can view own route plans"
  ON route_plans FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own route plans"
  ON route_plans FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own route plans"
  ON route_plans FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own route plans"
  ON route_plans FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for user_settings table
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
  ON user_settings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_facilities_user_id ON facilities(user_id);
CREATE INDEX IF NOT EXISTS idx_facilities_upload_batch_id ON facilities(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_user_id ON route_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_created_at ON route_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);