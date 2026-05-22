-- LDAR Site Plan tracking
--
-- LDAR = Leak Detection And Repair. Adds a parallel, facility-level tracking
-- surface for LDAR site plans, independent of the SPCC plan workflow. Marking
-- the LDAR side complete does NOT touch any spcc_* column.
--
-- Modeled after the SPCC plan-url pattern, but simplified:
--   * Facility-level (no per-berm rows)
--   * No PE stamp date concept
--   * Upload is optional — a facility can be "completed" without a file
--
-- This migration also self-heals from an earlier draft that used "ldr_" naming:
-- if those columns / that bucket exist in this database, they're renamed in
-- place rather than duplicated. The DO blocks make it safe to run regardless
-- of whether the prior LDR draft was applied.
--
-- ADDITIVE / idempotent. Safe to re-run.

-- ============================================
-- 1. Columns on facilities — rename ldr_* → ldar_*, or create fresh
-- ============================================

DO $$
BEGIN
  -- If the earlier ldr_* columns exist, rename them. After this block the
  -- table has ldar_* columns regardless of starting state.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facilities'
      AND column_name = 'ldr_site_plan_completed'
  ) THEN
    ALTER TABLE facilities RENAME COLUMN ldr_site_plan_completed     TO ldar_site_plan_completed;
    ALTER TABLE facilities RENAME COLUMN ldr_site_plan_completed_at  TO ldar_site_plan_completed_at;
    ALTER TABLE facilities RENAME COLUMN ldr_site_plan_completed_by  TO ldar_site_plan_completed_by;
    ALTER TABLE facilities RENAME COLUMN ldr_site_plan_url           TO ldar_site_plan_url;
    ALTER TABLE facilities RENAME COLUMN ldr_site_plan_filename      TO ldar_site_plan_filename;
    ALTER TABLE facilities RENAME COLUMN ldr_site_plan_uploaded_at   TO ldar_site_plan_uploaded_at;
  END IF;
END $$;

-- Rename the old index too if it exists; the new index name is created below
-- via CREATE INDEX IF NOT EXISTS so this is just cleanup.
ALTER INDEX IF EXISTS idx_facilities_ldr_completed RENAME TO idx_facilities_ldar_completed;

-- Add columns fresh if they don't already exist (handles "never ran the LDR
-- draft" case).
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_site_plan_completed     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_site_plan_completed_at  TIMESTAMPTZ NULL;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_site_plan_completed_by  UUID NULL;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_site_plan_url           TEXT NULL;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_site_plan_filename      TEXT NULL;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_site_plan_uploaded_at   TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_facilities_ldar_completed
  ON facilities(account_id, ldar_site_plan_completed);

COMMENT ON COLUMN facilities.ldar_site_plan_completed IS
  'True when the LDAR (Leak Detection And Repair) site plan has been marked completed for this facility. Independent of SPCC plan status.';
COMMENT ON COLUMN facilities.ldar_site_plan_url IS
  'Public URL of the uploaded LDAR site plan PDF in the ldar-site-plans bucket. NULL is valid even when completed=true (upload is optional).';

-- ============================================
-- 2. Storage bucket — create ldar-site-plans, retire ldr-site-plans
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('ldar-site-plans', 'ldar-site-plans', true)
ON CONFLICT (id) DO NOTHING;

-- Best-effort cleanup of the old bucket from the earlier draft. We only attempt
-- to drop it after removing any objects (the feature was new, so this list
-- should be empty in practice). If it still won't drop, the migration
-- continues — the new bucket is what matters.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ldr-site-plans') THEN
    DELETE FROM storage.objects WHERE bucket_id = 'ldr-site-plans';
    BEGIN
      DELETE FROM storage.buckets WHERE id = 'ldr-site-plans';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not drop legacy ldr-site-plans bucket: %', SQLERRM;
    END;
  END IF;
END $$;

-- Drop existing policies for idempotent re-runs.
DROP POLICY IF EXISTS "Public read access for ldr site plans"          ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload ldr site plans"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update ldr site plans"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete ldr site plans"  ON storage.objects;
DROP POLICY IF EXISTS "Public read access for ldar site plans"         ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload ldar site plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update ldar site plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete ldar site plans" ON storage.objects;

CREATE POLICY "Public read access for ldar site plans"
ON storage.objects FOR SELECT
USING (bucket_id = 'ldar-site-plans');

CREATE POLICY "Authenticated users can upload ldar site plans"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ldar-site-plans');

CREATE POLICY "Authenticated users can update ldar site plans"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'ldar-site-plans');

CREATE POLICY "Authenticated users can delete ldar site plans"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'ldar-site-plans');
