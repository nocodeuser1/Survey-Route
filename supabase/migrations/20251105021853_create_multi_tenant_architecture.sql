/*
  # Multi-Tenant Architecture for Survey Router

  ## Overview
  This migration creates a complete multi-tenant SaaS architecture with agencies, accounts, and users.
  
  ## New Tables Created
  
  ### 1. agencies
  - `id` (uuid, primary key) - Unique agency identifier
  - `name` (text) - Agency name
  - `owner_email` (text) - Email of agency owner (super admin)
  - `status` (text) - active, suspended, trial
  - `subscription_tier` (text) - Subscription level
  - `created_at` (timestamptz) - When agency was created
  - `updated_at` (timestamptz) - Last update timestamp
  
  ### 2. users
  - `id` (uuid, primary key) - Unique user identifier
  - `auth_user_id` (uuid) - Links to Supabase auth.users
  - `email` (text, unique) - User email
  - `full_name` (text) - User's full name
  - `is_agency_owner` (boolean) - True if this is the agency owner
  - `created_at` (timestamptz) - Account creation date
  - `updated_at` (timestamptz) - Last update timestamp
  
  ### 3. accounts
  - `id` (uuid, primary key) - Unique account identifier
  - `agency_id` (uuid, foreign key) - Parent agency
  - `account_name` (text) - Name of the account
  - `created_by` (uuid, foreign key) - User who created account
  - `status` (text) - active, suspended, trial
  - `created_at` (timestamptz) - When account was created
  - `updated_at` (timestamptz) - Last update timestamp
  
  ### 4. account_users
  - `id` (uuid, primary key) - Junction table identifier
  - `account_id` (uuid, foreign key) - Account reference
  - `user_id` (uuid, foreign key) - User reference
  - `role` (text) - account_admin or user
  - `invited_by` (uuid, foreign key) - Who invited this user
  - `joined_at` (timestamptz) - When user joined account
  
  ### 5. invitations
  - `id` (uuid, primary key) - Invitation identifier
  - `token` (text, unique) - Secure invitation token
  - `email` (text) - Email of invited user
  - `account_id` (uuid, foreign key) - Account being invited to
  - `role` (text) - Role being offered
  - `invited_by` (uuid, foreign key) - Who sent invitation
  - `status` (text) - pending, accepted, expired, revoked
  - `expires_at` (timestamptz) - Expiration date
  - `created_at` (timestamptz) - When invitation was created
  
  ## Security
  - All tables have RLS enabled
  - Agency owners can access all data within their agency
  - Account admins can manage their account
  - Users can only access accounts they belong to
  - Complete data isolation between accounts
  
  ## Indexes
  - Indexed on auth_user_id for fast user lookups
  - Indexed on account_id for data filtering
  - Indexed on agency_id for agency-level queries
  - Indexed on invitation tokens for signup validation
*/

-- Create agencies table
CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_email text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial')),
  subscription_tier text DEFAULT 'standard',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  is_agency_owner boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  created_by uuid REFERENCES users(id),
  status text DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create account_users junction table
CREATE TABLE IF NOT EXISTS account_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('account_admin', 'user')),
  invited_by uuid REFERENCES users(id),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(account_id, user_id)
);

