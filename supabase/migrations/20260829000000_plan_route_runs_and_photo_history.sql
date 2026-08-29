/*
  # Plans-mode route runs and immutable photo history

  `facilities.photos_taken` and the per-berm `spcc_plans.photos_taken` values
  remain the current facility snapshot. They are not route progress and route
  actions must never clear them.

  This migration adds:
    - one durable execution record per actual SPCC Plan outing;
    - per-run stop progress that can be reset by starting a new run;
    - an immutable photo-event ledger that preserves every recorded occurrence;
    - account-scoped RPCs for starting/syncing runs and marking/reopening stops.

  Existing route_visit_events are copied as legacy events without inventing a
  route-run or berm association. Facilities whose current flag is true but have
  no event receive an explicitly inferred/date-only legacy record.
*/

CREATE TABLE IF NOT EXISTS public.plan_route_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  route_plan_id uuid REFERENCES public.route_plans(id) ON DELETE SET NULL,
  survey_type text NOT NULL DEFAULT 'spcc_plan',
  team_number integer NOT NULL DEFAULT 1 CHECK (team_number > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned')),
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at timestamptz,
  ended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_route_runs_one_active_per_plan
  ON public.plan_route_runs(route_plan_id, team_number)
  WHERE status = 'active' AND route_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_route_runs_account_started
  ON public.plan_route_runs(account_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.plan_route_run_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  route_run_id uuid NOT NULL REFERENCES public.plan_route_runs(id) ON DELETE RESTRICT,
  facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  facility_name_snapshot text NOT NULL,
  planned_day integer,
  planned_position integer,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'removed', 'skipped')),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_route_run_stops_unique_facility
  ON public.plan_route_run_stops(route_run_id, facility_id)
  WHERE facility_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_route_run_stops_run_status
  ON public.plan_route_run_stops(route_run_id, status);

