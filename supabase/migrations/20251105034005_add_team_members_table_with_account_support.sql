/*
  # Add Team Members / Inspectors Management

  1. New Tables
    - `team_members`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users) - the auth user who created this
      - `account_id` (uuid, references accounts) - the account this member belongs to
      - `name` (text, inspector name)
      - `title` (text, optional job title)
      - `signature_data` (text, signature as base64 data URL)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `team_members` table
    - Add policies for authenticated users to manage team members in their accounts
    - Add policies for agency owners to view all team members across their accounts
*/

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  signature_data text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Users can view team members in their accounts
CREATE POLICY "Users can view team members in their accounts"
  ON team_members FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = auth.uid()
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = auth.jwt()->>'email'
    )
  );

-- Users can insert team members in their accounts
CREATE POLICY "Users can insert team members in their accounts"
  ON team_members FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = auth.uid()
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = auth.jwt()->>'email'
    )
  );

-- Users can update team members in their accounts
CREATE POLICY "Users can update team members in their accounts"
  ON team_members FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = auth.uid()
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = auth.jwt()->>'email'
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = auth.uid()
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = auth.jwt()->>'email'
    )
  );

-- Users can delete team members in their accounts
CREATE POLICY "Users can delete team members in their accounts"
  ON team_members FOR DELETE
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM account_users WHERE user_id = auth.uid()
    )
    OR account_id IN (
      SELECT accounts.id FROM accounts
      JOIN agencies ON accounts.agency_id = agencies.id
      WHERE agencies.owner_email = auth.jwt()->>'email'
    )
  );
