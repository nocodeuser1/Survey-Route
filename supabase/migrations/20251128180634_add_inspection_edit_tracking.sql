/*
  # Add Inspection Edit Tracking System

  1. Changes to `inspections` table
    - Add `last_edited_by` (UUID, nullable) - User who last edited the inspection
    - Add `last_edited_at` (timestamptz, nullable) - When the inspection was last edited
    - Add `edit_count` (integer, default 0) - Number of times inspection has been edited

  2. New Tables
    - `inspection_edits` - Audit trail for all inspection edits
      - `id` (UUID, primary key)
      - `inspection_id` (UUID, foreign key to inspections)
      - `edited_by` (UUID, foreign key to auth.users)
      - `edited_at` (timestamptz, default now)
      - `changes_summary` (JSONB) - Details of what changed
      - `edit_reason` (text, nullable) - Optional reason for edit
      - `created_at` (timestamptz, default now)

  3. Security
    - Enable RLS on inspection_edits table
    - Add policies for agency owners to view edit history
    - Add policies for editors to create edit records

  4. Important Notes
    - Edit tracking preserves original conducted_at timestamp
    - Only agency owners can edit completed inspections
    - Full audit trail maintained for compliance
    - Changes are logged as JSONB for flexibility
*/

-- Add edit tracking columns to inspections table
ALTER TABLE inspections
ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;

-- Create inspection_edits audit table
CREATE TABLE IF NOT EXISTS inspection_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  edited_by UUID NOT NULL REFERENCES auth.users(id),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changes_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  edit_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_inspection_edits_inspection_id
ON inspection_edits(inspection_id);

CREATE INDEX IF NOT EXISTS idx_inspection_edits_edited_by
ON inspection_edits(edited_by);

CREATE INDEX IF NOT EXISTS idx_inspection_edits_edited_at
ON inspection_edits(edited_at DESC);

CREATE INDEX IF NOT EXISTS idx_inspections_last_edited_at
ON inspections(last_edited_at)
WHERE last_edited_at IS NOT NULL;

-- Enable RLS on inspection_edits table
ALTER TABLE inspection_edits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inspection_edits

-- Policy: Agency owners and admins can view edit history for their account's inspections
CREATE POLICY "Account admins can view inspection edits"
ON inspection_edits
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inspections i
    INNER JOIN account_users au ON au.account_id = i.account_id
    WHERE i.id = inspection_edits.inspection_id
    AND au.user_id = auth.uid()
    AND au.role = 'account_admin'
  )
);

-- Policy: Users who edited can view their own edit records
CREATE POLICY "Users can view own inspection edits"
ON inspection_edits
FOR SELECT
TO authenticated
USING (edited_by = auth.uid());

-- Policy: Authenticated users can insert edit records (will be validated by app logic)
CREATE POLICY "Authenticated users can create inspection edits"
ON inspection_edits
FOR INSERT
TO authenticated
WITH CHECK (
  edited_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM inspections i
    INNER JOIN account_users au ON au.account_id = i.account_id
    WHERE i.id = inspection_edits.inspection_id
    AND au.user_id = auth.uid()
  )
);

-- Add comments for documentation
COMMENT ON COLUMN inspections.last_edited_by IS 'User who last edited this inspection. NULL if never edited.';
COMMENT ON COLUMN inspections.last_edited_at IS 'Timestamp of last edit. NULL if never edited.';
COMMENT ON COLUMN inspections.edit_count IS 'Number of times this inspection has been edited by agency owners.';
COMMENT ON TABLE inspection_edits IS 'Audit trail for all edits made to completed inspections by agency owners.';
COMMENT ON COLUMN inspection_edits.changes_summary IS 'JSONB object containing details of what changed (before/after values).';
