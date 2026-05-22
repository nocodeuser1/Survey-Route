-- LDR Site Plan tracking
--
-- Adds a parallel, facility-level tracking surface for LDR site plans. This is
-- independent of the SPCC plan workflow — completing the LDR side does NOT
-- touch spcc_workflow_status, spcc_plan_url, or any other SPCC column. The two
-- statuses live side-by-side on the facility row.
--
-- Modeled after the SPCC plan-url pattern, but simplified:
--   * Facility-level (no per-berm rows)
--   * No PE stamp date concept
--   * Upload is optional — a facility can be "completed" without a file
--
-- ADDITIVE ONLY. Safe to re-run.

-- ============================================
-- 1. Columns on facilities
-- ============================================

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS ldr_site_plan_completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS ldr_site_plan_completed_at TIMESTAMPTZ NULL;

-- Who marked it completed. No FK so we don't break when an auth.users row is
-- removed; just track the UUID for audit purposes. Matches the pattern used
-- by other audit fields on this table.
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS ldr_site_plan_completed_by UUID NULL;

-- Public URL of the uploaded PDF (NULL means no file attached, even if
-- ldr_site_plan_completed=true — the user said upload is optional).
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS ldr_site_plan_url TEXT NULL;

-- Original filename, kept for display purposes (the storage path itself is
-- deterministic, so it doesn't carry the human-readable name).
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS ldr_site_plan_filename TEXT NULL;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS ldr_site_plan_uploaded_at TIMESTAMPTZ NULL;

-- Helpful for "facilities pending LDR" filters / counts in the UI.
CREATE INDEX IF NOT EXISTS idx_facilities_ldr_completed
  ON facilities(account_id, ldr_site_plan_completed);

COMMENT ON COLUMN facilities.ldr_site_plan_completed IS
  'True when the LDR site plan has been marked completed for this facility. Independent of SPCC plan status.';
COMMENT ON COLUMN facilities.ldr_site_plan_url IS
  'Public URL of the uploaded LDR site plan PDF in the ldr-site-plans bucket. NULL is valid even when completed=true (upload is optional).';

-- ============================================
-- 2. Storage bucket — mirrors spcc-plans pattern
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('ldr-site-plans', 'ldr-site-plans', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies for idempotent re-runs
DROP POLICY IF EXISTS "Public read access for ldr site plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload ldr site plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update ldr site plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete ldr site plans" ON storage.objects;

CREATE POLICY "Public read access for ldr site plans"
ON storage.objects FOR SELECT
USING (bucket_id = 'ldr-site-plans');

CREATE POLICY "Authenticated users can upload ldr site plans"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ldr-site-plans');

CREATE POLICY "Authenticated users can update ldr site plans"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'ldr-site-plans');

CREATE POLICY "Authenticated users can delete ldr site plans"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'ldr-site-plans');