CREATE TABLE IF NOT EXISTS public.photo_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  facility_name_snapshot text NOT NULL,
  spcc_plan_id uuid REFERENCES public.spcc_plans(id) ON DELETE SET NULL,
  berm_index integer,
  route_run_id uuid REFERENCES public.plan_route_runs(id) ON DELETE SET NULL,
  route_stop_id uuid REFERENCES public.plan_route_run_stops(id) ON DELETE SET NULL,
  event_type text NOT NULL DEFAULT 'photos_recorded'
    CHECK (event_type IN ('photos_recorded', 'route_reopened', 'timestamp_corrected', 'legacy')),
  occurred_at timestamptz,
  occurred_on date,
  occurred_time time,
  account_timezone text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'unknown',
  supersedes_event_id uuid REFERENCES public.photo_visit_events(id) ON DELETE SET NULL,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  legacy_route_visit_event_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_visit_events_idempotency
  ON public.photo_visit_events(idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_visit_events_legacy_event
  ON public.photo_visit_events(legacy_route_visit_event_id)
  WHERE legacy_route_visit_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_photo_visit_events_facility_occurred
  ON public.photo_visit_events(facility_id, occurred_at DESC, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_visit_events_run_occurred
  ON public.photo_visit_events(route_run_id, occurred_at, recorded_at);

ALTER TABLE public.plan_route_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_route_run_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_visit_events ENABLE ROW LEVEL SECURITY;

/* Supabase projects commonly grant broad table privileges through default
   privileges. RLS would still reject unmatched writes, but make the immutable
   contract explicit at both layers: clients may read history, never mutate it. */
REVOKE INSERT, UPDATE, DELETE ON TABLE public.photo_visit_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.photo_visit_events TO authenticated;

DROP POLICY IF EXISTS "Users can view plan route runs" ON public.plan_route_runs;
CREATE POLICY "Users can view plan route runs"
  ON public.plan_route_runs FOR SELECT TO authenticated
  USING (public.user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can view plan route run stops" ON public.plan_route_run_stops;
CREATE POLICY "Users can view plan route run stops"
  ON public.plan_route_run_stops FOR SELECT TO authenticated
  USING (public.user_has_account_access(account_id));

DROP POLICY IF EXISTS "Users can view photo visit events" ON public.photo_visit_events;
CREATE POLICY "Users can view photo visit events"
  ON public.photo_visit_events FOR SELECT TO authenticated
  USING (public.user_has_account_access(account_id));

/* No INSERT/UPDATE/DELETE policies are created for photo_visit_events. All
   writes go through the account-scoped SECURITY DEFINER functions below. */

CREATE OR REPLACE FUNCTION public._sync_plan_route_run_stops(
  target_run_id uuid,
  target_stops jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.plan_route_runs%ROWTYPE;
  v_stop jsonb;
  v_facility_id uuid;
  v_facility_name text;
BEGIN
  SELECT * INTO v_run
  FROM public.plan_route_runs
  WHERE id = target_run_id;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Route run not found';
  END IF;

  FOR v_stop IN
    SELECT value FROM jsonb_array_elements(COALESCE(target_stops, '[]'::jsonb))
  LOOP
    v_facility_id := NULLIF(v_stop->>'facility_id', '')::uuid;
    v_facility_name := NULLIF(v_stop->>'facility_name', '');

    IF v_facility_id IS NULL OR v_facility_name IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = v_facility_id AND f.account_id = v_run.account_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.plan_route_run_stops (
      account_id,
      route_run_id,
      facility_id,
      facility_name_snapshot,
      planned_day,
      planned_position,
      status,
      removed_at
    ) VALUES (
      v_run.account_id,
      v_run.id,
      v_facility_id,
      v_facility_name,
      NULLIF(v_stop->>'planned_day', '')::integer,
      NULLIF(v_stop->>'planned_position', '')::integer,
      'pending',
      NULL
    )
    ON CONFLICT (route_run_id, facility_id) WHERE facility_id IS NOT NULL
    DO UPDATE SET
      facility_name_snapshot = EXCLUDED.facility_name_snapshot,
      planned_day = EXCLUDED.planned_day,
      planned_position = EXCLUDED.planned_position,
      status = CASE
        WHEN plan_route_run_stops.status = 'completed' THEN 'completed'
        ELSE 'pending'
      END,
      removed_at = NULL,
      updated_at = now();
  END LOOP;

  UPDATE public.plan_route_run_stops existing
  SET
    status = CASE WHEN existing.status = 'completed' THEN 'completed' ELSE 'removed' END,
    removed_at = COALESCE(existing.removed_at, now()),
    updated_at = now()
  WHERE existing.route_run_id = v_run.id
    AND existing.facility_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(target_stops, '[]'::jsonb)) incoming
      WHERE NULLIF(incoming->>'facility_id', '')::uuid = existing.facility_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public._sync_plan_route_run_stops(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_plan_route_run(
  target_account_id uuid,
  target_route_plan_id uuid,
  target_team_number integer,
  target_stops jsonb,
  force_new boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_account_access(target_account_id) THEN
    RAISE EXCEPTION 'Not authorized for this account';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.route_plans rp
    WHERE rp.id = target_route_plan_id AND rp.account_id = target_account_id
  ) THEN
    RAISE EXCEPTION 'Route plan not found for this account';
  END IF;

  IF force_new THEN
    UPDATE public.plan_route_runs
    SET status = 'completed', ended_at = now(), ended_by = auth.uid()
    WHERE route_plan_id = target_route_plan_id
      AND team_number = COALESCE(target_team_number, 1)
      AND status = 'active';
  ELSE
    SELECT id INTO v_run_id
    FROM public.plan_route_runs
    WHERE route_plan_id = target_route_plan_id
      AND team_number = COALESCE(target_team_number, 1)
      AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1;
  END IF;

  IF v_run_id IS NULL THEN
    INSERT INTO public.plan_route_runs (
      account_id, route_plan_id, survey_type, team_number, status, started_by
    ) VALUES (
      target_account_id,
      target_route_plan_id,
      'spcc_plan',
      COALESCE(target_team_number, 1),
      'active',
      auth.uid()
    )
    RETURNING id INTO v_run_id;
  END IF;

  PERFORM public._sync_plan_route_run_stops(v_run_id, target_stops);
  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_plan_route_run(uuid, uuid, integer, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_plan_route_run(uuid, uuid, integer, jsonb, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_plan_route_run_stops(
  target_run_id uuid,
  target_stops jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT account_id INTO v_account_id
  FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active';

  IF v_account_id IS NULL OR auth.uid() IS NULL
     OR NOT public.user_has_account_access(v_account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this route run';
  END IF;

  PERFORM public._sync_plan_route_run_stops(target_run_id, target_stops);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_plan_route_run_stops(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_plan_route_run_stops(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_plan_route_stop_photos(
  target_run_id uuid,
  target_facility_id uuid,
  target_completed boolean,
  target_occurred_at timestamptz DEFAULT now(),
  target_source text DEFAULT 'route_planning',
  target_idempotency_key uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.plan_route_runs%ROWTYPE;
  v_stop public.plan_route_run_stops%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_timezone text;
  v_local timestamp;
  v_event_id uuid;
  v_supersedes uuid;
BEGIN
  SELECT * INTO v_run
  FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active';

  IF v_run.id IS NULL OR auth.uid() IS NULL
     OR NOT public.user_has_account_access(v_run.account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this route run';
  END IF;

  SELECT * INTO v_stop
  FROM public.plan_route_run_stops
  WHERE route_run_id = target_run_id
    AND facility_id = target_facility_id
    AND removed_at IS NULL;

  SELECT * INTO v_facility
  FROM public.facilities
  WHERE id = target_facility_id AND account_id = v_run.account_id;

  IF v_stop.id IS NULL OR v_facility.id IS NULL THEN
    RAISE EXCEPTION 'Facility is not an active stop on this route run';
  END IF;

  SELECT COALESCE(NULLIF(a.timezone, ''), 'America/Chicago')
  INTO v_timezone
  FROM public.accounts a
  WHERE a.id = v_run.account_id;

  v_timezone := COALESCE(v_timezone, 'America/Chicago');
  v_local := COALESCE(target_occurred_at, now()) AT TIME ZONE v_timezone;

  IF NOT target_completed THEN
    SELECT id INTO v_supersedes
    FROM public.photo_visit_events
    WHERE route_run_id = target_run_id
      AND facility_id = target_facility_id
      AND event_type = 'photos_recorded'
    ORDER BY occurred_at DESC NULLS LAST, recorded_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.photo_visit_events (
    account_id,
    facility_id,
    facility_name_snapshot,
    route_run_id,
    route_stop_id,
    event_type,
    occurred_at,
    occurred_on,
    occurred_time,
    account_timezone,
    recorded_by,
    source,
    supersedes_event_id,
    idempotency_key
  ) VALUES (
    v_run.account_id,
    v_facility.id,
    v_facility.name,
    v_run.id,
    v_stop.id,
    CASE WHEN target_completed THEN 'photos_recorded' ELSE 'route_reopened' END,
    COALESCE(target_occurred_at, now()),
    v_local::date,
    v_local::time,
    v_timezone,
    auth.uid(),
    COALESCE(NULLIF(target_source, ''), 'route_planning'),
    v_supersedes,
    COALESCE(target_idempotency_key, gen_random_uuid())
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.photo_visit_events
    WHERE idempotency_key = target_idempotency_key;
  END IF;

  IF target_completed THEN
    /* Marking the route-level action means all required berm photos for this
       stop were captured. Per-berm triggers mirror the aggregate back to the
       facility. Facilities with no plan rows use the direct fallback. */
    UPDATE public.spcc_plans
    SET photos_taken = true,
        field_visit_date = v_local::date
    WHERE facility_id = v_facility.id;

    UPDATE public.facilities
    SET photos_taken = true,
        field_visit_date = v_local::date,
        field_visit_time = v_local::time
    WHERE id = v_facility.id;

    UPDATE public.plan_route_run_stops
    SET status = 'completed',
        completed_at = COALESCE(target_occurred_at, now()),
        completed_by = auth.uid(),
        updated_at = now()
    WHERE id = v_stop.id;
  ELSE
    /* Reopening is route-only. It deliberately leaves facility and berm
       photo status, latest visit fields, and all historical events intact. */
    UPDATE public.plan_route_run_stops
    SET status = 'pending',
        completed_at = NULL,
        completed_by = NULL,
        updated_at = now()
    WHERE id = v_stop.id;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'stop_id', v_stop.id,
    'event_id', v_event_id,
    'facility_id', v_facility.id,
    'status', CASE WHEN target_completed THEN 'completed' ELSE 'pending' END,
    'completed_at', CASE WHEN target_completed THEN COALESCE(target_occurred_at, now()) ELSE NULL END,
    'field_visit_date', CASE WHEN target_completed THEN v_local::date ELSE v_facility.field_visit_date END,
    'field_visit_time', CASE WHEN target_completed THEN v_local::time ELSE v_facility.field_visit_time END,
    'photos_taken', CASE WHEN target_completed THEN true ELSE v_facility.photos_taken END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_plan_route_stop_photos(uuid, uuid, boolean, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_plan_route_stop_photos(uuid, uuid, boolean, timestamptz, text, uuid) TO authenticated;

/* Safety-net history capture for existing write surfaces. These triggers do
   not drive route progress. They only ensure a false-to-true facility or berm
   transition is retained in the immutable ledger. */
CREATE OR REPLACE FUNCTION public.capture_facility_photo_visit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone text;
  v_occurred_at timestamptz;
  v_event_type text;
  v_supersedes uuid;
BEGIN
  IF NEW.photos_taken IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_event_type := 'photos_recorded';
  ELSIF OLD.photos_taken IS DISTINCT FROM TRUE THEN
    v_event_type := 'photos_recorded';
  ELSIF OLD.field_visit_date IS DISTINCT FROM NEW.field_visit_date
     OR OLD.field_visit_time IS DISTINCT FROM NEW.field_visit_time
  THEN
    v_event_type := 'timestamp_corrected';
  ELSE
    RETURN NEW;
  END IF;

  /* A route RPC or per-berm trigger may already have written the fully
     attributed event in this transaction. Do not duplicate one visit across
     multiple mirrored status surfaces. */
  IF EXISTS (
    SELECT 1 FROM public.photo_visit_events e
    WHERE e.facility_id = NEW.id
      AND e.recorded_at = transaction_timestamp()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(a.timezone, ''), 'America/Chicago')
  INTO v_timezone
  FROM public.accounts a
  WHERE a.id = NEW.account_id;

  IF NEW.field_visit_date IS NOT NULL AND NEW.field_visit_time IS NOT NULL THEN
    v_occurred_at := (NEW.field_visit_date + NEW.field_visit_time) AT TIME ZONE COALESCE(v_timezone, 'America/Chicago');
  END IF;

  IF v_event_type = 'timestamp_corrected' THEN
    SELECT id INTO v_supersedes
    FROM public.photo_visit_events
    WHERE facility_id = NEW.id
      AND event_type IN ('photos_recorded', 'timestamp_corrected', 'legacy')
    ORDER BY occurred_at DESC NULLS LAST, recorded_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.photo_visit_events (
    account_id, facility_id, facility_name_snapshot, event_type,
    occurred_at, occurred_on, occurred_time, account_timezone,
    recorded_by, source, supersedes_event_id, metadata
  ) VALUES (
    NEW.account_id, NEW.id, NEW.name, v_event_type,
    v_occurred_at, NEW.field_visit_date, NEW.field_visit_time,
    COALESCE(v_timezone, 'America/Chicago'), auth.uid(),
    CASE
      WHEN v_event_type = 'timestamp_corrected' THEN 'facility_timestamp_correction'
      WHEN TG_OP = 'INSERT' THEN 'facility_insert'
      ELSE 'facility_status'
    END,
    v_supersedes,
    jsonb_build_object('precision', CASE WHEN NEW.field_visit_time IS NULL THEN 'date' ELSE 'instant' END)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facilities_capture_photo_visit_event ON public.facilities;
CREATE TRIGGER facilities_capture_photo_visit_event
  AFTER INSERT OR UPDATE ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_facility_photo_visit_event();

CREATE OR REPLACE FUNCTION public.capture_spcc_plan_photo_visit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_timezone text;
  v_event_type text;
  v_supersedes uuid;
BEGIN
  IF NEW.photos_taken IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_event_type := 'photos_recorded';
  ELSIF OLD.photos_taken IS DISTINCT FROM TRUE THEN
    v_event_type := 'photos_recorded';
  ELSIF OLD.field_visit_date IS DISTINCT FROM NEW.field_visit_date THEN
    v_event_type := 'timestamp_corrected';
  ELSE
    RETURN NEW;
  END IF;

    SELECT * INTO v_facility
    FROM public.facilities
    WHERE id = NEW.facility_id;

    IF v_facility.id IS NULL THEN
      RETURN NEW;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.photo_visit_events e
      WHERE e.facility_id = v_facility.id
        AND e.recorded_at = transaction_timestamp()
    ) THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(NULLIF(a.timezone, ''), 'America/Chicago')
    INTO v_timezone
    FROM public.accounts a
    WHERE a.id = v_facility.account_id;

    IF v_event_type = 'timestamp_corrected' THEN
      SELECT id INTO v_supersedes
      FROM public.photo_visit_events
      WHERE facility_id = v_facility.id
        AND (spcc_plan_id = NEW.id OR spcc_plan_id IS NULL)
        AND event_type IN ('photos_recorded', 'timestamp_corrected', 'legacy')
      ORDER BY occurred_at DESC NULLS LAST, recorded_at DESC
      LIMIT 1;
    END IF;

    INSERT INTO public.photo_visit_events (
      account_id, facility_id, facility_name_snapshot, spcc_plan_id,
      berm_index, event_type, occurred_on, account_timezone,
      recorded_by, source, supersedes_event_id, metadata
    ) VALUES (
      v_facility.account_id, v_facility.id, v_facility.name, NEW.id,
      NEW.berm_index, v_event_type, NEW.field_visit_date,
      COALESCE(v_timezone, 'America/Chicago'), auth.uid(),
      CASE WHEN v_event_type = 'timestamp_corrected' THEN 'spcc_plan_timestamp_correction' ELSE 'spcc_plan_status' END,
      v_supersedes,
      jsonb_build_object('precision', 'date')
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spcc_plans_capture_photo_visit_event ON public.spcc_plans;
CREATE TRIGGER spcc_plans_capture_photo_visit_event
  AFTER INSERT OR UPDATE ON public.spcc_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_spcc_plan_photo_visit_event();

/* Preserve the existing visit log as immutable legacy history. */
INSERT INTO public.photo_visit_events (
  account_id,
  facility_id,
  facility_name_snapshot,
  event_type,
  occurred_at,
  occurred_on,
  occurred_time,
  account_timezone,
  recorded_at,
  recorded_by,
  source,
  legacy_route_visit_event_id,
  metadata
)
SELECT
  e.account_id,
  e.facility_id,
  f.name,
  'legacy',
  e.visited_at,
  (e.visited_at AT TIME ZONE COALESCE(NULLIF(a.timezone, ''), 'America/Chicago'))::date,
  (e.visited_at AT TIME ZONE COALESCE(NULLIF(a.timezone, ''), 'America/Chicago'))::time,
  COALESCE(NULLIF(a.timezone, ''), 'America/Chicago'),
  e.visited_at,
  e.recorded_by,
  'legacy_route_visit_events',
  e.id,
  jsonb_build_object('legacy', true, 'route_attribution', 'unknown')
FROM public.route_visit_events e
JOIN public.facilities f ON f.id = e.facility_id
JOIN public.accounts a ON a.id = e.account_id
ON CONFLICT (legacy_route_visit_event_id) WHERE legacy_route_visit_event_id IS NOT NULL
DO NOTHING;

/* Best-effort current-state backfill. It does not invent a time or route. */
INSERT INTO public.photo_visit_events (
  account_id,
  facility_id,
  facility_name_snapshot,
  event_type,
  occurred_on,
  occurred_time,
  account_timezone,
  recorded_at,
  recorded_by,
  source,
  metadata
)
SELECT
  f.account_id,
  f.id,
  f.name,
  'legacy',
  f.field_visit_date,
  f.field_visit_time,
  COALESCE(NULLIF(a.timezone, ''), 'America/Chicago'),
  now(),
  NULL,
  'legacy_facility_state',
  jsonb_build_object(
    'legacy', true,
    'inferred', true,
    'precision', CASE WHEN f.field_visit_time IS NULL THEN 'date' ELSE 'local_date_time' END,
    'route_attribution', 'unknown'
  )
FROM public.facilities f
JOIN public.accounts a ON a.id = f.account_id
WHERE f.photos_taken IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.photo_visit_events e
    WHERE e.facility_id = f.id
  );

COMMENT ON TABLE public.photo_visit_events IS
  'Immutable ledger of photo/visit occurrences. Corrections and route reopens append events; they never rewrite or delete prior occurrences.';

COMMENT ON TABLE public.plan_route_runs IS
  'One actual SPCC Plan outing. Starting a new run resets route-only progress without changing facility photo status or history.';
