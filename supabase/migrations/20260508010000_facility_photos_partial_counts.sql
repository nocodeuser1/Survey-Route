/*
  # Surface "photos partially taken" state on facilities

  ## Why
  Once each berm tracks its own photos_taken, a 2-berm facility can be in a
  hybrid state: berm 1 photographed, berm 2 not. The previous mirror just
  AND'd photos_taken across berms — true only when EVERY berm was done — so
  the facility row showed "no photos" for the partial case, which is
  misleading. The UI needs to know "1 of 2" to render a mixed indicator.

  ## What this adds
  Two integer columns on `facilities`, both mirrored by the trigger:
    - `berms_total_count`        — total berms on this facility (= row count
                                    in spcc_plans for that facility_id)
    - `berms_with_photos_count`  — berms whose photos_taken is TRUE

  Derived states the UI reads from those two:
    - `total = 0`                          — no plans yet (rare, pre-backfill)
    - `with = 0`                           — none done   → red
    - `with = total`                       — all done    → green (matches
                                             facilities.photos_taken = TRUE)
    - `0 < with < total`                   — partial     → mixed indicator

  Keeping `photos_taken` (the AND-aggregate) untouched preserves backwards
  compat — anything reading just that boolean still gets "is the whole
  facility done?".

  ## Idempotent
  Columns added IF NOT EXISTS. Trigger function replaced. Safe to re-run.
*/

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS berms_total_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS berms_with_photos_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.facilities.berms_total_count IS
  'Number of berm rows in spcc_plans for this facility. Mirrored by sync_facility_from_spcc_plans().';
COMMENT ON COLUMN public.facilities.berms_with_photos_count IS
  'Number of berms on this facility that have photos_taken = TRUE. UI uses this with berms_total_count to render an "all / partial / none" badge.';

-- Update the mirror trigger function to populate the two counts. Everything
-- else in the function is unchanged from migration 20260508000000_per_berm_photos.sql.

CREATE OR REPLACE FUNCTION public.sync_facility_from_spcc_plans()
RETURNS TRIGGER AS $$
DECLARE
  fid uuid;
BEGIN
  fid := COALESCE(NEW.facility_id, OLD.facility_id);

  UPDATE public.facilities f
  SET
    spcc_plan_url = (
      SELECT p.plan_url FROM public.spcc_plans p
      WHERE p.facility_id = fid AND p.plan_url IS NOT NULL
      ORDER BY p.pe_stamp_date ASC NULLS LAST, p.berm_index ASC
      LIMIT 1
    ),
    spcc_pe_stamp_date = (
      SELECT MIN(p.pe_stamp_date) FROM public.spcc_plans p
      WHERE p.facility_id = fid
    ),
    spcc_workflow_status = (
      SELECT p.workflow_status FROM public.spcc_plans p
      WHERE p.facility_id = fid AND p.workflow_status IS NOT NULL
      ORDER BY
        CASE p.workflow_status
          WHEN 'awaiting_pe_stamp'   THEN 1
          WHEN 'site_visited'        THEN 2
          WHEN 'pe_stamped'          THEN 3
          WHEN 'completed_uploaded'  THEN 4
        END ASC,
        p.berm_index ASC
      LIMIT 1
    ),
    spcc_workflow_status_overridden = COALESCE(
      (SELECT bool_or(p.workflow_status_overridden) FROM public.spcc_plans p
       WHERE p.facility_id = fid),
      false
    ),
    photos_taken = COALESCE(
      (SELECT bool_and(p.photos_taken) FROM public.spcc_plans p
       WHERE p.facility_id = fid),
      false
    ),
    field_visit_date = (
      SELECT MIN(p.field_visit_date) FROM public.spcc_plans p
      WHERE p.facility_id = fid
    ),
    berms_total_count = COALESCE(
      (SELECT COUNT(*)::int FROM public.spcc_plans p WHERE p.facility_id = fid),
      0
    ),
    berms_with_photos_count = COALESCE(
      (SELECT COUNT(*)::int FROM public.spcc_plans p
       WHERE p.facility_id = fid AND p.photos_taken IS TRUE),
      0
    )
  WHERE f.id = fid;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_facility_from_spcc_plans ON public.spcc_plans;
CREATE TRIGGER trg_sync_facility_from_spcc_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.spcc_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_facility_from_spcc_plans();

-- One-time backfill: recompute counts for every facility now.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT id FROM public.facilities LOOP
    UPDATE public.facilities f
    SET
      berms_total_count = COALESCE(
        (SELECT COUNT(*)::int FROM public.spcc_plans p WHERE p.facility_id = rec.id),
        0
      ),
      berms_with_photos_count = COALESCE(
        (SELECT COUNT(*)::int FROM public.spcc_plans p
         WHERE p.facility_id = rec.id AND p.photos_taken IS TRUE),
        0
      )
    WHERE f.id = rec.id;
  END LOOP;
END $$;
