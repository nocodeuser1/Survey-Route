/*
  # Harden immutable photo-history date integrity

  Forward-only repair for the append-only photo ledger introduced by the
  20260829000000 / 20260829010000 migrations.

  This migration:
    - fixes optional admin times by combining date + time with valid PostgreSQL
      types;
    - serializes all history-chain writers per account/facility;
    - redirects stale admin edits/tombstones to the current leaf of the same
      physical occurrence;
    - maps timestamp corrections to the newest scoped automatic history head,
      then advances only within that physical occurrence's lineage;
    - retains a facility visit time on a per-berm event only when its facility
      date proves that the time belongs to that same dated occurrence;
    - stamps false -> true facility transitions consistently when the older
      facility trigger supplies a missing date/time later in the transaction;
    - appends safe, idempotent legacy rows for pre-ledger partial-berm state.

  photo_visit_events and photo_visit_event_revisions remain immutable. This
  migration never updates or deletes either ledger table.
*/

/* One transaction-scoped mutex for structural corrections and admin mutations
   that can extend or revise a facility's history. A 64-bit hash keeps unrelated
   facilities independent. */
CREATE OR REPLACE FUNCTION public._lock_photo_history_facility(
  target_account_id uuid,
  target_facility_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF target_account_id IS NULL OR target_facility_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'photo-history:' || target_account_id::text || ':' || target_facility_id::text,
      0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public._lock_photo_history_facility(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

/* Resolve one physical occurrence's structural correction chain. Reopen rows
   are outing audit facts, so they never replace the photo occurrence. */
CREATE OR REPLACE FUNCTION public._photo_history_effective_leaf(
  target_event_id uuid
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE ancestry AS (
    SELECT
      event.id,
      event.account_id,
      event.facility_id,
      event.supersedes_event_id,
      ARRAY[event.id]::uuid[] AS path,
      0 AS depth
    FROM public.photo_visit_events event
    WHERE event.id = target_event_id
      AND event.event_type <> 'route_reopened'

    UNION ALL

    SELECT
      parent.id,
      parent.account_id,
      parent.facility_id,
      parent.supersedes_event_id,
      child.path || parent.id,
      child.depth + 1
    FROM public.photo_visit_events parent
    JOIN ancestry child ON parent.id = child.supersedes_event_id
    WHERE parent.account_id = child.account_id
      AND parent.facility_id IS NOT DISTINCT FROM child.facility_id
      AND parent.event_type <> 'route_reopened'
      AND NOT parent.id = ANY(child.path)
  ),
  root AS (
    SELECT id, account_id, facility_id
    FROM ancestry
    ORDER BY depth DESC, id DESC
    LIMIT 1
  ),
  descendants AS (
    SELECT
      event.id,
      event.account_id,
      event.facility_id,
      event.recorded_at,
      ARRAY[event.id]::uuid[] AS path
    FROM public.photo_visit_events event
    JOIN root ON root.id = event.id

    UNION ALL

    SELECT
      child.id,
      child.account_id,
      child.facility_id,
      child.recorded_at,
      parent.path || child.id
    FROM public.photo_visit_events child
    JOIN descendants parent ON child.supersedes_event_id = parent.id
    WHERE child.account_id = parent.account_id
      AND child.facility_id IS NOT DISTINCT FROM parent.facility_id
      AND child.event_type <> 'route_reopened'
      AND NOT child.id = ANY(parent.path)
  )
  SELECT candidate.id
  FROM descendants candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.photo_visit_events child
    WHERE child.supersedes_event_id = candidate.id
      AND child.account_id = candidate.account_id
      AND child.facility_id IS NOT DISTINCT FROM candidate.facility_id
      AND child.event_type <> 'route_reopened'
  )
  ORDER BY candidate.recorded_at DESC, candidate.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._photo_history_effective_leaf(uuid)
  FROM PUBLIC, anon, authenticated;

/* Locate the automatic history head represented by an OLD facility/plan
   snapshot. For a plan, an outing/legacy aggregate is a recognized shared
   parent and may already have plan-specific correction descendants. The
   normalizer advances that explicit aggregate lineage to its current leaf.
   Cross-surface matching is limited to known automatic producers; admin-manual
   occurrences never qualify. Both immutable base and revision-effective values
   are eligible because admin history edits do not mutate source snapshots. */
CREATE OR REPLACE FUNCTION public._find_photo_snapshot_history_leaf(
  target_account_id uuid,
  target_facility_id uuid,
  target_spcc_plan_id uuid,
  target_occurred_on date,
  target_occurred_time time
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT
      event.id,
      event.spcc_plan_id,
      event.recorded_at,
      event.occurred_on AS base_on,
      event.occurred_time AS base_time,
      revision.action AS revision_action,
      CASE
        WHEN revision.action = 'edit' THEN revision.occurred_on
        WHEN revision.action = 'delete'
          THEN NULLIF(revision.previous_values->>'occurred_on', '')::date
        ELSE event.occurred_on
      END AS effective_on,
      CASE
        WHEN revision.action = 'edit' THEN revision.occurred_time
        WHEN revision.action = 'delete'
          THEN NULLIF(revision.previous_values->>'occurred_time', '')::time
        ELSE event.occurred_time
      END AS effective_time
    FROM public.photo_visit_events event
    LEFT JOIN LATERAL (
      SELECT
        latest.action,
        latest.occurred_on,
        latest.occurred_time,
        latest.previous_values
      FROM public.photo_visit_event_revisions latest
      WHERE latest.event_id = event.id
      ORDER BY latest.changed_at DESC, latest.id DESC
      LIMIT 1
    ) revision ON true
    WHERE event.account_id = target_account_id
      AND event.facility_id = target_facility_id
      AND event.event_type <> 'route_reopened'
      AND event.source <> 'admin_manual'
      AND (
        event.route_run_id IS NOT NULL
        OR event.source IN (
          'legacy_route_visit_events',
          'legacy_facility_state',
          'legacy_spcc_plan_state',
          'facility_insert',
          'facility_status',
          'facility_timestamp_correction',
          'spcc_plan_status',
          'spcc_plan_timestamp_correction'
        )
      )
      AND (
        target_spcc_plan_id IS NULL
        OR event.spcc_plan_id = target_spcc_plan_id
        OR event.spcc_plan_id IS NULL
      )
  )
  , matching AS (
    SELECT
      candidate.id,
      candidate.recorded_at,
      CASE
        WHEN target_spcc_plan_id IS NOT NULL
          OR (
            candidate.effective_on IS NOT DISTINCT FROM target_occurred_on
            AND candidate.effective_time IS NOT DISTINCT FROM target_occurred_time
          )
          OR (
            candidate.base_on IS NOT DISTINCT FROM target_occurred_on
            AND candidate.base_time IS NOT DISTINCT FROM target_occurred_time
          )
          THEN 0
        ELSE 1
      END AS time_priority
    FROM candidates candidate
    WHERE (
      target_spcc_plan_id IS NOT NULL
      AND (
        candidate.effective_on IS NOT DISTINCT FROM target_occurred_on
        OR candidate.base_on IS NOT DISTINCT FROM target_occurred_on
      )
    ) OR (
      target_spcc_plan_id IS NULL
      AND (
        (
          candidate.effective_on IS NOT DISTINCT FROM target_occurred_on
          AND (
            candidate.effective_time IS NOT DISTINCT FROM target_occurred_time
            OR candidate.effective_time IS NULL
          )
        )
        OR (
          candidate.base_on IS NOT DISTINCT FROM target_occurred_on
          AND (
            candidate.base_time IS NOT DISTINCT FROM target_occurred_time
            OR candidate.base_time IS NULL
          )
        )
      )
    )
  )
  SELECT match.id
  FROM matching match
  ORDER BY match.time_priority, match.recorded_at DESC, match.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._find_photo_snapshot_history_leaf(uuid, uuid, uuid, date, time)
  FROM PUBLIC, anon, authenticated;

/* Admin adds are independent physical occurrences. They are serialized with
   automatic corrections but never modify the facility's current status. */
CREATE OR REPLACE FUNCTION public.admin_add_photo_visit_event(
  target_account_id uuid,
  target_facility_id uuid,
  target_occurred_on date,
  target_occurred_time time DEFAULT NULL,
  target_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_timezone text;
  v_occurred_at timestamptz;
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT public._can_manage_account_invitations(target_account_id) THEN
    RAISE EXCEPTION 'Account administrator access is required';
  END IF;

  IF target_occurred_on IS NULL THEN
    RAISE EXCEPTION 'Photo date is required';
  END IF;

  SELECT * INTO v_facility
  FROM public.facilities
  WHERE id = target_facility_id
    AND account_id = target_account_id;

  IF v_facility.id IS NULL THEN
    RAISE EXCEPTION 'Facility not found in this account';
  END IF;

  PERFORM public._lock_photo_history_facility(target_account_id, target_facility_id);

  SELECT COALESCE(NULLIF(timezone, ''), 'America/Chicago')
  INTO v_timezone
  FROM public.accounts
  WHERE id = target_account_id;
  v_timezone := COALESCE(v_timezone, 'America/Chicago');

  IF target_occurred_time IS NOT NULL THEN
    v_occurred_at :=
      (target_occurred_on + target_occurred_time) AT TIME ZONE v_timezone;
  END IF;

  INSERT INTO public.photo_visit_events (
    account_id,
    facility_id,
    facility_name_snapshot,
    event_type,
    occurred_at,
    occurred_on,
    occurred_time,
    account_timezone,
    recorded_by,
    source,
    metadata
  ) VALUES (
    target_account_id,
    target_facility_id,
    v_facility.name,
    'photos_recorded',
    v_occurred_at,
    target_occurred_on,
    target_occurred_time,
    v_timezone,
    auth.uid(),
    'admin_manual',
    jsonb_strip_nulls(jsonb_build_object(
      'admin_action', 'added',
      'note', NULLIF(BTRIM(target_note), '')
    ))
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_photo_visit_event(uuid, uuid, date, time, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_photo_visit_event(uuid, uuid, date, time, text)
  TO authenticated;

/* A stale UI may submit an ancestor after a normal snapshot correction already
   appended a child. Resolve that same occurrence to its current leaf while
   holding the facility mutex, then append the revision there. */
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
  v_target public.photo_visit_events%ROWTYPE;
  v_event public.photo_visit_events%ROWTYPE;
  v_latest public.photo_visit_event_revisions%ROWTYPE;
  v_leaf_id uuid;
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

  SELECT * INTO v_target
  FROM public.photo_visit_events
  WHERE id = target_event_id;

  IF v_target.id IS NULL OR v_target.event_type = 'route_reopened' THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  IF NOT public._can_manage_account_invitations(v_target.account_id) THEN
    RAISE EXCEPTION 'Account administrator access is required';
  END IF;

  IF target_occurred_on IS NULL THEN
    RAISE EXCEPTION 'Photo date is required';
  END IF;

  PERFORM public._lock_photo_history_facility(v_target.account_id, v_target.facility_id);

  /* Re-read after the mutex in case a stale request waited behind a capture. */
  SELECT * INTO v_target
  FROM public.photo_visit_events
  WHERE id = target_event_id
  FOR UPDATE;

  IF v_target.id IS NULL OR v_target.event_type = 'route_reopened' THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  v_leaf_id := public._photo_history_effective_leaf(v_target.id);

  SELECT * INTO v_event
  FROM public.photo_visit_events
  WHERE id = v_leaf_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  SELECT * INTO v_latest
  FROM public.photo_visit_event_revisions
  WHERE event_id = v_event.id
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
  v_timezone := COALESCE(v_timezone, v_event.account_timezone, 'America/Chicago');

  IF target_occurred_time IS NOT NULL THEN
    v_occurred_at :=
      (target_occurred_on + target_occurred_time) AT TIME ZONE v_timezone;
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
    changed_at,
    changed_by
  ) VALUES (
    v_event.account_id,
    v_event.id,
    'edit',
    v_occurred_at,
    target_occurred_on,
    target_occurred_time,
    NULLIF(BTRIM(target_reason), ''),
    jsonb_build_object(
      'occurred_at', v_previous_at,
      'occurred_on', v_previous_on,
      'occurred_time', v_previous_time,
      'was_deleted', v_latest.id IS NOT NULL AND v_latest.action = 'delete',
      'submitted_event_id', target_event_id
    ),
    clock_timestamp(),
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
  v_target public.photo_visit_events%ROWTYPE;
  v_event public.photo_visit_events%ROWTYPE;
  v_latest public.photo_visit_event_revisions%ROWTYPE;
  v_leaf_id uuid;
  v_previous_on date;
  v_previous_time time;
  v_previous_at timestamptz;
  v_revision_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_target
  FROM public.photo_visit_events
  WHERE id = target_event_id;

  IF v_target.id IS NULL OR v_target.event_type = 'route_reopened' THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  IF NOT public._can_manage_account_invitations(v_target.account_id) THEN
    RAISE EXCEPTION 'Account administrator access is required';
  END IF;

  PERFORM public._lock_photo_history_facility(v_target.account_id, v_target.facility_id);

  SELECT * INTO v_target
  FROM public.photo_visit_events
  WHERE id = target_event_id
  FOR UPDATE;

  IF v_target.id IS NULL OR v_target.event_type = 'route_reopened' THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  v_leaf_id := public._photo_history_effective_leaf(v_target.id);

  SELECT * INTO v_event
  FROM public.photo_visit_events
  WHERE id = v_leaf_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Photo history record not found';
  END IF;

  SELECT * INTO v_latest
  FROM public.photo_visit_event_revisions
  WHERE event_id = v_event.id
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
    changed_at,
    changed_by
  ) VALUES (
    v_event.account_id,
    v_event.id,
    'delete',
    COALESCE(NULLIF(BTRIM(target_reason), ''), 'Removed from photo history by an administrator'),
    jsonb_build_object(
      'occurred_at', v_previous_at,
      'occurred_on', v_previous_on,
      'occurred_time', v_previous_time,
      'submitted_event_id', target_event_id
    ),
    clock_timestamp(),
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

/* The legacy visit-log trigger used to replace both timestamp halves whenever
   either half was missing. That turned a truthful date-only entry into "now".
   Supply a default only when the caller supplied neither half. */
CREATE OR REPLACE FUNCTION public.record_route_visit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rounded_at timestamptz;
  v_timezone text;
  v_local timestamp;
BEGIN
  IF NEW.photos_taken IS TRUE
     AND COALESCE(OLD.photos_taken, false) IS FALSE
  THEN
    v_rounded_at := date_trunc('hour', now())
      + make_interval(mins => (round(extract(minute FROM now()) / 5.0) * 5)::integer);

    INSERT INTO public.route_visit_events (
      facility_id,
      account_id,
      recorded_by,
      visited_at
    ) VALUES (
      NEW.id,
      NEW.account_id,
      auth.uid(),
      v_rounded_at
    );

    IF NEW.field_visit_date IS NULL AND NEW.field_visit_time IS NULL THEN
      SELECT COALESCE(NULLIF(account.timezone, ''), 'America/Chicago')
      INTO v_timezone
      FROM public.accounts account
      WHERE account.id = NEW.account_id;
      v_timezone := COALESCE(v_timezone, 'America/Chicago');
      v_local := v_rounded_at AT TIME ZONE v_timezone;

      UPDATE public.facilities
      SET field_visit_date = v_local::date,
          field_visit_time = v_local::time
      WHERE id = NEW.id
        AND field_visit_date IS NULL
        AND field_visit_time IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_route_visit_event()
  FROM PUBLIC, anon, authenticated;

/* Facility snapshot writer. For a false -> true UPDATE where neither timestamp
   half was supplied, mirror the route-visit trigger's
   five-minute account-time stamp. A caller-supplied date-only or time-only value
   is retained exactly and is never replaced with the current date. */
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
  v_rounded_at timestamptz;
  v_local timestamp;
  v_occurred_on date;
  v_occurred_time time;
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

  SELECT COALESCE(NULLIF(a.timezone, ''), 'America/Chicago')
  INTO v_timezone
  FROM public.accounts a
  WHERE a.id = NEW.account_id;
  v_timezone := COALESCE(v_timezone, 'America/Chicago');

  v_occurred_on := NEW.field_visit_date;
  v_occurred_time := NEW.field_visit_time;

  IF TG_OP = 'UPDATE'
     AND OLD.photos_taken IS DISTINCT FROM TRUE
     AND NEW.field_visit_date IS NULL
     AND NEW.field_visit_time IS NULL
  THEN
    v_rounded_at := date_trunc('hour', now())
      + make_interval(mins => (round(extract(minute FROM now()) / 5.0) * 5)::integer);
    v_local := v_rounded_at AT TIME ZONE v_timezone;
    v_occurred_at := v_rounded_at;
    v_occurred_on := v_local::date;
    v_occurred_time := v_local::time;
  ELSIF v_occurred_on IS NOT NULL AND v_occurred_time IS NOT NULL THEN
    v_occurred_at := (v_occurred_on + v_occurred_time) AT TIME ZONE v_timezone;
  END IF;

  /* A route RPC or per-berm trigger may already have written the fully
     attributed event in this transaction. */
  IF EXISTS (
    SELECT 1
    FROM public.photo_visit_events event
    WHERE event.facility_id = NEW.id
      AND event.recorded_at = transaction_timestamp()
  ) THEN
    RETURN NEW;
  END IF;

  IF v_event_type = 'timestamp_corrected' THEN
    PERFORM public._lock_photo_history_facility(NEW.account_id, NEW.id);

    v_supersedes := public._find_photo_snapshot_history_leaf(
      NEW.account_id,
      NEW.id,
      NULL,
      OLD.field_visit_date,
      OLD.field_visit_time
    );

    IF v_supersedes IS NULL THEN
      RAISE EXCEPTION
        'Cannot safely link this facility timestamp correction to one photo-history record';
    END IF;
  END IF;

  INSERT INTO public.photo_visit_events (
    account_id,
    facility_id,
    facility_name_snapshot,
    event_type,
    occurred_at,
    occurred_on,
    occurred_time,
    account_timezone,
    recorded_by,
    source,
    supersedes_event_id,
    metadata
  ) VALUES (
    NEW.account_id,
    NEW.id,
    NEW.name,
    v_event_type,
    v_occurred_at,
    v_occurred_on,
    v_occurred_time,
    v_timezone,
    auth.uid(),
    CASE
      WHEN v_event_type = 'timestamp_corrected' THEN 'facility_timestamp_correction'
      WHEN TG_OP = 'INSERT' THEN 'facility_insert'
      ELSE 'facility_status'
    END,
    v_supersedes,
    jsonb_build_object(
      'precision', CASE
        WHEN v_occurred_on IS NULL AND v_occurred_time IS NULL THEN 'unknown'
        WHEN v_occurred_on IS NULL THEN 'time'
        WHEN v_occurred_time IS NULL THEN 'date'
        ELSE 'instant'
      END,
      'snapshot_parent_found', v_supersedes IS NOT NULL,
      'correction_requested', v_event_type = 'timestamp_corrected'
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_facility_photo_visit_event()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facilities_capture_photo_visit_event ON public.facilities;
CREATE TRIGGER facilities_capture_photo_visit_event
  AFTER INSERT OR UPDATE ON public.facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_facility_photo_visit_event();

/* Per-berm writer. field_visit_time is facility-level by design. It may be
   attached to a berm only when the facility date matches that berm's date. */
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
  v_occurred_at timestamptz;
  v_occurred_on date;
  v_occurred_time time;
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

  /* The route RPC writes one aggregate event before mirroring every berm. A
     prior event for another berm in a direct multi-row UPDATE must not suppress
     this berm's own history event. Check this before taking the correction mutex
     so route and direct plan updates cannot invert advisory/row-lock order. */
  IF EXISTS (
    SELECT 1
    FROM public.photo_visit_events event
    WHERE event.account_id = v_facility.account_id
      AND event.facility_id = v_facility.id
      AND event.recorded_at = transaction_timestamp()
      AND (
        event.route_run_id IS NOT NULL
        OR event.spcc_plan_id = NEW.id
      )
  ) THEN
    RETURN NEW;
  END IF;

  IF v_event_type = 'timestamp_corrected' THEN
    PERFORM public._lock_photo_history_facility(v_facility.account_id, v_facility.id);

    /* Re-read after the mutex so a concurrent facility timestamp change cannot
       be mixed with this plan row's date. */
    SELECT * INTO v_facility
    FROM public.facilities
    WHERE id = NEW.facility_id;

    IF v_facility.id IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(a.timezone, ''), 'America/Chicago')
  INTO v_timezone
  FROM public.accounts a
  WHERE a.id = v_facility.account_id;
  v_timezone := COALESCE(v_timezone, 'America/Chicago');

  v_occurred_on := NEW.field_visit_date;
  v_occurred_time := CASE
    WHEN NEW.field_visit_date IS NULL
      OR v_facility.field_visit_date IS DISTINCT FROM NEW.field_visit_date
      THEN NULL
    ELSE v_facility.field_visit_time
  END;

  IF v_occurred_on IS NOT NULL AND v_occurred_time IS NOT NULL THEN
    v_occurred_at := (v_occurred_on + v_occurred_time) AT TIME ZONE v_timezone;
  END IF;

  IF v_event_type = 'timestamp_corrected' THEN
    v_supersedes := public._find_photo_snapshot_history_leaf(
      v_facility.account_id,
      v_facility.id,
      NEW.id,
      OLD.field_visit_date,
      NULL
    );

    IF v_supersedes IS NULL THEN
      RAISE EXCEPTION
        'Cannot safely link this plan timestamp correction to one photo-history record';
    END IF;
  END IF;

  INSERT INTO public.photo_visit_events (
    account_id,
    facility_id,
    facility_name_snapshot,
    spcc_plan_id,
    berm_index,
    event_type,
    occurred_at,
    occurred_on,
    occurred_time,
    account_timezone,
    recorded_by,
    source,
    supersedes_event_id,
    metadata
  ) VALUES (
    v_facility.account_id,
    v_facility.id,
    v_facility.name,
    NEW.id,
    NEW.berm_index,
    v_event_type,
    v_occurred_at,
    v_occurred_on,
    v_occurred_time,
    v_timezone,
    auth.uid(),
    CASE
      WHEN v_event_type = 'timestamp_corrected' THEN 'spcc_plan_timestamp_correction'
      ELSE 'spcc_plan_status'
    END,
    v_supersedes,
    jsonb_build_object(
      'precision', CASE
        WHEN v_occurred_on IS NULL THEN 'unknown'
        WHEN v_occurred_time IS NULL THEN 'date'
        ELSE 'instant'
      END,
      'snapshot_parent_found', v_supersedes IS NOT NULL,
      'correction_requested', v_event_type = 'timestamp_corrected'
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_spcc_plan_photo_visit_event()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS spcc_plans_capture_photo_visit_event ON public.spcc_plans;
CREATE TRIGGER spcc_plans_capture_photo_visit_event
  AFTER INSERT OR UPDATE ON public.spcc_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_spcc_plan_photo_visit_event();

/* Every automatic timestamp correction shares the same facility mutex as admin
   revisions. A correction must name its physical parent explicitly; validate
   that parent's scope, then advance only within that lineage after acquiring
   the mutex. There is intentionally no "latest similar event" fallback. */
CREATE OR REPLACE FUNCTION public.normalize_photo_timestamp_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anchor public.photo_visit_events%ROWTYPE;
  v_leaf public.photo_visit_events%ROWTYPE;
  v_current_leaf uuid;
  v_leaf_latest_action text;
  v_leaf_latest_revision_id uuid;
BEGIN
  IF NEW.event_type <> 'timestamp_corrected' OR NEW.facility_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public._lock_photo_history_facility(NEW.account_id, NEW.facility_id);

  IF NEW.supersedes_event_id IS NULL THEN
    RAISE EXCEPTION 'Timestamp correction requires an explicit photo-history parent';
  END IF;

  SELECT * INTO v_anchor
  FROM public.photo_visit_events
  WHERE id = NEW.supersedes_event_id
    AND account_id = NEW.account_id
    AND facility_id = NEW.facility_id
    AND event_type <> 'route_reopened';

  IF v_anchor.id IS NULL THEN
    RAISE EXCEPTION 'Timestamp correction parent is outside this account or facility';
  END IF;

  v_current_leaf := public._photo_history_effective_leaf(v_anchor.id);

  SELECT * INTO v_leaf
  FROM public.photo_visit_events
  WHERE id = v_current_leaf
    AND account_id = NEW.account_id
    AND facility_id = NEW.facility_id
    AND event_type <> 'route_reopened';

  IF v_leaf.id IS NULL THEN
    RAISE EXCEPTION 'Timestamp correction parent has no valid history leaf';
  END IF;

  SELECT revision.id, revision.action
  INTO v_leaf_latest_revision_id, v_leaf_latest_action
  FROM public.photo_visit_event_revisions revision
  WHERE revision.event_id = v_leaf.id
  ORDER BY revision.changed_at DESC, revision.id DESC
  LIMIT 1;

  IF v_leaf_latest_action = 'delete' THEN
    /* The current snapshot can legitimately change after an admin hid its old
       history row. Append a visibly attributed successor; never erase or alter
       the tombstone that explains why the prior leaf became inactive. */
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'succeeds_admin_tombstone', true,
      'tombstone_revision_id', v_leaf_latest_revision_id,
      'tombstoned_event_id', v_leaf.id
    );
  END IF;

  NEW.supersedes_event_id := v_leaf.id;
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

/* -------------------------------------------------------------------------
   Append-only legacy repair
   ------------------------------------------------------------------------- */

/* Preserve pre-ledger partial-berm state. The old facility aggregate is
   bool_and, so a completed berm can exist while facilities.photos_taken=false
   and while no legacy route_visit_events row exists. The dedicated partial
   index makes this one-time import durable even if a later migration is retried
   with a different generated idempotency key. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_visit_events_legacy_partial_berm
  ON public.photo_visit_events(spcc_plan_id)
  WHERE source = 'legacy_spcc_plan_state'
    AND spcc_plan_id IS NOT NULL;

INSERT INTO public.photo_visit_events (
  account_id,
  facility_id,
  facility_name_snapshot,
  spcc_plan_id,
  berm_index,
  event_type,
  occurred_at,
  occurred_on,
  occurred_time,
  account_timezone,
  recorded_at,
  recorded_by,
  source,
  idempotency_key,
  metadata
)
SELECT
  facility.account_id,
  facility.id,
  facility.name,
  plan.id,
  plan.berm_index,
  'legacy',
  NULL::timestamptz,
  plan.field_visit_date,
  NULL::time,
  COALESCE(NULLIF(account.timezone, ''), 'America/Chicago'),
  clock_timestamp(),
  NULL,
  'legacy_spcc_plan_state',
  md5('legacy-spcc-plan-state:' || plan.id::text)::uuid,
  jsonb_build_object(
    'legacy', true,
    'inferred', true,
    'partial_berm_backfill', true,
    'precision', CASE
      WHEN plan.field_visit_date IS NULL THEN 'unknown'
      ELSE 'date'
    END
  )
FROM public.spcc_plans plan
JOIN public.facilities facility ON facility.id = plan.facility_id
JOIN public.accounts account ON account.id = facility.account_id
WHERE plan.photos_taken IS TRUE
  AND facility.photos_taken IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM public.photo_visit_events existing
    WHERE existing.spcc_plan_id = plan.id
      AND existing.event_type <> 'route_reopened'
  )
ON CONFLICT (spcc_plan_id)
  WHERE source = 'legacy_spcc_plan_state'
    AND spcc_plan_id IS NOT NULL
  DO NOTHING;

/* A legacy reset deliberately left the last visit date/time intact while
   setting photos_taken=false. Migration 000 imported only true facilities, so
   retain this paired, known facility snapshot when no history at all exists for
   the facility. The NOT EXISTS guard prevents duplicating migration 000 or the
   more precise partial-berm rows above. */
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
  idempotency_key,
  metadata
)
SELECT
  facility.account_id,
  facility.id,
  facility.name,
  'legacy',
  CASE
    WHEN facility.field_visit_time IS NOT NULL
      THEN (facility.field_visit_date + facility.field_visit_time)
        AT TIME ZONE COALESCE(NULLIF(account.timezone, ''), 'America/Chicago')
    ELSE NULL
  END,
  facility.field_visit_date,
  facility.field_visit_time,
  COALESCE(NULLIF(account.timezone, ''), 'America/Chicago'),
  clock_timestamp(),
  NULL,
  'legacy_facility_state',
  md5('legacy-dated-facility-state:' || facility.id::text)::uuid,
  jsonb_build_object(
    'legacy', true,
    'inferred', true,
    'dated_snapshot_backfill', true,
    'precision', CASE WHEN facility.field_visit_time IS NULL THEN 'date' ELSE 'instant' END
  )
FROM public.facilities facility
JOIN public.accounts account ON account.id = facility.account_id
WHERE facility.field_visit_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.photo_visit_events existing
    WHERE existing.facility_id = facility.id
      AND existing.event_type <> 'route_reopened'
  )
ON CONFLICT (idempotency_key) DO NOTHING;

COMMENT ON FUNCTION public._photo_history_effective_leaf(uuid) IS
  'Returns the newest non-reopen leaf for one immutable physical photo-occurrence chain.';

COMMENT ON FUNCTION public._find_photo_snapshot_history_leaf(uuid, uuid, uuid, date, time) IS
  'Finds the newest scoped automatic history anchor matching an OLD facility or SPCC-plan snapshot.';
