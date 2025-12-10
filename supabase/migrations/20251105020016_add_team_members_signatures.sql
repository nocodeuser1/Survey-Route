/*
  # Add Team Members / Inspectors Management

  1. New Tables
    - `team_members`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text, inspector name)
      - `title` (text, optional job title)
      - `signature_data` (text, signature as base64 data URL)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `team_members` table
    - Add policy for authenticated users to manage their own team members
*/

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  title text,
  signature_data text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own team members"
  ON team_members FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own team members"
  ON team_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own team members"
  ON team_members FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own team members"
  ON team_members FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);