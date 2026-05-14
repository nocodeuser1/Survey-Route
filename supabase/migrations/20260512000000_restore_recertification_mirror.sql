/*
  # Restore recertified_date + recertification_decision mirrors

  ## Regression
  Migration 20260430010000 added a per-berm recertification model and
  taught `sync_facility_from_spcc_plans()` to mirror these fields up to
  facilities.*:
    - recertified_date
    - recertification_decision
    - recertification_decision_notes
    - recertification_decision_at

  The two photos migrations that followed (20260508000000 and 20260508010000)
  rewrote the trigger function via `CREATE OR REPLACE` to add photo columns,
  but their function bodies only included the SPCC + photos columns —
  silently dropping the recertification mirrors. After those migrations
  ran, completing the per-berm recertification flow correctly stamped
  spcc_plans.recertified_date, but facilities.recertified_date stayed
  NULL and `getSPCCPlanStatus` fell back to PE-stamp-based math →
  status displayed as "Expiring (26d)" instead of "Recertified".

  ## Fix
  Reissue the trigger function with the full set of mirrors (SPCC, photos,
  berm counts, AND recertification fields). One-time backfill at the end
  fires the trigger for every facility so facilities.recertified_date /
  recertification_* repopulate from the still-correct spcc_plans data.

  ## Idempotent
  CREATE OR REPLACE. Safe to re-run.
*/

CREATE OR REPLACE FUNCTION public.sync_facility_from_spcc_plans()
RETURNS TRIGGER AS $$
DECLARE
  fid uuid;
  active_count int;
  decided_count int;
  any_changes_found boolean;
BEGIN
  fid := COALESCE(NEW.facility_id, OLD.facility_id);

  -- 1. SPCC + photos mirrors (preserved from 20260508010000).
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
    ),
    -- RESTORED: recertified_date = earliest across berms (the worst-case
    -- soonest re-expiration). When ANY berm is recertified, the facility
    -- aggregate reflects it for the SPCC plan status calculator.
    recertified_date = (
      SELECT MIN(p.recertified_date) FROM public.spcc_plans p
      WHERE p.facility_id = fid
    )
  WHERE f.id = fid;

  -- 2. RESTORED: Recertification-decision rollup. Counts how many berms
  --    are in the recert window (pe_stamp_date set AND 5-year clock is
  --    within 90 days or past) and how many of those have decided.
  SELECT
    COUNT(*) FILTER (
      WHERE p.pe_stamp_date IS NOT NULL
        AND (p.pe_stamp_date + INTERVAL '5 years' - INTERVAL '90 days') <= CURRENT_DATE
    ),
    COUNT(*) FILTER (
      WHERE p.pe_stamp_date IS NOT NULL
        AND (p.pe_stamp_date + INTERVAL '5 years' - INTERVAL '90 days') <= CURRENT_DATE
        AND p.recertification_decision IS NOT NULL
    ),
    bool_or(p.recertification_decision = 'changes_found')
  INTO active_count, decided_count, any_changes_found
  FROM public.spcc_plans p
  WHERE p.facility_id = fid;

  UPDATE public.facilities f
  SET
    -- Pending until every in-window berm has decided; otherwise least-good.
    recertification_decision = CASE
      WHEN active_count = 0 THEN NULL
      WHEN decided_count < active_count THEN NULL
      WHEN any_changes_found THEN 'changes_found'
      ELSE 'no_changes'
    END,
    -- Notes stay per-berm; facility level is summary-only.
    recertification_decision_notes = NULL,
    -- Latest decision_at across berms when fully decided, else NULL.
    recertification_decision_at = CASE
      WHEN active_count > 0 AND decided_count = active_count THEN (
        SELECT MAX(p.recertification_decision_at) FROM public.spcc_plans p
        WHERE p.facility_id = fid
      )
      ELSE NULL
    END
  WHERE f.id = fid;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.sync_facility_from_spcc_plans() IS
  'Mirrors per-berm spcc_plans data onto facilities.* as a worst-case summary so legacy consumers (compliance trigger, route filters, status badge) keep working. Editing now happens at berm level. Mirrors include SPCC plan/PE/workflow, photos + berm counts, recertified_date, and recertification_decision rollup.';

DROP TRIGGER IF EXISTS trg_sync_facility_from_spcc_plans ON public.spcc_plans;
CREATE TRIGGER trg_sync_facility_from_spcc_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.spcc_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_facility_from_spcc_plans();

-- 3. One-time backfill so facilities.recertified_date / recertification_*
--    repopulate from the existing spcc_plans data right after this migration
--    runs. Without this, already-recertified facilities would stay stuck on
--    NULL until the next time something touched their spcc_plans row.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.facilities LOOP
    -- Touch any plan row to fire the AFTER trigger; updated_at = updated_at
    -- is a deliberate no-op write that exists solely to fire the trigger.
    UPDATE public.spcc_plans SET updated_at = updated_at
     WHERE facility_id = r.id;
  END LOOP;
END $$;
