-- Fix survey_types / survey_fields SELECT RLS so agency owners can read
-- their accounts' rows.
--
-- The original SELECT policies (in 20260214170000_create_custom_surveys_system.sql)
-- only checked the account_users membership table. Agency owners access
-- accounts via agencies.owner_email and don't typically have a
-- membership row on every sub-account they own, so for them the
-- survey_types query returned 0 rows — surfacing in the UI as the
-- Route Planning mode switcher collapsing down to just "All Facilities"
-- on agency-owned accounts (e.g. Validus under BEAR DATA).
--
-- Fix: swap the bespoke account_users check for the existing
-- user_has_account_access(uuid) helper, which already handles both the
-- direct-member and agency-owner paths.

DROP POLICY IF EXISTS "Users can view their account survey types" ON survey_types;
CREATE POLICY "Users can view their account survey types"
  ON survey_types FOR SELECT
  TO authenticated
  USING (user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can view survey fields for their account" ON survey_fields;
CREATE POLICY "Users can view survey fields for their account"
  ON survey_fields FOR SELECT
  TO authenticated
  USING (
    survey_type_id IN (
      SELECT id FROM survey_types
      WHERE user_has_account_access(account_id)
    )
  );
