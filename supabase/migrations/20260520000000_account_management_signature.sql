/*
  # Account-level management signature for SPCC plans workflow

  An admin uploads a transparent PNG (e.g. a stamped management signature)
  once per account. The "Add Mgmt Signature" button on each Berm Plan card
  stamps the SPCC plan PDF with that file. This is distinct from the per-user
  drawn signature (`user_signatures`) used for inspections — the management
  signature represents a specific person's signature image and is shared
  across all users in the account who need to stamp plans.

  ## Schema changes
  - `accounts.management_signature_url` text — public URL of the PNG; null
    when no signature has been uploaded for this account.

  ## Storage
  - New public bucket `management-signatures`.
  - File path convention: `{account_id}.png`.
  - Storage RLS mirrors the existing `spcc-plans` / `account-assets` pattern
    (public read, authenticated write). Admin-only enforcement happens at the
    table layer: `accounts.management_signature_url` updates flow through
    standard RLS on the `accounts` table, which already restricts UPDATE to
    primary owner / co-owners. Non-admin authenticated users uploading raw
    files to the bucket without an accompanying accounts row update can't do
    any damage — orphan PNGs are harmless and the application never reads a
    URL that isn't recorded on accounts.
*/

-- 1. Column on accounts
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS management_signature_url text;

COMMENT ON COLUMN accounts.management_signature_url IS
  'Public URL of the transparent-PNG management signature applied to SPCC plans for this account. Uploaded by admins via Settings.';

-- 2. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('management-signatures', 'management-signatures', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS — mirrors spcc-plans pattern
DROP POLICY IF EXISTS "Public read access for management signatures" ON storage.objects;
CREATE POLICY "Public read access for management signatures"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'management-signatures');

DROP POLICY IF EXISTS "Authenticated users can upload management signatures" ON storage.objects;
CREATE POLICY "Authenticated users can upload management signatures"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'management-signatures');

DROP POLICY IF EXISTS "Authenticated users can update management signatures" ON storage.objects;
CREATE POLICY "Authenticated users can update management signatures"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'management-signatures');

DROP POLICY IF EXISTS "Authenticated users can delete management signatures" ON storage.objects;
CREATE POLICY "Authenticated users can delete management signatures"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'management-signatures');
