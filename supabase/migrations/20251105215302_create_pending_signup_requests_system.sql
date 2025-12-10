/*
  # Create Pending Signup Requests System

  1. New Tables
    - `pending_signup_requests`
      - `id` (uuid, primary key)
      - `full_name` (text, required) - Requester's full name
      - `company_name` (text, required) - Company/organization name
      - `role` (text, required) - Job title or role
      - `email` (text, required, unique for pending) - Contact email
      - `message` (text, optional) - Additional message from requester
      - `status` (text, default 'pending') - Status: pending, approved, rejected
      - `reviewed_at` (timestamptz) - When request was reviewed
      - `reviewed_by` (uuid) - User ID who reviewed the request
      - `rejection_reason` (text) - Reason if rejected
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS on `pending_signup_requests` table
    - Allow public INSERT for new signup requests
    - Only agency owners can view and update requests
    - Add index on email and status for efficient queries

  3. Important Notes
    - Public users can submit requests (INSERT only)
    - Agency owners can view all requests and approve/reject them
    - Email notifications will be handled separately via edge functions
*/

-- Create pending_signup_requests table
CREATE TABLE IF NOT EXISTS pending_signup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  company_name text NOT NULL,
  role text NOT NULL,
  email text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_pending_signup_requests_email ON pending_signup_requests(email);
CREATE INDEX IF NOT EXISTS idx_pending_signup_requests_status ON pending_signup_requests(status);
CREATE INDEX IF NOT EXISTS idx_pending_signup_requests_created_at ON pending_signup_requests(created_at DESC);

-- Enable RLS
ALTER TABLE pending_signup_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to insert new signup requests (public access)
CREATE POLICY "Anyone can submit signup requests"
  ON pending_signup_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Policy: Agency owners can view all requests
CREATE POLICY "Agency owners can view signup requests"
  ON pending_signup_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
      AND users.is_agency_owner = true
    )
  );

-- Policy: Agency owners can update requests (approve/reject)
CREATE POLICY "Agency owners can update signup requests"
  ON pending_signup_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
      AND users.is_agency_owner = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
      AND users.is_agency_owner = true
    )
  );

-- Add unique constraint to prevent duplicate pending requests with same email
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_signup_requests_unique_pending_email 
  ON pending_signup_requests(email) 
  WHERE status = 'pending';