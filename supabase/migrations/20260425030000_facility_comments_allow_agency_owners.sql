/*
  # Allow agency owners to use facility_comments

  The 2026-04-17 RLS fix routed facility_comments access through
  `account_users` membership. That covers regular users invited to an
  account, but agency owners (users with `is_agency_owner = true` who own
  an `agencies` row whose accounts contain the facility) typically aren't
  in `account_users` for their own accounts. They could see facilities
  via other policies but were 403'd when trying to comment.

  Concrete repro: an agency owner clicks Add comment on a facility's
  detail modal → POST /rest/v1/facility_comments returns 403, the new
  in-app error surfaces "new row violates row-level security policy".

  This migration adds an OR clause to each policy that resolves the user
  → agency → account → facility chain through `users.email = agencies.owner_email`,
  so the agency owner is allowed to act on facility_comments for any
  facility under their agency without needing a synthetic account_users row.

  Idempotent — DROP POLICY IF EXISTS / CREATE POLICY pattern.
*/

DROP POLICY IF EXISTS "facility_comments_select" ON facility_comments;
CREATE POLICY "facility_comments_select"
ON facility_comments FOR SELECT
USING (
  -- Path A: regular user, in account_users for the facility's account.
  EXISTS (
    SELECT 1
    FROM facilities f
    JOIN account_users au ON au.account_id = f.account_id
    JOIN users u ON u.id = au.user_id
    WHERE f.id = facility_comments.facility_id
      AND u.auth_user_id = auth.uid()
  )
  OR
  -- Path B: agency owner of the agency that owns the facility's account.
  EXISTS (
    SELECT 1
    FROM facilities f
    JOIN accounts acc ON acc.id = f.account_id
    JOIN agencies a ON a.id = acc.agency_id
    JOIN users u ON u.email = a.owner_email
    WHERE f.id = facility_comments.facility_id
      AND u.auth_user_id = auth.uid()
      AND u.is_agency_owner = true
  )
);

DROP POLICY IF EXISTS "facility_comments_insert" ON facility_comments;
CREATE POLICY "facility_comments_insert"
ON facility_comments FOR INSERT
WITH CHECK (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
  AND length(trim(body)) > 0
  AND (
    EXISTS (
      SELECT 1
      FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      JOIN users u ON u.id = au.user_id
      WHERE f.id = facility_id
        AND u.auth_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM facilities f
      JOIN accounts acc ON acc.id = f.account_id
      JOIN agencies a ON a.id = acc.agency_id
      JOIN users u ON u.email = a.owner_email
      WHERE f.id = facility_id
        AND u.auth_user_id = auth.uid()
        AND u.is_agency_owner = true
    )
  )
);

-- update / delete: keep the "must be the comment author" rule. Agency
-- owners can author comments and edit/delete their own — same as everyone
-- else. They don't get global moderation here; if you want that, add a
-- separate clause that mirrors the account-scope check above.

DROP POLICY IF EXISTS "facility_comments_update" ON facility_comments;
CREATE POLICY "facility_comments_update"
ON facility_comments FOR UPDATE
USING (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
)
WITH CHECK (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
  AND length(trim(body)) > 0
);

DROP POLICY IF EXISTS "facility_comments_delete" ON facility_comments;
CREATE POLICY "facility_comments_delete"
ON facility_comments FOR DELETE
USING (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
);