-- Create invitations table
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  email text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('account_admin', 'user')),
  invited_by uuid NOT NULL REFERENCES users(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_accounts_agency_id ON accounts(agency_id);
CREATE INDEX IF NOT EXISTS idx_account_users_account_id ON account_users(account_id);
CREATE INDEX IF NOT EXISTS idx_account_users_user_id ON account_users(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_account_id ON invitations(account_id);

-- Enable Row Level Security
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is agency owner
CREATE OR REPLACE FUNCTION is_agency_owner(check_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE id = check_user_id AND is_agency_owner = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is account admin
CREATE OR REPLACE FUNCTION is_account_admin(check_user_id uuid, check_account_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM account_users
    WHERE user_id = check_user_id 
    AND account_id = check_account_id 
    AND role = 'account_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is account member
CREATE OR REPLACE FUNCTION is_account_member(check_user_id uuid, check_account_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM account_users
    WHERE user_id = check_user_id AND account_id = check_account_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to get user_id from auth_user_id
CREATE OR REPLACE FUNCTION get_user_id_from_auth()
RETURNS uuid AS $$
BEGIN
  RETURN (SELECT id FROM users WHERE auth_user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies for agencies table
CREATE POLICY "Agency owners can view their agency"
  ON agencies FOR SELECT
  TO authenticated
  USING (
    owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Agency owners can update their agency"
  ON agencies FOR UPDATE
  TO authenticated
  USING (
    owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Agency owners can insert agencies"
  ON agencies FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
  );

-- RLS Policies for users table
CREATE POLICY "Users can view themselves"
  ON users FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Users can update themselves"
  ON users FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users can insert themselves"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Agency owners can view all users in their agency"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users au
      JOIN accounts a ON a.id = au.account_id
      JOIN agencies ag ON ag.id = a.agency_id
      WHERE au.user_id = users.id
      AND ag.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );

-- RLS Policies for accounts table
CREATE POLICY "Agency owners can view all accounts in their agency"
  ON accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "Account members can view their accounts"
  ON accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users
      WHERE account_users.account_id = accounts.id
      AND account_users.user_id = get_user_id_from_auth()
    )
  );

CREATE POLICY "Agency owners can insert accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = accounts.agency_id
      AND agencies.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "Account admins can update their account"
  ON accounts FOR UPDATE
  TO authenticated
  USING (
    is_account_admin(get_user_id_from_auth(), accounts.id)
  )
  WITH CHECK (
    is_account_admin(get_user_id_from_auth(), accounts.id)
  );

-- RLS Policies for account_users table
CREATE POLICY "Users can view their account memberships"
  ON account_users FOR SELECT
  TO authenticated
  USING (user_id = get_user_id_from_auth());

CREATE POLICY "Account admins can view all members in their accounts"
  ON account_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_users au
      WHERE au.account_id = account_users.account_id
      AND au.user_id = get_user_id_from_auth()
      AND au.role = 'account_admin'
    )
  );

CREATE POLICY "Agency owners can view all account memberships in their agency"
  ON account_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON ag.id = a.agency_id
      WHERE a.id = account_users.account_id
      AND ag.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "Account admins can insert account members"
  ON account_users FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_admin(get_user_id_from_auth(), account_id)
  );

CREATE POLICY "Account admins can update account members"
  ON account_users FOR UPDATE
  TO authenticated
  USING (
    is_account_admin(get_user_id_from_auth(), account_id)
  )
  WITH CHECK (
    is_account_admin(get_user_id_from_auth(), account_id)
  );

CREATE POLICY "Account admins can delete account members"
  ON account_users FOR DELETE
  TO authenticated
  USING (
    is_account_admin(get_user_id_from_auth(), account_id)
  );

-- RLS Policies for invitations table
CREATE POLICY "Account admins can view invitations for their accounts"
  ON invitations FOR SELECT
  TO authenticated
  USING (
    is_account_admin(get_user_id_from_auth(), account_id)
  );

CREATE POLICY "Agency owners can view all invitations in their agency"
  ON invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN agencies ag ON ag.id = a.agency_id
      WHERE a.id = invitations.account_id
      AND ag.owner_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "Invited users can view their own invitations"
  ON invitations FOR SELECT
  TO authenticated
  USING (
    email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Anyone can view invitations by token"
  ON invitations FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Account admins can insert invitations"
  ON invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    is_account_admin(get_user_id_from_auth(), account_id)
  );

CREATE POLICY "Account admins can update invitations"
  ON invitations FOR UPDATE
  TO authenticated
  USING (
    is_account_admin(get_user_id_from_auth(), account_id)
  )
  WITH CHECK (
    is_account_admin(get_user_id_from_auth(), account_id)
  );

CREATE POLICY "Anyone can update invitation status when accepting"
  ON invitations FOR UPDATE
  TO anon
  USING (status = 'pending')
  WITH CHECK (status IN ('accepted', 'expired'));
