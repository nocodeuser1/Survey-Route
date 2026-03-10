-- Create facility regulations and documents tables for facility summary views

CREATE TABLE IF NOT EXISTS facility_regulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  effective_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_regulations_facility_id
  ON facility_regulations(facility_id);

CREATE INDEX IF NOT EXISTS idx_facility_regulations_type
  ON facility_regulations(type);

ALTER TABLE facility_regulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view facility regulations in their account"
  ON facility_regulations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_regulations.facility_id
        AND au.user_id = auth.uid()
    )
  );

CREATE POLICY "Account admins can insert facility regulations"
  ON facility_regulations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_regulations.facility_id
        AND au.user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );

CREATE POLICY "Account admins can update facility regulations"
  ON facility_regulations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_regulations.facility_id
        AND au.user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );

CREATE POLICY "Account admins can delete facility regulations"
  ON facility_regulations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_regulations.facility_id
        AND au.user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );

CREATE TABLE IF NOT EXISTS facility_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  type text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_documents_facility_id
  ON facility_documents(facility_id);

CREATE INDEX IF NOT EXISTS idx_facility_documents_type
  ON facility_documents(type);

ALTER TABLE facility_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view facility documents in their account"
  ON facility_documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_documents.facility_id
        AND au.user_id = auth.uid()
    )
  );

CREATE POLICY "Account admins can insert facility documents"
  ON facility_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_documents.facility_id
        AND au.user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );

CREATE POLICY "Account admins can update facility documents"
  ON facility_documents
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_documents.facility_id
        AND au.user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );

CREATE POLICY "Account admins can delete facility documents"
  ON facility_documents
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE f.id = facility_documents.facility_id
        AND au.user_id = auth.uid()
        AND au.role = 'account_admin'
    )
  );
