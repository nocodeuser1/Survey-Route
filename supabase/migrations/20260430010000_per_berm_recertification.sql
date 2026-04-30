/*
  # Per-berm SPCC recertification

  Each berm runs its own 5-year recertification cycle (separate PE stamp,
  separate plan PDF, separate "Approval by Management" page). The
  recertification decision (no_changes / changes_found), notes, decision
  date, and the recertified_date now live on `spcc_plans` instead of
  `facilities`.

  ## New columns on spcc_plans

  - `recertification_decision`        text  CHECK (no_changes | changes_found | NULL)
  - `recertification_decision_notes`  text
  - `recertification_decision_at`     timestamptz
  - `recertified_date`                date  — set on successful PDF swap

  ## Backfill

  Each spcc_plans row inherits the values from its parent facility (where
  the fields used to live). Facilities with multiple berms get the same
  facility-level value copied to every berm — operators can refine per-berm
  going forward.

  ## Mirror trigger

  Extends the existing `sync_facility_from_spcc_plans` so the legacy
  facility-level columns become a worst-case summary of the per-berm
  reality (so the existing facilities-tab pill, map popup, and rollup
  surfaces keep working without changes):

    - facilities.recertified_date           = MIN across berms (earliest = soonest re-due)
    - facilities.recertification_decision   = NULL if any berm is undecided in its
                                              recert window; else the LEAST-good
                                              decision (changes_found > no_changes)
    - facilities.recertification_decision_notes = NULL on facility (notes are per-berm)
    - facilities.recertification_decision_at    = MAX across berms (when ALL decided)

  Editing happens at berm level only going forward. The facility-level
  columns are read-only mirrors maintained by this trigger.
*/

-- 1. Columns on spcc_plans
ALTER TABLE spcc_plans
  ADD COLUMN IF NOT EXISTS recertification_decision text
    CHECK (recertification_decision IN ('no_changes', 'changes_found')),
  ADD COLUMN IF NOT EXISTS recertification_decision_notes text,
  ADD COLUMN IF NOT EXISTS recertification_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS recertified_date date;

COMMENT ON COLUMN spcc_plans.recertification_decision IS
  'Per-berm self-certification at recertification time: no_changes | changes_found.';
COMMENT ON COLUMN spcc_plans.recertification_decision_notes IS
  'Per-berm notes describing what changed. Only meaningful for changes_found.';
COMMENT ON COLUMN spcc_plans.recertification_decision_at IS
  'When the per-berm decision was last set; doubles as the operator-facing site-visit date.';
COMMENT ON COLUMN spcc_plans.recertified_date IS
  'Per-berm date the recertification was completed (PDF page swapped). Resets the 5-year clock.';

-- 2. Backfill from facilities → each berm row of that facility
UPDATE spcc_plans p
SET
  recertification_decision = f.recertification_decision,
  recertification_decision_notes = f.recertification_decision_notes,
  recertification_decision_at = f.recertification_decision_at,
  recertified_date = f.recertified_date
FROM facilities f
WHERE p.facility_id = f.id
  AND p.recertification_decision IS NULL
  AND p.recertification_decision_notes IS NULL
  AND p.recertification_decision_at IS NULL
  AND p.recertified_date IS NULL;

-- 3. Replace mirror trigger function with the recertification-aware version
CREATE OR REPLACE FUNCTION public.sync_facility_from_spcc_plans()
RETURNS TRIGGER AS $$
DECLARE
  fid uuid;
  active_count integer;
  decided_count integer;
  any_changes_found boolean;
BEGIN
  fid := COALESCE(NEW.facility_id, OLD.facility_id);

  -- Existing mirror semantics (unchanged from previous migration)
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
    -- New mirror: recertified_date = earliest across berms (soonest to re-expire)
    recertified_date = (
      SELECT MIN(p.recertified_date) FROM public.spcc_plans p
      WHERE p.facility_id = fid
    )
  WHERE f.id = fid;

  -- Recertification decision rollup. Counts how many berms are in the
  -- recert window (have a pe_stamp_date and the 5-year clock is within
  -- 90 days or past) and how many of those have a decision recorded.
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
    -- Pending if any in-window berm hasn't decided; otherwise least-good decision
    recertification_decision = CASE
      WHEN active_count = 0 THEN NULL
      WHEN decided_count < active_count THEN NULL
      WHEN any_changes_found THEN 'changes_found'
      ELSE 'no_changes'
    END,
    -- Notes stay per-berm; facility level is summary-only
    recertification_decision_notes = NULL,
    -- Latest decision_at across berms when fully decided, else NULL
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

-- Trigger itself stays bound to the same function name; no DROP needed.

COMMENT ON FUNCTION public.sync_facility_from_spcc_plans() IS
  'Mirrors per-berm spcc_plans data onto facilities.spcc_* + facilities.recertification_* as a worst-case summary so legacy consumers keep working. Editing now happens at berm level.';

-- 4. Fire the trigger once for every facility so the new mirror columns
--    populate from the just-backfilled berm rows.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.facilities LOOP
    -- Touch any plan row for this facility to fire the AFTER trigger
    UPDATE public.spcc_plans SET updated_at = updated_at
     WHERE facility_id = r.id;
  END LOOP;
END $$;
