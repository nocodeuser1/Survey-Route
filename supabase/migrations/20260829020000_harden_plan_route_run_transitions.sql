/*
  # Harden SPCC outing transitions

  - Replacing an unfinished active outing records it as abandoned rather than
    completed.
  - Repeated requests that already match the stop state are no-ops.
  - The stop row is locked so concurrent taps cannot append duplicate photo
    occurrences.
  - Reusing an idempotency key returns the already-applied result and never
    replays a stale request over a newer stop state.
*/

CREATE TABLE IF NOT EXISTS public.plan_route_stop_action_requests (
  idempotency_key uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  route_run_id uuid NOT NULL REFERENCES public.plan_route_runs(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  requested_completed boolean NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_route_stop_action_requests_run_created
  ON public.plan_route_stop_action_requests(route_run_id, created_at DESC);

ALTER TABLE public.plan_route_stop_action_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.plan_route_stop_action_requests FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.plan_route_stop_action_requests IS
  'Private idempotency journal for SPCC outing stop changes, including requests that were already in the requested state.';

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

  /* Serialize starts for one saved route so two first-stop taps cannot race
     through the partial unique index and leave one action stranded. */
  PERFORM 1
  FROM public.route_plans rp
  WHERE rp.id = target_route_plan_id
    AND rp.account_id = target_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route plan not found for this account';
  END IF;

  IF force_new THEN
    UPDATE public.plan_route_runs current_run
    SET status = CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.plan_route_run_stops stop
            WHERE stop.route_run_id = current_run.id
              AND stop.removed_at IS NULL
              AND stop.status <> 'completed'
          ) THEN 'abandoned'
          ELSE 'completed'
        END,
        ended_at = now(),
        ended_by = auth.uid()
    WHERE current_run.route_plan_id = target_route_plan_id
      AND current_run.account_id = target_account_id
      AND current_run.team_number = COALESCE(target_team_number, 1)
      AND current_run.status = 'active';
  ELSE
    SELECT id INTO v_run_id
    FROM public.plan_route_runs
    WHERE route_plan_id = target_route_plan_id
      AND account_id = target_account_id
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
  v_existing_event public.photo_visit_events%ROWTYPE;
  v_timezone text;
  v_local timestamp;
  v_event_id uuid;
  v_supersedes uuid;
  v_request_key uuid := COALESCE(target_idempotency_key, gen_random_uuid());
  v_request_created boolean;
  v_existing_request public.plan_route_stop_action_requests%ROWTYPE;
  v_response jsonb;
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
    AND removed_at IS NULL
  FOR UPDATE;

  SELECT * INTO v_facility
  FROM public.facilities
  WHERE id = target_facility_id AND account_id = v_run.account_id;

  IF v_stop.id IS NULL OR v_facility.id IS NULL THEN
    RAISE EXCEPTION 'Facility is not an active stop on this route run';
  END IF;

  /* Reserve every logical request, including a request that is already in the
     desired state. That closes the stale-retry gap left by event-only
     idempotency because a no-op correctly creates no photo event. */
  INSERT INTO public.plan_route_stop_action_requests (
    idempotency_key,
    account_id,
    route_run_id,
    facility_id,
    requested_completed
  ) VALUES (
    v_request_key,
    v_run.account_id,
    v_run.id,
    v_facility.id,
    target_completed
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING true INTO v_request_created;

  IF NOT COALESCE(v_request_created, false) THEN
    SELECT * INTO v_existing_request
    FROM public.plan_route_stop_action_requests
    WHERE idempotency_key = v_request_key;

    IF v_existing_request.idempotency_key IS NULL
       OR v_existing_request.route_run_id IS DISTINCT FROM target_run_id
       OR v_existing_request.facility_id IS DISTINCT FROM target_facility_id
       OR v_existing_request.requested_completed IS DISTINCT FROM target_completed
    THEN
      RAISE EXCEPTION 'Idempotency key is already used by another route action';
    END IF;

    IF v_existing_request.response IS NULL THEN
      RAISE EXCEPTION 'Matching route action is still processing';
    END IF;

    RETURN v_existing_request.response || jsonb_build_object('idempotent_replay', true);
  END IF;

  /* Backfill-safe check for requests completed before the private request
     journal existed. */
  IF v_request_key IS NOT NULL THEN
    SELECT * INTO v_existing_event
    FROM public.photo_visit_events
    WHERE idempotency_key = v_request_key;

    IF v_existing_event.id IS NOT NULL THEN
      IF v_existing_event.route_run_id IS DISTINCT FROM target_run_id
         OR v_existing_event.facility_id IS DISTINCT FROM target_facility_id
         OR (target_completed AND v_existing_event.event_type <> 'photos_recorded')
         OR (NOT target_completed AND v_existing_event.event_type <> 'route_reopened')
      THEN
        RAISE EXCEPTION 'Idempotency key is already used by another photo event';
      END IF;

      v_response := jsonb_build_object(
        'run_id', v_run.id,
        'stop_id', v_stop.id,
        'event_id', v_existing_event.id,
        'facility_id', v_facility.id,
        'status', v_stop.status,
        'completed_at', v_stop.completed_at,
        'field_visit_date', v_facility.field_visit_date,
        'field_visit_time', v_facility.field_visit_time,
        'photos_taken', v_facility.photos_taken,
        'idempotent_replay', true
      );
      UPDATE public.plan_route_stop_action_requests
      SET response = v_response
      WHERE idempotency_key = v_request_key;
      RETURN v_response;
    END IF;
  END IF;

  /* A second tap or a concurrent request that already reached the requested
     state is not another physical visit and must not append another event. */
  IF (target_completed AND v_stop.status = 'completed')
     OR (NOT target_completed AND v_stop.status = 'pending')
  THEN
    v_response := jsonb_build_object(
      'run_id', v_run.id,
      'stop_id', v_stop.id,
      'event_id', NULL::uuid,
      'facility_id', v_facility.id,
      'status', v_stop.status,
      'completed_at', v_stop.completed_at,
      'field_visit_date', v_facility.field_visit_date,
      'field_visit_time', v_facility.field_visit_time,
      'photos_taken', v_facility.photos_taken,
      'state_unchanged', true
    );
    UPDATE public.plan_route_stop_action_requests
    SET response = v_response
    WHERE idempotency_key = v_request_key;
    RETURN v_response;
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
    v_request_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT * INTO v_existing_event
    FROM public.photo_visit_events
    WHERE idempotency_key = v_request_key;

    IF v_existing_event.id IS NULL
       OR v_existing_event.route_run_id IS DISTINCT FROM target_run_id
       OR v_existing_event.facility_id IS DISTINCT FROM target_facility_id
       OR (target_completed AND v_existing_event.event_type <> 'photos_recorded')
       OR (NOT target_completed AND v_existing_event.event_type <> 'route_reopened')
    THEN
      RAISE EXCEPTION 'Idempotency key is already used by another photo event';
    END IF;
    v_event_id := v_existing_event.id;
  END IF;

  IF target_completed THEN
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
    UPDATE public.plan_route_run_stops
    SET status = 'pending',
        completed_at = NULL,
        completed_by = NULL,
        updated_at = now()
    WHERE id = v_stop.id;
  END IF;

  v_response := jsonb_build_object(
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
  UPDATE public.plan_route_stop_action_requests
  SET response = v_response
  WHERE idempotency_key = v_request_key;
  RETURN v_response;
END;
$$;
