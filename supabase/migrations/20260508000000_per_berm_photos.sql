/*
  # Per-berm photos_taken + visit_date

  ## Why
  When a facility has multiple berms, photos are taken berm-by-berm in the
  field. One berm can be visited and documented while another still needs
  photos. The single facility-level `facilities.photos_taken` /
  `facilities.field_visit_date` pair couldn't represent that — toggling it
  on for one berm implied "the whole facility is photographed", and there
  was no way to leave the second berm marked as still-needs-photos.

  ## What this adds
  Two columns on `spcc_plans`:
    - `photos_taken`     boolean  DEFAULT false
    - `field_visit_date` date     (when the photos were taken)

  Single-berm facilities still see one toggle in the SPCC modal
  (it just edits berm_index=1's row). Multi-berm facilities see one
  toggle per berm so each can be tracked independently.

  ## Backfill
  Every existing plan row inherits its parent facility's current
  photos_taken / field_visit_date. That makes single-berm facilities
  behave identically to before this migration. Multi-berm facilities
  start with both berms reflecting whatever the legacy facility-level
  flag was — the user can then split them.

  ## Mirror trigger
  Updates `sync_facility_from_spcc_plans()` so the facility-level
  columns track the worst-case berm:
    - `facilities.photos_taken` = TRUE only when EVERY berm has photos.
    - `facilities.field_visit_date` = the EARLIEST visit date among
      berms that have one (so "how stale is the oldest photo set?"
      keeps working in compliance / route logic).

  This preserves backwards compat: any code reading
  facilities.photos_taken keeps seeing "is the whole facility done?",
  which is what it always meant.

  ## Idempotent
  All DDL is IF NOT EXISTS or CREATE OR REPLACE. Safe to re-run.
*/

-- 1. Columns ----------------------------------------------------------------

ALTER TABLE public.spcc_plans
  ADD COLUMN IF NOT EXISTS photos_taken boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS field_visit_date date;

COMMENT ON COLUMN public.spcc_plans.photos_taken IS
  'Per-berm flag — has the field tech taken photos of THIS berm. Mirrored up to facilities.photos_taken (TRUE only when every berm is true).';
COMMENT ON COLUMN public.spcc_plans.field_visit_date IS
  'Per-berm visit date. Mirrored up to facilities.field_visit_date as MIN(date) across berms with a date set.';

-- 2. Backfill ---------------------------------------------------------------

UPDATE public.spcc_plans p
SET
  photos_taken = COALESCE(f.photos_taken, false),
  field_visit_date = f.field_visit_date
FROM public.facilities f
WHERE p.facility_id = f.id
  AND p.photos_taken = false                   -- don't clobber already-set rows
  AND p.field_visit_date IS NULL;

-- 3. Mirror trigger ---------------------------------------------------------
--    Replace sync_facility_from_spcc_plans() with a version that ALSO mirrors
--    photos_taken (AND-aggregate) and field_visit_date (MIN). Keeps the
--    existing plan_url / pe_stamp_date / workflow_status logic intact.

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
    -- Photos: TRUE only when every berm has its photos done. If there are
    -- no plans at all (shouldn't happen post-backfill, but be defensive),
    -- leave it as bool_and-of-empty-set = NULL → coerced to false below.
    photos_taken = COALESCE(
      (SELECT bool_and(p.photos_taken) FROM public.spcc_plans p
       WHERE p.facility_id = fid),
      false
    ),
    -- Visit date: earliest non-null per-berm date. NULL if no berm has one.
    field_visit_date = (
      SELECT MIN(p.field_visit_date) FROM public.spcc_plans p
      WHERE p.facility_id = fid
    )
  WHERE f.id = fid;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself is unchanged; just the function body. Re-attaching is
-- harmless and keeps this file self-contained for re-runs.
DROP TRIGGER IF EXISTS trg_sync_facility_from_spcc_plans ON public.spcc_plans;
CREATE TRIGGER trg_sync_facility_from_spcc_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.spcc_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_facility_from_spcc_plans();

-- 4. One-time facility resync ----------------------------------------------
--    Now that the trigger function is updated, force a recompute on every
--    facility so the new mirror columns reflect reality immediately.

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT DISTINCT facility_id FROM public.spcc_plans LOOP
    UPDATE public.facilities f
    SET
      photos_taken = COALESCE(
        (SELECT bool_and(p.photos_taken) FROM public.spcc_plans p
         WHERE p.facility_id = rec.facility_id),
        false
      ),
      field_visit_date = (
        SELECT MIN(p.field_visit_date) FROM public.spcc_plans p
        WHERE p.facility_id = rec.facility_id
      )
    WHERE f.id = rec.facility_id;
  END LOOP;
END $$;
