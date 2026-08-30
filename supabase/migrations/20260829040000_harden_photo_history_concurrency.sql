/*
  # Serialize outing and photo-history corrections

  - A stop transition locks its active outing before reading the stop so a
    simultaneous "new outing" reset cannot accept work into an ended run.
  - Admin edits and tombstones lock the immutable base event, making concurrent
    corrections one ordered append-only chain.
  - Timestamp corrections are normalized to the newest unsuperseded leaf so
    repeated corrections do not create multiple effective records.
*/

CREATE INDEX IF NOT EXISTS idx_photo_visit_events_supersedes
  ON public.photo_visit_events(supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;

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
  /* Resetting an outing updates this same row. Lock it before the stop so the
     two actions have one unambiguous order and re-check active status after
     any wait. */
  SELECT * INTO v_run
  FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active'
  FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.set_plan_route_stop_photos(uuid, uuid, boolean, timestamptz, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_plan_route_stop_photos(uuid, uuid, boolean, timestamptz, text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_edit_photo_visit_event(
  target_event_id uuid,
  target_occurred_on date,
  target_occurred_time time DEFAULT NULL,
  target_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.photo_visit_events%ROWTYPE;
  v_latest public.photo_visit_event_revisions%ROWTYPE;
  v_timezone text;
  v_occurred_at timestamptz;
  v_previous_on date;
  v_previous_time time;
  v_previous_at timestamptz;
  v_revision_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  /* The immutable base row is the per-record mutex. */
  SELECT * INTO v_event
  FROM public.photo_visit_events
  WHERE id = target_event_id
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.event_type = 'route_reopened' THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  IF NOT public._can_manage_account_invitations(v_event.account_id) THEN
    RAISE EXCEPTION 'Account administrator access is required';
  END IF;

  IF target_occurred_on IS NULL THEN
    RAISE EXCEPTION 'Photo date is required';
  END IF;

  SELECT * INTO v_latest
  FROM public.photo_visit_event_revisions
  WHERE event_id = target_event_id
  ORDER BY changed_at DESC, id DESC
  LIMIT 1;

  IF v_latest.id IS NOT NULL AND v_latest.action = 'edit' THEN
    v_previous_on := v_latest.occurred_on;
    v_previous_time := v_latest.occurred_time;
    v_previous_at := v_latest.occurred_at;
  ELSIF v_latest.id IS NOT NULL AND v_latest.action = 'delete' THEN
    v_previous_on := NULLIF(v_latest.previous_values->>'occurred_on', '')::date;
    v_previous_time := NULLIF(v_latest.previous_values->>'occurred_time', '')::time;
    v_previous_at := NULLIF(v_latest.previous_values->>'occurred_at', '')::timestamptz;
  ELSE
    v_previous_on := v_event.occurred_on;
    v_previous_time := v_event.occurred_time;
    v_previous_at := v_event.occurred_at;
  END IF;

  SELECT COALESCE(NULLIF(timezone, ''), v_event.account_timezone, 'America/Chicago')
  INTO v_timezone
  FROM public.accounts
  WHERE id = v_event.account_id;

  IF target_occurred_time IS NOT NULL THEN
    v_occurred_at :=
      (target_occurred_on::timestamp + target_occurred_time) AT TIME ZONE v_timezone;
  END IF;

  INSERT INTO public.photo_visit_event_revisions (
    account_id,
    event_id,
    action,
    occurred_at,
    occurred_on,
    occurred_time,
    reason,
    previous_values,
    changed_by
  ) VALUES (
    v_event.account_id,
    target_event_id,
    'edit',
    v_occurred_at,
    target_occurred_on,
    target_occurred_time,
    NULLIF(BTRIM(target_reason), ''),
    jsonb_build_object(
      'occurred_at', v_previous_at,
      'occurred_on', v_previous_on,
      'occurred_time', v_previous_time,
      'was_deleted', v_latest.id IS NOT NULL AND v_latest.action = 'delete'
    ),
    auth.uid()
  )
  RETURNING id INTO v_revision_id;

  RETURN v_revision_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_edit_photo_visit_event(uuid, date, time, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_photo_visit_event(uuid, date, time, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_photo_visit_event(
  target_event_id uuid,
  target_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.photo_visit_events%ROWTYPE;
  v_latest public.photo_visit_event_revisions%ROWTYPE;
  v_previous_on date;
  v_previous_time time;
  v_previous_at timestamptz;
  v_revision_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  /* Serialize this append with edits and other tombstones. */
  SELECT * INTO v_event
  FROM public.photo_visit_events
  WHERE id = target_event_id
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.event_type = 'route_reopened' THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  IF NOT public._can_manage_account_invitations(v_event.account_id) THEN
    RAISE EXCEPTION 'Account administrator access is required';
  END IF;

  SELECT * INTO v_latest
  FROM public.photo_visit_event_revisions
  WHERE event_id = target_event_id
  ORDER BY changed_at DESC, id DESC
  LIMIT 1;

  IF v_latest.id IS NOT NULL AND v_latest.action = 'delete' THEN
    RAISE EXCEPTION 'Photo history record is already deleted';
  END IF;

  IF v_latest.id IS NOT NULL AND v_latest.action = 'edit' THEN
    v_previous_on := v_latest.occurred_on;
    v_previous_time := v_latest.occurred_time;
    v_previous_at := v_latest.occurred_at;
  ELSE
    v_previous_on := v_event.occurred_on;
    v_previous_time := v_event.occurred_time;
    v_previous_at := v_event.occurred_at;
  END IF;

  INSERT INTO public.photo_visit_event_revisions (
    account_id,
    event_id,
    action,
    reason,
    previous_values,
    changed_by
  ) VALUES (
    v_event.account_id,
    target_event_id,
    'delete',
    COALESCE(NULLIF(BTRIM(target_reason), ''), 'Removed from photo history by an administrator'),
    jsonb_build_object(
      'occurred_at', v_previous_at,
      'occurred_on', v_previous_on,
      'occurred_time', v_previous_time
    ),
    auth.uid()
  )
  RETURNING id INTO v_revision_id;

  RETURN v_revision_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_photo_visit_event(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_photo_visit_event(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_photo_timestamp_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_leaf uuid;
BEGIN
  IF NEW.event_type <> 'timestamp_corrected' OR NEW.facility_id IS NULL THEN
    RETURN NEW;
  END IF;

  /* The producer-selected event identifies the physical visit being corrected.
     Follow that lineage first, even when the correction was emitted by an SPCC
     plan row and its current visit came from a facility-level route event. If
     older data already branched, choose the newest leaf in this lineage rather
     than hopping to another occurrence at the same facility. */
  IF NEW.supersedes_event_id IS NOT NULL THEN
    WITH RECURSIVE lineage AS (
      SELECT event.id, event.recorded_at
      FROM public.photo_visit_events event
      WHERE event.id = NEW.supersedes_event_id
        AND event.account_id = NEW.account_id
        AND event.facility_id = NEW.facility_id

      UNION ALL

      SELECT child.id, child.recorded_at
      FROM public.photo_visit_events child
      JOIN lineage parent ON child.supersedes_event_id = parent.id
      WHERE child.account_id = NEW.account_id
        AND child.facility_id = NEW.facility_id
        AND child.event_type <> 'route_reopened'
    )
    SELECT candidate.id INTO v_current_leaf
    FROM lineage candidate
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.photo_visit_events child
      WHERE child.supersedes_event_id = candidate.id
        AND child.account_id = NEW.account_id
        AND child.facility_id = NEW.facility_id
        AND child.event_type <> 'route_reopened'
    )
    ORDER BY candidate.recorded_at DESC, candidate.id DESC
    LIMIT 1;
  END IF;

  /* Only producers without a valid lineage need a same-plan fallback. This
     repairs older per-plan chains without overriding an intentional aggregate
     route occurrence selected by the existing capture trigger. */
  IF v_current_leaf IS NULL AND NEW.spcc_plan_id IS NOT NULL THEN
    SELECT candidate.id INTO v_current_leaf
    FROM public.photo_visit_events candidate
    WHERE candidate.account_id = NEW.account_id
      AND candidate.facility_id = NEW.facility_id
      AND candidate.spcc_plan_id = NEW.spcc_plan_id
      AND candidate.event_type <> 'route_reopened'
      AND NOT EXISTS (
        SELECT 1
        FROM public.photo_visit_events child
        WHERE child.supersedes_event_id = candidate.id
          AND child.account_id = NEW.account_id
          AND child.facility_id = NEW.facility_id
          AND child.event_type <> 'route_reopened'
      )
    ORDER BY candidate.recorded_at DESC, candidate.id DESC
    LIMIT 1;
  END IF;

  IF v_current_leaf IS NOT NULL THEN
    NEW.supersedes_event_id := v_current_leaf;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_photo_timestamp_correction()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS photo_visit_events_normalize_timestamp_correction
  ON public.photo_visit_events;
CREATE TRIGGER photo_visit_events_normalize_timestamp_correction
  BEFORE INSERT ON public.photo_visit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_photo_timestamp_correction();
