-- Fix facility_comments RLS policies.
--
-- Problem: the original policies used auth.uid() directly against
--   • facilities.user_id  (stores a system placeholder, not real auth UIDs)
--   • account_users.user_id  (stores public.users.id, not auth.uid())
--
-- Fix: join through public.users.auth_user_id to bridge custom user IDs → auth UIDs.

DROP POLICY IF EXISTS "Users can view facility comments for accessible facilities" ON facility_comments;
DROP POLICY IF EXISTS "Users can create facility comments for accessible facilities" ON facility_comments;
DROP POLICY IF EXISTS "Users can update their own facility comments" ON facility_comments;
DROP POLICY IF EXISTS "Users can delete their own facility comments" ON facility_comments;

CREATE POLICY "facility_comments_select"
ON facility_comments FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM facilities f
    JOIN account_users au ON au.account_id = f.account_id
    JOIN users u ON u.id = au.user_id
    WHERE f.id = facility_comments.facility_id
      AND u.auth_user_id = auth.uid()
  )
);

CREATE POLICY "facility_comments_insert"
ON facility_comments FOR INSERT
WITH CHECK (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
  AND length(trim(body)) > 0
  AND EXISTS (
    SELECT 1
    FROM facilities f
    JOIN account_users au ON au.account_id = f.account_id
    JOIN users u ON u.id = au.user_id
    WHERE f.id = facility_id
      AND u.auth_user_id = auth.uid()
  )
);

CREATE POLICY "facility_comments_update"
ON facility_comments FOR UPDATE
USING (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
)
WITH CHECK (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
  AND length(trim(body)) > 0
);

CREATE POLICY "facility_comments_delete"
ON facility_comments FOR DELETE
USING (
  (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()
);
