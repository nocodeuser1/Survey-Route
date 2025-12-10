/*
  # Add Agency Ownership Transfer Support

  1. New Table
    - `agency_ownership_transfers`
      - `id` (uuid, primary key)
      - `agency_id` (uuid, references agencies)
      - `current_owner_email` (text)
      - `new_owner_email` (text)
      - `verification_token` (text, unique)
      - `verified_at` (timestamptz, nullable)
      - `expires_at` (timestamptz)
      - `created_at` (timestamptz)
      - `completed_at` (timestamptz, nullable)

  2. Security
    - Enable RLS on agency_ownership_transfers table
    - Only current agency owner can initiate transfers
    - Only the current owner can view pending transfers
*/

-- Create agency ownership transfers table
CREATE TABLE IF NOT EXISTS agency_ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  current_owner_email text NOT NULL,
  new_owner_email text NOT NULL,
  verification_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  verified_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT valid_emails CHECK (current_owner_email <> new_owner_email)
);

-- Enable RLS
ALTER TABLE agency_ownership_transfers ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only current agency owner can create and view transfers
CREATE POLICY "Agency owners can create ownership transfers" ON agency_ownership_transfers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
      AND agencies.owner_email = current_owner_email
    )
  );

CREATE POLICY "Agency owners can view ownership transfers" ON agency_ownership_transfers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
  );

CREATE POLICY "Agency owners can delete pending transfers" ON agency_ownership_transfers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies 
      WHERE agencies.id = agency_id 
      AND agencies.owner_email = (select auth.jwt()->>'email')
    )
    AND completed_at IS NULL
  );

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_agency_ownership_transfers_token 
  ON agency_ownership_transfers(verification_token);

CREATE INDEX IF NOT EXISTS idx_agency_ownership_transfers_agency_id 
  ON agency_ownership_transfers(agency_id);
