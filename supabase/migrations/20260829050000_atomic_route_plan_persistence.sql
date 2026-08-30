/*
  # Persist route plans and facility assignments atomically

  Route optimization is computed in the client, but the saved route and the
  facilities' day/team assignments represent one logical change. Applying them
  in one database transaction prevents a failed rebuild from partially changing
  the route that a field team is already using.

  This migration also serializes active-outing stop synchronization with outing
  resets so a late load cannot write stops into a run that has just ended.
*/

CREATE OR REPLACE FUNCTION public.save_route_plan_with_assignments(
  target_account_id uuid,
  target_route_plan_id uuid,
  target_user_id uuid,
  target_upload_batch_id uuid,
  target_plan_data jsonb,
  target_total_days integer,
  target_total_miles numeric,
  target_total_facilities integer,
  target_name text,
  target_settings jsonb,
  target_home_base_data jsonb,
  target_assignments jsonb,
  target_mark_last_viewed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_route_id uuid;
  v_route_name text;
  v_assignment_count integer;
  v_distinct_assignment_count integer;
  v_updated_assignment_count integer;
BEGIN
  IF auth.uid() IS NULL
     OR target_account_id IS NULL
     OR NOT public.user_has_account_access(target_account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this account';
  END IF;

  IF target_plan_data IS NULL OR jsonb_typeof(target_plan_data) <> 'object' THEN
    RAISE EXCEPTION 'Route plan data must be a JSON object';
  END IF;
  IF target_total_days IS NULL OR target_total_days < 0
     OR target_total_miles IS NULL OR target_total_miles < 0
     OR target_total_facilities IS NULL OR target_total_facilities < 0
  THEN
    RAISE EXCEPTION 'Route totals are invalid';
  END IF;
  IF target_assignments IS NULL OR jsonb_typeof(target_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Route assignments must be a JSON array';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT assignment.facility_id)
  INTO v_assignment_count, v_distinct_assignment_count
  FROM jsonb_to_recordset(target_assignments) AS assignment(
    facility_id uuid,
    day_assignment integer,
    team_assignment integer
  );

  IF v_assignment_count <> v_distinct_assignment_count THEN
    RAISE EXCEPTION 'Route assignments contain duplicate facilities';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(target_assignments) AS assignment(
      facility_id uuid,
      day_assignment integer,
      team_assignment integer
    )
    LEFT JOIN public.facilities facility
      ON facility.id = assignment.facility_id
     AND facility.account_id = target_account_id
    WHERE assignment.facility_id IS NULL
       OR (
         assignment.day_assignment IS NOT NULL
         AND (
           assignment.day_assignment < -2
           OR assignment.day_assignment = 0
         )
       )
       OR assignment.team_assignment IS NULL
       OR assignment.team_assignment < 1
       OR facility.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A route assignment is invalid or belongs to another account';
  END IF;

  /* Serialize route saves for this account without locking the accounts row.
     A row lock there would conflict with FK checks while outing reset already
     holds the route-plan row, creating an account -> route / route -> account
     deadlock. This transaction-scoped advisory lock is used only by route
     saves, while the route row below still orders saves against outing reset. */
  PERFORM pg_advisory_xact_lock(
    hashtextextended('route_plan_save:' || target_account_id::text, 0)
  );

  PERFORM 1
  FROM public.accounts account_row
  WHERE account_row.id = target_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF target_route_plan_id IS NOT NULL THEN
    SELECT route_plan.id, route_plan.name
    INTO v_route_id, v_route_name
    FROM public.route_plans route_plan
    WHERE route_plan.id = target_route_plan_id
      AND route_plan.account_id = target_account_id
    FOR UPDATE;

    IF v_route_id IS NULL THEN
      RAISE EXCEPTION 'Route plan not found for this account';
    END IF;
  ELSE
    IF target_user_id IS NULL OR target_upload_batch_id IS NULL THEN
      RAISE EXCEPTION 'A user and upload batch are required for a new route';
    END IF;
    v_route_id := gen_random_uuid();
    v_route_name := COALESCE(NULLIF(BTRIM(target_name), ''), 'Route');
  END IF;

  IF COALESCE(target_mark_last_viewed, true) THEN
    UPDATE public.route_plans
    SET is_last_viewed = false
    WHERE account_id = target_account_id
      AND is_last_viewed IS TRUE
      AND id IS DISTINCT FROM v_route_id;
  END IF;

  IF target_route_plan_id IS NOT NULL THEN
    UPDATE public.route_plans
    SET plan_data = target_plan_data,
        total_days = target_total_days,
        total_miles = target_total_miles,
        total_facilities = target_total_facilities,
        is_last_viewed = CASE
          WHEN COALESCE(target_mark_last_viewed, true) THEN true
          ELSE is_last_viewed
        END,
        settings = target_settings,
        home_base_data = target_home_base_data
    WHERE id = v_route_id;
  ELSE
    INSERT INTO public.route_plans (
      id,
      user_id,
      account_id,
      upload_batch_id,
      plan_data,
      total_days,
      total_miles,
      total_facilities,
      name,
      is_last_viewed,
      settings,
      home_base_data
    ) VALUES (
      v_route_id,
      target_user_id,
      target_account_id,
      target_upload_batch_id,
      target_plan_data,
      target_total_days,
      target_total_miles,
      target_total_facilities,
      v_route_name,
      COALESCE(target_mark_last_viewed, true),
      target_settings,
      target_home_base_data
    );
  END IF;

  /* A replacement route is the authoritative set of positive day
     assignments. Clear facilities left behind by the prior route inside the
     same account lock and transaction, while preserving explicit user
     exclusions (-1 and -2). Without this step a smaller replacement subset
     leaves ghost Day N labels on Facilities and marker views. */
  UPDATE public.facilities facility
  SET day_assignment = NULL
  WHERE facility.account_id = target_account_id
    AND facility.day_assignment > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(target_assignments) AS assignment(
        facility_id uuid,
        day_assignment integer,
        team_assignment integer
      )
      WHERE assignment.facility_id = facility.id
    );

  UPDATE public.facilities facility
  SET day_assignment = assignment.day_assignment,
      team_assignment = assignment.team_assignment
  FROM jsonb_to_recordset(target_assignments) AS assignment(
    facility_id uuid,
    day_assignment integer,
    team_assignment integer
  )
  WHERE facility.id = assignment.facility_id
    AND facility.account_id = target_account_id;

  GET DIAGNOSTICS v_updated_assignment_count = ROW_COUNT;
  IF v_updated_assignment_count <> v_assignment_count THEN
    RAISE EXCEPTION 'Not all route assignments could be saved';
  END IF;

  SELECT route_plan.name INTO v_route_name
  FROM public.route_plans route_plan
  WHERE route_plan.id = v_route_id;

  RETURN jsonb_build_object(
    'id', v_route_id,
    'name', v_route_name,
    'assignment_count', v_updated_assignment_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_route_plan_with_assignments(
  uuid, uuid, uuid, uuid, jsonb, integer, numeric, integer,
  text, jsonb, jsonb, jsonb, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_route_plan_with_assignments(
  uuid, uuid, uuid, uuid, jsonb, integer, numeric, integer,
  text, jsonb, jsonb, jsonb, boolean
) TO authenticated;

/* Save, rename, and optionally replace a colliding named route in one
   transaction. The confirmation remains a client concern, but once the user
   confirms, deleting the old named route and saving its replacement either
   both succeed or both roll back. */
CREATE OR REPLACE FUNCTION public.save_named_route_plan_with_assignments(
  target_account_id uuid,
  target_route_plan_id uuid,
  target_user_id uuid,
  target_upload_batch_id uuid,
  target_plan_data jsonb,
  target_total_days integer,
  target_total_miles numeric,
  target_total_facilities integer,
  target_name text,
  target_settings jsonb,
  target_home_base_data jsonb,
  target_assignments jsonb,
  target_mark_last_viewed boolean,
  target_replace_route_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_name text := NULLIF(BTRIM(target_name), '');
  v_result jsonb;
  v_route_id uuid;
  v_replacement_name text;
  v_replacement_is_current boolean;
BEGIN
  IF auth.uid() IS NULL
     OR target_account_id IS NULL
     OR NOT public.user_has_account_access(target_account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this account';
  END IF;
  IF v_clean_name IS NULL THEN
    RAISE EXCEPTION 'A route name is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('route_plan_save:' || target_account_id::text, 0)
  );

  IF target_replace_route_plan_id IS NOT NULL THEN
    IF target_replace_route_plan_id IS NOT DISTINCT FROM target_route_plan_id THEN
      RAISE EXCEPTION 'The active route cannot replace itself';
    END IF;

    SELECT route_plan.name, route_plan.is_last_viewed
    INTO v_replacement_name, v_replacement_is_current
    FROM public.route_plans route_plan
    WHERE route_plan.id = target_replace_route_plan_id
      AND route_plan.account_id = target_account_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The route selected for replacement no longer exists';
    END IF;
    IF v_replacement_name IS DISTINCT FROM v_clean_name THEN
      RAISE EXCEPTION 'The route selected for replacement was renamed; review the saved routes and try again';
    END IF;
    IF v_replacement_is_current IS TRUE THEN
      RAISE EXCEPTION 'The route selected for replacement is now current; load or save again before overwriting it';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.plan_route_runs route_run
      WHERE route_run.account_id = target_account_id
        AND route_run.route_plan_id = target_replace_route_plan_id
        AND route_run.status = 'active'
    ) THEN
      RAISE EXCEPTION 'That saved route has an active outing and cannot be overwritten';
    END IF;

    DELETE FROM public.route_plans route_plan
    WHERE route_plan.id = target_replace_route_plan_id
      AND route_plan.account_id = target_account_id;

  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.route_plans route_plan
    WHERE route_plan.account_id = target_account_id
      AND route_plan.name = v_clean_name
      AND route_plan.id IS DISTINCT FROM target_route_plan_id
  ) THEN
    RAISE EXCEPTION 'Another saved route already uses this name';
  END IF;

  v_result := public.save_route_plan_with_assignments(
    target_account_id,
    target_route_plan_id,
    target_user_id,
    target_upload_batch_id,
    target_plan_data,
    target_total_days,
    target_total_miles,
    target_total_facilities,
    v_clean_name,
    target_settings,
    target_home_base_data,
    target_assignments,
    target_mark_last_viewed
  );

  v_route_id := (v_result ->> 'id')::uuid;
  UPDATE public.route_plans
  SET name = v_clean_name
  WHERE id = v_route_id
    AND account_id = target_account_id;

  RETURN v_result || jsonb_build_object('name', v_clean_name);
END;
$$;

REVOKE ALL ON FUNCTION public.save_named_route_plan_with_assignments(
  uuid, uuid, uuid, uuid, jsonb, integer, numeric, integer,
  text, jsonb, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_named_route_plan_with_assignments(
  uuid, uuid, uuid, uuid, jsonb, integer, numeric, integer,
  text, jsonb, jsonb, jsonb, boolean, uuid
) TO authenticated;

/* Resolve the assignment snapshot from the saved plan itself. This is kept on
   the server so a stale browser can never supply an older assignment list
   while activating a route whose plan_data was updated by another admin. */
CREATE OR REPLACE FUNCTION public._route_plan_assignments_from_data(
  target_account_id uuid,
  target_plan_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignments jsonb;
  v_assignment_count integer;
  v_distinct_assignment_count integer;
BEGIN
  IF target_account_id IS NULL
     OR target_plan_data IS NULL
     OR jsonb_typeof(target_plan_data) <> 'object'
     OR jsonb_typeof(target_plan_data -> 'routes') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'The saved route does not contain a valid stop list';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(target_plan_data -> 'routes') AS route_item(value)
    WHERE NULLIF(route_item.value ->> 'day', '') IS NULL
       OR NULLIF(route_item.value ->> 'day', '') !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(route_item.value -> 'facilities') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'The saved route contains an invalid day or stop list';
  END IF;

  WITH route_rows AS (
    SELECT route_item.value AS route_data
    FROM jsonb_array_elements(target_plan_data -> 'routes') AS route_item(value)
  ),
  raw_stops AS (
    SELECT
      route_data,
      stop_item.value AS stop_data,
      stop_item.ordinality::integer AS planned_position,
      (route_data ->> 'day')::integer AS day_assignment,
      CASE
        WHEN NULLIF(stop_item.value ->> 'id', '') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
          THEN (stop_item.value ->> 'id')::uuid
        ELSE NULL
      END AS saved_facility_id
    FROM route_rows
    CROSS JOIN LATERAL jsonb_array_elements(route_data -> 'facilities')
      WITH ORDINALITY AS stop_item(value, ordinality)
  ),
  resolved_stops AS (
    SELECT
      raw_stop.*,
      COALESCE(raw_stop.saved_facility_id, name_match.facility_id) AS facility_id,
      name_match.match_count
    FROM raw_stops raw_stop
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN COUNT(*) = 1
            THEN (ARRAY_AGG(candidate.id ORDER BY candidate.id::text))[1]
          ELSE NULL
        END AS facility_id,
        COUNT(*)::integer AS match_count
      FROM public.facilities candidate
      WHERE candidate.account_id = target_account_id
        AND candidate.name = raw_stop.stop_data ->> 'name'
    ) name_match ON raw_stop.saved_facility_id IS NULL
  ),
  valid_assignments AS (
    SELECT
      facility.id AS facility_id,
      facility.name AS facility_name,
      resolved.day_assignment,
      CASE
        WHEN NULLIF(resolved.stop_data ->> 'teamAssignment', '') ~ '^[1-9][0-9]*$'
          THEN (resolved.stop_data ->> 'teamAssignment')::integer
        WHEN facility.team_assignment IS NOT NULL AND facility.team_assignment > 0
          THEN facility.team_assignment
        ELSE 1
      END AS team_assignment,
      resolved.planned_position
    FROM resolved_stops resolved
    JOIN public.facilities facility
      ON facility.id = resolved.facility_id
     AND facility.account_id = target_account_id
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'facility_id', valid.facility_id,
          'facility_name', valid.facility_name,
          'day_assignment', valid.day_assignment,
          'planned_day', valid.day_assignment,
          'team_assignment', valid.team_assignment,
          'planned_position', valid.planned_position
        )
        ORDER BY valid.day_assignment, valid.planned_position, valid.facility_id
      ),
      '[]'::jsonb
    ),
    COUNT(*)::integer,
    COUNT(DISTINCT valid.facility_id)::integer
  INTO v_assignments, v_assignment_count, v_distinct_assignment_count
  FROM valid_assignments valid;

  IF EXISTS (
    WITH route_rows AS (
      SELECT route_item.value AS route_data
      FROM jsonb_array_elements(target_plan_data -> 'routes') AS route_item(value)
    ),
    raw_stops AS (
      SELECT
        stop_item.value AS stop_data,
        CASE
          WHEN NULLIF(stop_item.value ->> 'id', '') ~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
            THEN (stop_item.value ->> 'id')::uuid
          ELSE NULL
        END AS saved_facility_id
      FROM route_rows
      CROSS JOIN LATERAL jsonb_array_elements(route_data -> 'facilities')
        AS stop_item(value)
    )
    SELECT 1
    FROM raw_stops raw_stop
    WHERE raw_stop.saved_facility_id IS NULL
      AND (
        SELECT COUNT(*)
        FROM public.facilities candidate
        WHERE candidate.account_id = target_account_id
          AND candidate.name = raw_stop.stop_data ->> 'name'
      ) > 1
  ) THEN
    RAISE EXCEPTION 'A legacy saved stop matches more than one facility';
  END IF;

  IF v_assignment_count <> v_distinct_assignment_count THEN
    RAISE EXCEPTION 'The saved route contains a duplicate facility';
  END IF;

  RETURN v_assignments;
END;
$$;

REVOKE ALL ON FUNCTION public._route_plan_assignments_from_data(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

/* Activating a saved route also restores the facility assignment snapshot
   represented by its locked plan data. target_require_current is used by cold
   hydration so an older tab cannot reactivate a route that another admin made
   non-current after the initial read. */
CREATE OR REPLACE FUNCTION public.activate_route_plan_with_assignments(
  target_account_id uuid,
  target_route_plan_id uuid,
  target_assignments jsonb,
  target_require_current boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_data jsonb;
  v_route_name text;
  v_route_settings jsonb;
  v_home_base_data jsonb;
  v_was_current boolean;
  v_authoritative_assignments jsonb;
  v_assignment_count integer;
  v_distinct_assignment_count integer;
  v_updated_assignment_count integer;
BEGIN
  IF auth.uid() IS NULL
     OR target_account_id IS NULL
     OR target_route_plan_id IS NULL
     OR NOT public.user_has_account_access(target_account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this account';
  END IF;
  IF target_assignments IS NULL OR jsonb_typeof(target_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Route assignments must be a JSON array';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('route_plan_save:' || target_account_id::text, 0)
  );

  SELECT
    route_plan.plan_data,
    route_plan.name,
    route_plan.settings,
    route_plan.home_base_data,
    route_plan.is_last_viewed
  INTO v_plan_data, v_route_name, v_route_settings, v_home_base_data, v_was_current
  FROM public.route_plans route_plan
  WHERE route_plan.id = target_route_plan_id
    AND route_plan.account_id = target_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route plan not found for this account';
  END IF;

  IF COALESCE(target_require_current, false) AND v_was_current IS NOT TRUE THEN
    RAISE EXCEPTION 'The saved route is no longer current; reload the current route';
  END IF;

  v_authoritative_assignments := public._route_plan_assignments_from_data(
    target_account_id,
    v_plan_data
  );

  SELECT COUNT(*), COUNT(DISTINCT assignment.facility_id)
  INTO v_assignment_count, v_distinct_assignment_count
  FROM jsonb_to_recordset(v_authoritative_assignments) AS assignment(
    facility_id uuid,
    day_assignment integer,
    team_assignment integer
  );

  IF v_assignment_count <> v_distinct_assignment_count THEN
    RAISE EXCEPTION 'Route assignments contain duplicate facilities';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_authoritative_assignments) AS assignment(
      facility_id uuid,
      day_assignment integer,
      team_assignment integer
    )
    WHERE assignment.facility_id IS NULL
       OR assignment.day_assignment IS NULL
       OR assignment.day_assignment < 1
       OR assignment.team_assignment IS NULL
       OR assignment.team_assignment < 1
  ) THEN
    RAISE EXCEPTION 'The saved route contains an invalid assignment';
  END IF;

  UPDATE public.route_plans
  SET is_last_viewed = (id = target_route_plan_id)
  WHERE account_id = target_account_id
    AND (is_last_viewed IS TRUE OR id = target_route_plan_id);

  UPDATE public.facilities facility
  SET day_assignment = NULL
  WHERE facility.account_id = target_account_id
    AND facility.day_assignment > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_authoritative_assignments) AS assignment(
        facility_id uuid,
        day_assignment integer,
        team_assignment integer
      )
      WHERE assignment.facility_id = facility.id
    );

  UPDATE public.facilities facility
  SET day_assignment = assignment.day_assignment,
      team_assignment = assignment.team_assignment
  FROM jsonb_to_recordset(v_authoritative_assignments) AS assignment(
    facility_id uuid,
    day_assignment integer,
    team_assignment integer
  )
  WHERE facility.id = assignment.facility_id
    AND facility.account_id = target_account_id;

  GET DIAGNOSTICS v_updated_assignment_count = ROW_COUNT;
  IF v_updated_assignment_count <> v_assignment_count THEN
    RAISE EXCEPTION 'Not all route assignments could be activated';
  END IF;

  RETURN jsonb_build_object(
    'id', target_route_plan_id,
    'name', v_route_name,
    'plan_data', v_plan_data,
    'settings', v_route_settings,
    'home_base_data', v_home_base_data,
    'assignments', v_authoritative_assignments,
    'assignment_count', v_updated_assignment_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_route_plan_with_assignments(uuid, uuid, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_route_plan_with_assignments(uuid, uuid, jsonb, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_saved_route(
  target_account_id uuid,
  target_route_plan_id uuid,
  target_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_name text := NULLIF(BTRIM(target_name), '');
BEGIN
  IF auth.uid() IS NULL
     OR target_account_id IS NULL
     OR target_route_plan_id IS NULL
     OR NOT public.user_has_account_access(target_account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this account';
  END IF;
  IF v_clean_name IS NULL THEN
    RAISE EXCEPTION 'A route name is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('route_plan_save:' || target_account_id::text, 0)
  );

  PERFORM 1
  FROM public.route_plans route_plan
  WHERE route_plan.id = target_route_plan_id
    AND route_plan.account_id = target_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route plan not found for this account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.route_plans route_plan
    WHERE route_plan.account_id = target_account_id
      AND route_plan.name = v_clean_name
      AND route_plan.id <> target_route_plan_id
  ) THEN
    RAISE EXCEPTION 'Another saved route already uses this name';
  END IF;

  UPDATE public.route_plans
  SET name = v_clean_name
  WHERE id = target_route_plan_id
    AND account_id = target_account_id;

  RETURN v_clean_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_saved_route(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_saved_route(uuid, uuid, text)
  TO authenticated;

/* Explicit route deletion archives any active outing first. The outing stops
   and immutable photo ledger remain in place for audit, while no active run is
   left orphaned after the route FK becomes NULL. */
CREATE OR REPLACE FUNCTION public.delete_saved_route(
  target_account_id uuid,
  target_route_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived_run_count integer;
BEGIN
  IF auth.uid() IS NULL
     OR target_account_id IS NULL
     OR target_route_plan_id IS NULL
     OR NOT public.user_has_account_access(target_account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this account';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('route_plan_save:' || target_account_id::text, 0)
  );

  PERFORM 1
  FROM public.route_plans route_plan
  WHERE route_plan.id = target_route_plan_id
    AND route_plan.account_id = target_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route plan not found for this account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.route_plans route_plan
    WHERE route_plan.id = target_route_plan_id
      AND route_plan.account_id = target_account_id
      AND route_plan.is_last_viewed IS TRUE
  ) THEN
    RAISE EXCEPTION 'The current route cannot be deleted; load a different route first';
  END IF;

  UPDATE public.plan_route_runs route_run
  SET status = 'abandoned',
      ended_at = COALESCE(route_run.ended_at, now()),
      ended_by = COALESCE(route_run.ended_by, auth.uid())
  WHERE route_run.account_id = target_account_id
    AND route_run.route_plan_id = target_route_plan_id
    AND route_run.status = 'active';
  GET DIAGNOSTICS v_archived_run_count = ROW_COUNT;

  DELETE FROM public.route_plans route_plan
  WHERE route_plan.id = target_route_plan_id
    AND route_plan.account_id = target_account_id;

  RETURN jsonb_build_object(
    'id', target_route_plan_id,
    'archived_outing_count', v_archived_run_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_saved_route(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_saved_route(uuid, uuid)
  TO authenticated;

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
  v_route_plan_data jsonb;
  v_authoritative_stops jsonb;
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

  /* The saved route is the membership authority. A second browser can still
     hold an older client-side result after another administrator updates the
     route, so accepting target_stops here would let that stale tab resurrect
     removed stops and remove newly added ones. start_plan_route_run already
     locks the route row; sync_plan_route_run_stops below takes the same lock
     before it calls this helper. */
  SELECT route_plan.plan_data INTO v_route_plan_data
  FROM public.route_plans route_plan
  WHERE route_plan.id = v_run.route_plan_id
    AND route_plan.account_id = v_run.account_id;

  IF v_route_plan_data IS NULL THEN
    RAISE EXCEPTION 'The active outing no longer has a saved route';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'facility_id', assignment.facility_id,
        'facility_name', assignment.facility_name,
        'planned_day', assignment.planned_day,
        'planned_position', assignment.planned_position
      )
      ORDER BY assignment.planned_day, assignment.planned_position, assignment.facility_id
    ),
    '[]'::jsonb
  )
  INTO v_authoritative_stops
  FROM jsonb_to_recordset(
    public._route_plan_assignments_from_data(v_run.account_id, v_route_plan_data)
  ) AS assignment(
    facility_id uuid,
    facility_name text,
    day_assignment integer,
    planned_day integer,
    team_assignment integer,
    planned_position integer
  )
  WHERE assignment.team_assignment = v_run.team_number;

  FOR v_stop IN
    SELECT value FROM jsonb_array_elements(v_authoritative_stops)
  LOOP
    v_facility_id := NULLIF(v_stop->>'facility_id', '')::uuid;
    v_facility_name := NULLIF(v_stop->>'facility_name', '');

    IF v_facility_id IS NULL OR v_facility_name IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.facilities facility
      WHERE facility.id = v_facility_id
        AND facility.account_id = v_run.account_id
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
    AND (
      existing.facility_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_authoritative_stops) incoming
        WHERE NULLIF(incoming->>'facility_id', '')::uuid = existing.facility_id
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public._sync_plan_route_run_stops(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

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
  v_route_plan_id uuid;
  v_locked_account_id uuid;
BEGIN
  SELECT account_id, route_plan_id INTO v_account_id, v_route_plan_id
  FROM public.plan_route_runs
  WHERE id = target_run_id;

  IF v_account_id IS NULL OR v_route_plan_id IS NULL OR auth.uid() IS NULL
     OR NOT public.user_has_account_access(v_account_id)
  THEN
    RAISE EXCEPTION 'Not authorized for this active route run';
  END IF;

  /* start/reset locks route -> run. Use that same order here so sync cannot
     deadlock it, and so the helper reads one committed route-plan version. */
  PERFORM 1
  FROM public.route_plans route_plan
  WHERE route_plan.id = v_route_plan_id
    AND route_plan.account_id = v_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active outing no longer has a saved route';
  END IF;

  SELECT account_id INTO v_locked_account_id
  FROM public.plan_route_runs
  WHERE id = target_run_id
    AND account_id = v_account_id
    AND route_plan_id = v_route_plan_id
    AND status = 'active'
  FOR UPDATE;

  IF v_locked_account_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized for this active route run';
  END IF;

  PERFORM public._sync_plan_route_run_stops(target_run_id, target_stops);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_plan_route_run_stops(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_plan_route_run_stops(uuid, jsonb)
  TO authenticated;
