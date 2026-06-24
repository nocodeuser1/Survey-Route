/*
  # Checklist-style "resolve" for facility comments

  Adds the ability to check a comment off like a to-do item:
    - resolved_at      : when it was checked off (NULL = still open)
    - resolved_by_name : display name of whoever checked it off

  Two supporting changes:

  1. The updated_at trigger now only bumps updated_at when the BODY changes,
     so checking a comment off doesn't make it show as "(edited)".

  2. The UPDATE policy gains the same agency-owner clause that SELECT and
     INSERT already have, so an agency owner can check off (or re-open) any
     comment under their agency — not just their own. Regular users remain
     limited to their own comments. The body-non-empty WITH CHECK is kept.

  Idempotent.
*/

ALTER TABLE facility_comments
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_name text;

COMMENT ON COLUMN facility_comments.resolved_at IS 'When the comment was checked off / resolved (NULL = still open)';
COMMENT ON COLUMN facility_comments.resolved_by_name IS 'Display name of whoever checked the comment off';

-- Only bump updated_at on a real body edit, so resolving stays invisible to
-- the "(edited)" indicator.
CREATE OR REPLACE FUNCTION update_facility_comments_updated_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Allow the comment author OR an agency owner of the facility's agency to
-- update the row (mirrors the SELECT/INSERT scope added 2026-04-25).
DROP POLICY IF EXISTS "facility_comments_update" ON facility_comments;
CREATE POLICY "facility_comments_update"
ON facility_comments FOR UPDATE
USING (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM facilities f
    JOIN accounts acc ON acc.id = f.account_id
    JOIN agencies a ON a.id = acc.agency_id
    JOIN users u ON u.email = a.owner_email
    WHERE f.id = facility_comments.facility_id
      AND u.auth_user_id = auth.uid()
      AND u.is_agency_owner = true
  )
)
WITH CHECK (
  (
    (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM facilities f
      JOIN accounts acc ON acc.id = f.account_id
      JOIN agencies a ON a.id = acc.agency_id
      JOIN users u ON u.email = a.owner_email
      WHERE f.id = facility_comments.facility_id
        AND u.auth_user_id = auth.uid()
        AND u.is_agency_owner = true
    )
  )
  AND length(trim(body)) > 0
);
