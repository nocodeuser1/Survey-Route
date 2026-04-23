/*
  # Multi-berm SPCC Plans

  Before this migration: each facility had at most ONE SPCC plan, stored as
  three columns on the `facilities` row:
    - facilities.spcc_plan_url
    - facilities.spcc_pe_stamp_date
    - facilities.spcc_workflow_status
    - facilities.spcc_workflow_status_overridden

  That model doesn't capture facilities with multiple berms on a well pad,
  where each berm can require its own SPCC plan and each plan covers a
  specific subset of the facility's wells.

  This migration introduces a dedicated `spcc_plans` table (one row per berm),
  backfills existing data (every facility with any plan data gets a berm_index=1
  row), and installs a trigger that mirrors the "worst-case" berm back onto
  the legacy facility columns so downstream consumers — compliance trigger,
  route planner, facility list filters, bulk import — keep working without
  changes during the transition.

  Wells stay in their existing columnar home on the facilities table
  (well_name_1..6, well_api_1..6). Per-plan coverage is expressed as an
  integer[] on the plan row (e.g. {1,3,5} means "this plan covers the wells
  at well_name_1, well_name_3, well_name_5").

  Max 6 berms per facility (matches the 6 well column cap).

  Safe to run more than once — all DDL is idempotent.
*/

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spcc_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,

  -- 1..6, the "Berm N" ordinal. Stable across renames.
  berm_index integer NOT NULL,
  -- Optional free-text label (e.g. "North Berm", "Primary Containment").
  berm_label text,

  -- Plan file + certification, mirrors the old facility columns.
  plan_url text,
  pe_stamp_date date,
  workflow_status text,
  workflow_status_overridden boolean NOT NULL DEFAULT false,

  -- Which wells on the facility this plan covers. Array of indices 1..6
  -- corresponding to well_name_1..well_name_6 on the facility row. Empty array
  -- means "no wells assigned" (surfaces as an alert in the UI).
  assigned_well_indices integer[] NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT spcc_plans_berm_index_range
    CHECK (berm_index >= 1 AND berm_index <= 6),
  CONSTRAINT spcc_plans_workflow_status_valid
    CHECK (
      workflow_status IS NULL
      OR workflow_status IN (
        'awaiting_pe_stamp', 'site_visited', 'pe_stamped', 'completed_uploaded'
      )
    ),
  CONSTRAINT spcc_plans_well_indices_in_range
    CHECK (
      assigned_well_indices <@ ARRAY[1,2,3,4,5,6]
    ),
  CONSTRAINT spcc_plans_unique_berm_per_facility
    UNIQUE (facility_id, berm_index)
);

COMMENT ON TABLE public.spcc_plans IS
  'One row per berm. A facility with a single berm has one row; facilities with multiple berms have one row per berm, each tracking its own SPCC plan PDF, PE stamp date, workflow status, and well-coverage set.';
COMMENT ON COLUMN public.spcc_plans.berm_index IS
  '1-based ordinal within the facility (Berm 1, Berm 2, ...). Max 6.';
COMMENT ON COLUMN public.spcc_plans.berm_label IS
  'Optional user-supplied label (e.g. "North Berm"). Display-only; berm_index is the stable identifier.';
COMMENT ON COLUMN public.spcc_plans.assigned_well_indices IS
  'Array of well ordinals (1..6) this plan covers. Corresponds to well_name_N / well_api_N on the facility. Empty = no wells assigned (UI alert).';

CREATE INDEX IF NOT EXISTS idx_spcc_plans_facility_id
  ON public.spcc_plans (facility_id);

CREATE INDEX IF NOT EXISTS idx_spcc_plans_facility_berm
  ON public.spcc_plans (facility_id, berm_index);

-- Keep updated_at fresh on every mutation.
CREATE OR REPLACE FUNCTION public.update_spcc_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS spcc_plans_updated_at ON public.spcc_plans;
CREATE TRIGGER spcc_plans_updated_at
  BEFORE UPDATE ON public.spcc_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_spcc_plans_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — mirror the facility access rules. A user can see/edit a plan row
--    if they can see/edit the parent facility (owner or via account_users).
-- ---------------------------------------------------------------------------

ALTER TABLE public.spcc_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can view spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND (
          f.user_id = auth.uid()
          OR f.account_id IN (
            SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users can insert spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can insert spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND (
          f.user_id = auth.uid()
          OR f.account_id IN (
            SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users can update spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can update spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND (
          f.user_id = auth.uid()
          OR f.account_id IN (
            SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND (
          f.user_id = auth.uid()
          OR f.account_id IN (
            SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users can delete spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can delete spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND (
          f.user_id = auth.uid()
          OR f.account_id IN (
            SELECT account_id FROM public.account_users WHERE user_id = auth.uid()
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Backfill
--    Every facility gets a berm_index=1 row. If the facility already has any
--    SPCC data (plan URL, PE date, or workflow status), we copy it over. The
--    default assigned_well_indices is "all wells present on the facility" so
--    legacy single-berm facilities maintain coverage semantics.
-- ---------------------------------------------------------------------------

INSERT INTO public.spcc_plans (
  facility_id,
  berm_index,
  plan_url,
  pe_stamp_date,
  workflow_status,
  workflow_status_overridden,
  assigned_well_indices
)
SELECT
  f.id,
  1,
  f.spcc_plan_url,
  f.spcc_pe_stamp_date,
  f.spcc_workflow_status,
  COALESCE(f.spcc_workflow_status_overridden, false),
  -- Array of well indices where a well actually exists on the facility
  ARRAY(
    SELECT n FROM (VALUES (1), (2), (3), (4), (5), (6)) AS idx(n)
    WHERE (
      CASE idx.n
        WHEN 1 THEN f.well_name_1
        WHEN 2 THEN f.well_name_2
        WHEN 3 THEN f.well_name_3
        WHEN 4 THEN f.well_name_4
        WHEN 5 THEN f.well_name_5
        WHEN 6 THEN f.well_name_6
      END
    ) IS NOT NULL
  )
FROM public.facilities f
WHERE NOT EXISTS (
  SELECT 1 FROM public.spcc_plans p
  WHERE p.facility_id = f.id AND p.berm_index = 1
);

-- ---------------------------------------------------------------------------
-- 4. Mirror trigger
--    Keeps facilities.spcc_plan_url / spcc_pe_stamp_date / spcc_workflow_status
--    / spcc_workflow_status_overridden in sync with the "worst-case" berm on
--    that facility so legacy readers (compliance calculator, route filters,
--    reports) don't need to change yet.
--
--    Worst-case rules:
--      - plan_url: prefer the berm with the EARLIEST pe_stamp_date (soonest
--        to expire); fall back to any row with a url; nulls last.
--      - pe_stamp_date: MIN across all berms (drives renewal urgency).
--      - workflow_status: the earliest stage among all berms, using the
--        natural ordering awaiting_pe_stamp < site_visited < pe_stamped
--        < completed_uploaded. This is "the overall facility is at most
--        as far along as its least-advanced berm".
--      - workflow_status_overridden: true if any berm is overridden.
-- ---------------------------------------------------------------------------

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

COMMENT ON FUNCTION public.sync_facility_from_spcc_plans() IS
  'Mirrors the worst-case berm (earliest PE date, least-advanced workflow status, any-override) onto facilities.spcc_* columns so legacy consumers keep working. Runs AFTER every mutation on spcc_plans.';
