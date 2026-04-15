/*
  # Create Facility Comments

  Adds a lightweight comment thread for facilities so users can leave dated notes
  directly inside the facility overview modal.
*/

CREATE TABLE IF NOT EXISTS facility_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_comments_facility_created_at
  ON facility_comments(facility_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_facility_comments_user_id
  ON facility_comments(user_id);

ALTER TABLE facility_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view facility comments for accessible facilities"
  ON facility_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM facilities f
      WHERE f.id = facility_comments.facility_id
        AND (
          f.user_id = auth.uid()
          OR f.account_id IN (
            SELECT account_id
            FROM account_users
            WHERE user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "Users can create facility comments for accessible facilities"
  ON facility_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND length(trim(body)) > 0
    AND EXISTS (
      SELECT 1
      FROM facilities f
      WHERE f.id = facility_comments.facility_id
        AND (
          f.user_id = auth.uid()
          OR f.account_id IN (
            SELECT account_id
            FROM account_users
            WHERE user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "Users can update their own facility comments"
  ON facility_comments
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND length(trim(body)) > 0);

CREATE POLICY "Users can delete their own facility comments"
  ON facility_comments
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_facility_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facility_comments_updated_at ON facility_comments;

CREATE TRIGGER facility_comments_updated_at
  BEFORE UPDATE ON facility_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_facility_comments_updated_at();

COMMENT ON TABLE facility_comments IS 'Threaded comments left by users on a facility overview';
COMMENT ON COLUMN facility_comments.author_name IS 'Display name captured at the time the comment was created';
COMMENT ON COLUMN facility_comments.body IS 'Free-form comment body shown in the facility overview modal';
