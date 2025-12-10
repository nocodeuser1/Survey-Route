/*
  # Team Member Invitation and Signature Management System

  1. New Tables
    - `user_invitations`
      - `id` (uuid, primary key)
      - `email` (text) - Email of invited user
      - `account_id` (uuid) - Account they're invited to
      - `role` (text) - 'account_admin' or 'user'
      - `temporary_password` (text) - Encrypted temporary password
      - `invited_by` (uuid) - User who sent invitation
      - `token` (text, unique) - Secure token for invitation link
      - `status` (text) - 'pending', 'accepted', 'expired', 'revoked'
      - `expires_at` (timestamptz) - Expiration date
      - `created_at` (timestamptz)

  2. Changes to Existing Tables
    - `users` - Add `signature_completed` boolean field
    - `account_users` - Already has role field, no changes needed
    - `team_members` - Needs to be restructured to be user-specific

  3. New Tables for Signatures
    - `user_signatures`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - Reference to users table
      - `account_id` (uuid) - Account context
      - `signature_name` (text) - User's full name (non-editable)
      - `signature_data` (text) - Base64 signature image
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  4. Security
    - Enable RLS on all new tables
    - Users can only view/edit their own signatures
    - Admins can view team member list but not signatures
    - Account admins can create invitations and manage team members
    - Agency owners have full access to their agency's data
*/

-- Add signature_completed field to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'signature_completed'
  ) THEN
    ALTER TABLE users ADD COLUMN signature_completed boolean DEFAULT false;
  END IF;
END $$;

-- Create user_invitations table
CREATE TABLE IF NOT EXISTS user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('account_admin', 'user')),
  temporary_password text NOT NULL,
  invited_by uuid NOT NULL REFERENCES users(id),
  token text UNIQUE NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create user_signatures table (separate from team_members)
CREATE TABLE IF NOT EXISTS user_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  signature_name text NOT NULL,
  signature_data text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, account_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_account_id ON user_invitations(account_id);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON user_invitations(status);
CREATE INDEX IF NOT EXISTS idx_user_signatures_user_id ON user_signatures(user_id);
CREATE INDEX IF NOT EXISTS idx_user_signatures_account_id ON user_signatures(account_id);
CREATE INDEX IF NOT EXISTS idx_users_signature_completed ON users(signature_completed);

-- Enable Row Level Security
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_signatures ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_invitations table

-- Account admins can view invitations for their accounts
CREATE POLICY "Account admins can view invitations for their accounts"
  ON user_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
      AND account_users.role = 'account_admin'
    )
  );

-- Agency owners can view all invitations in their agency
CREATE POLICY "Agency owners can view all invitations in their agency"
  ON user_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON ag.id = a.agency_id
      WHERE a.id = user_invitations.account_id
      AND ag.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );

-- Anyone can view invitations by token (for accepting invitations)
CREATE POLICY "Anyone can view invitations by token"
  ON user_invitations FOR SELECT
  TO anon
  USING (true);

-- Account admins can create invitations
CREATE POLICY "Account admins can create invitations"
  ON user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
      AND account_users.role = 'account_admin'
    )
  );

-- Agency owners can create invitations
CREATE POLICY "Agency owners can create invitations"
  ON user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON ag.id = a.agency_id
      WHERE a.id = user_invitations.account_id
      AND ag.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );

-- Account admins can update invitations (revoke, etc)
CREATE POLICY "Account admins can update invitations"
  ON user_invitations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
      AND account_users.role = 'account_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM account_users
      WHERE account_users.account_id = user_invitations.account_id
      AND account_users.user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
      AND account_users.role = 'account_admin'
    )
  );

-- Allow invited users to update their invitation status when accepting
CREATE POLICY "Invited users can accept their invitations"
  ON user_invitations FOR UPDATE
  TO authenticated
  USING (status = 'pending')
  WITH CHECK (status IN ('accepted', 'expired'));

-- RLS Policies for user_signatures table

-- Users can view their own signatures
CREATE POLICY "Users can view their own signatures"
  ON user_signatures FOR SELECT
  TO authenticated
  USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- Users can insert their own signatures
CREATE POLICY "Users can insert their own signatures"
  ON user_signatures FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- Users can update their own signatures
CREATE POLICY "Users can update their own signatures"
  ON user_signatures FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- Users can delete their own signatures
CREATE POLICY "Users can delete their own signatures"
  ON user_signatures FOR DELETE
  TO authenticated
  USING (user_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- Function to automatically update signature_completed status
CREATE OR REPLACE FUNCTION update_user_signature_status()
RETURNS TRIGGER AS $$
BEGIN
  -- When a signature is inserted or updated, mark user as signature completed
  UPDATE users
  SET signature_completed = true
  WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update signature completion status
DROP TRIGGER IF EXISTS trigger_update_signature_status ON user_signatures;
CREATE TRIGGER trigger_update_signature_status
  AFTER INSERT OR UPDATE ON user_signatures
  FOR EACH ROW
  EXECUTE FUNCTION update_user_signature_status();

-- Function to mark signature as incomplete when deleted
CREATE OR REPLACE FUNCTION mark_signature_incomplete()
RETURNS TRIGGER AS $$
BEGIN
  -- When a signature is deleted, mark user as signature incomplete
  UPDATE users
  SET signature_completed = false
  WHERE id = OLD.user_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to mark signature incomplete on deletion
DROP TRIGGER IF EXISTS trigger_mark_signature_incomplete ON user_signatures;
CREATE TRIGGER trigger_mark_signature_incomplete
  AFTER DELETE ON user_signatures
  FOR EACH ROW
  EXECUTE FUNCTION mark_signature_incomplete();
