/*
  # Durable, scoped route-status reset

  Generalizes the existing SPCC Plan outing tables to two route-status
  domains. Reset creates fresh pending runs only; it never mutates compliance,
  photos, schedules, route membership, assignments, or visibility settings.
*/

ALTER TABLE public.plan_route_runs
  DROP CONSTRAINT IF EXISTS plan_route_runs_survey_type_check;
ALTER TABLE public.plan_route_runs
  ADD CONSTRAINT plan_route_runs_survey_type_check
  CHECK (survey_type IN ('spcc_inspection', 'spcc_plan')) NOT VALID;
ALTER TABLE public.plan_route_runs
  VALIDATE CONSTRAINT plan_route_runs_survey_type_check;

DROP INDEX IF EXISTS public.idx_plan_route_runs_one_active_per_plan;
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_route_runs_one_active_per_scope
  ON public.plan_route_runs(account_id, route_plan_id, team_number, survey_type)
  WHERE status = 'active' AND route_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_route_runs_scope_lookup
  ON public.plan_route_runs(account_id, route_plan_id, team_number, survey_type, status);

ALTER TABLE public.plan_route_run_stops
  ADD COLUMN IF NOT EXISTS route_plan_id uuid REFERENCES public.route_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_number integer,
  ADD COLUMN IF NOT EXISTS survey_type text;

UPDATE public.plan_route_run_stops stop
SET route_plan_id = run.route_plan_id,
    team_number = run.team_number,
    survey_type = run.survey_type
FROM public.plan_route_runs run
WHERE run.id = stop.route_run_id
  AND (stop.route_plan_id IS DISTINCT FROM run.route_plan_id
    OR stop.team_number IS DISTINCT FROM run.team_number
    OR stop.survey_type IS DISTINCT FROM run.survey_type);

ALTER TABLE public.plan_route_run_stops
  DROP CONSTRAINT IF EXISTS plan_route_run_stops_team_check,
  DROP CONSTRAINT IF EXISTS plan_route_run_stops_survey_type_check;
ALTER TABLE public.plan_route_run_stops
  ADD CONSTRAINT plan_route_run_stops_team_check CHECK (team_number IS NULL OR team_number > 0),
  ADD CONSTRAINT plan_route_run_stops_survey_type_check
    CHECK (survey_type IS NULL OR survey_type IN ('spcc_inspection', 'spcc_plan'));
CREATE INDEX IF NOT EXISTS idx_plan_route_run_stops_scope_status
  ON public.plan_route_run_stops(account_id, route_plan_id, team_number, survey_type, route_run_id, status);

CREATE OR REPLACE FUNCTION public._enforce_route_status_stop_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.plan_route_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.plan_route_runs WHERE id = NEW.route_run_id;
  IF v_run.id IS NULL THEN RAISE EXCEPTION 'Route run not found'; END IF;
  NEW.account_id := v_run.account_id;
  NEW.route_plan_id := v_run.route_plan_id;
  NEW.team_number := v_run.team_number;
  NEW.survey_type := v_run.survey_type;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._enforce_route_status_stop_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_route_status_stop_scope ON public.plan_route_run_stops;
CREATE TRIGGER trg_enforce_route_status_stop_scope
  BEFORE INSERT OR UPDATE OF route_run_id ON public.plan_route_run_stops
  FOR EACH ROW EXECUTE FUNCTION public._enforce_route_status_stop_scope();

CREATE TABLE public.route_status_reset_requests (
  idempotency_key uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  route_plan_id uuid NOT NULL REFERENCES public.route_plans(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number > 0),
  requested_scope text NOT NULL CHECK (requested_scope IN ('spcc_inspection', 'spcc_plan', 'all')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_route_status_reset_requests_scope
  ON public.route_status_reset_requests(account_id, route_plan_id, team_number, created_at DESC);
ALTER TABLE public.route_status_reset_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.route_status_reset_requests FROM PUBLIC, anon, authenticated;

/* Private proof that a manual completion was committed by an authorized user.
   The compliance write and evidence insert are one transaction; route-stop
   completion is a separate idempotent action so compliance remains saved if
   the second step fails. */
CREATE TABLE public.inspection_route_completion_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('manual_internal', 'manual_external')),
  completed_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_inspection_route_completion_evidence_lookup
  ON public.inspection_route_completion_evidence(account_id, facility_id, recorded_at DESC);
ALTER TABLE public.inspection_route_completion_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inspection_route_completion_evidence FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_manual_inspection_completion(
  target_facility_id uuid,
  target_completion_type text,
  target_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_source text;
  v_evidence public.inspection_route_completion_evidence%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF target_completion_type NOT IN ('internal', 'external') THEN
    RAISE EXCEPTION 'Invalid manual completion type';
  END IF;
  IF target_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;
  SELECT * INTO v_facility FROM public.facilities
  WHERE id = target_facility_id FOR UPDATE;
  IF v_facility.id IS NULL OR v_facility.account_id IS NULL
    OR NOT public.user_has_account_access(v_facility.account_id)
  THEN RAISE EXCEPTION 'Not authorized for this facility'; END IF;
  v_source := CASE target_completion_type WHEN 'internal' THEN 'manual_internal' ELSE 'manual_external' END;

  SELECT * INTO v_evidence FROM public.inspection_route_completion_evidence
  WHERE idempotency_key = target_idempotency_key;
  IF v_evidence.id IS NOT NULL THEN
    IF v_evidence.account_id IS DISTINCT FROM v_facility.account_id
      OR v_evidence.facility_id IS DISTINCT FROM target_facility_id
      OR v_evidence.source IS DISTINCT FROM v_source
    THEN RAISE EXCEPTION 'Idempotency key is already used by another manual completion'; END IF;
    RETURN to_jsonb(v_evidence);
  END IF;

  UPDATE public.facilities
  SET spcc_completion_type = target_completion_type,
      spcc_inspection_date = current_date
  WHERE id = v_facility.id AND account_id = v_facility.account_id;
  INSERT INTO public.inspection_route_completion_evidence(
    idempotency_key, account_id, facility_id, source, completed_on, recorded_by
  ) VALUES(
    target_idempotency_key, v_facility.account_id, v_facility.id, v_source, current_date, auth.uid()
  ) RETURNING * INTO v_evidence;
  RETURN to_jsonb(v_evidence);
END;
$$;
REVOKE ALL ON FUNCTION public.record_manual_inspection_completion(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_inspection_completion(uuid, text, uuid) TO authenticated;

ALTER TABLE public.plan_route_stop_action_requests
  ADD COLUMN IF NOT EXISTS route_plan_id uuid REFERENCES public.route_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_number integer,
  ADD COLUMN IF NOT EXISTS survey_type text NOT NULL DEFAULT 'spcc_plan',
  ADD COLUMN IF NOT EXISTS action_kind text NOT NULL DEFAULT 'plan_photos',
  ADD COLUMN IF NOT EXISTS source_record_id uuid;
UPDATE public.plan_route_stop_action_requests request
SET route_plan_id = run.route_plan_id,
    team_number = run.team_number,
    survey_type = run.survey_type
FROM public.plan_route_runs run
WHERE run.id = request.route_run_id;
ALTER TABLE public.plan_route_stop_action_requests
  DROP CONSTRAINT IF EXISTS plan_route_stop_action_scope_check,
  DROP CONSTRAINT IF EXISTS plan_route_stop_action_kind_check;
ALTER TABLE public.plan_route_stop_action_requests
  ADD CONSTRAINT plan_route_stop_action_scope_check CHECK (survey_type IN ('spcc_inspection', 'spcc_plan')),
  ADD CONSTRAINT plan_route_stop_action_kind_check CHECK (action_kind IN ('plan_photos', 'inspection_complete'));
COMMENT ON TABLE public.plan_route_stop_action_requests IS
  'Private idempotency journal for route-status stop actions in both SPCC domains.';

REVOKE INSERT, UPDATE, DELETE ON public.plan_route_runs, public.plan_route_run_stops FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plan_route_runs, public.plan_route_run_stops TO authenticated;

CREATE OR REPLACE FUNCTION public._sync_plan_route_run_stops(target_run_id uuid, target_stops jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.plan_route_runs%ROWTYPE;
  v_plan_data jsonb;
  v_stop record;
BEGIN
  SELECT * INTO v_run FROM public.plan_route_runs WHERE id = target_run_id;
  IF v_run.id IS NULL THEN RAISE EXCEPTION 'Route run not found'; END IF;

  SELECT plan_data INTO v_plan_data
  FROM public.route_plans
  WHERE id = v_run.route_plan_id AND account_id = v_run.account_id;
  IF v_plan_data IS NULL THEN RAISE EXCEPTION 'The active route status no longer has a saved route'; END IF;

  FOR v_stop IN
    SELECT assignment.*
    FROM jsonb_to_recordset(public._route_plan_assignments_from_data(v_run.account_id, v_plan_data))
      AS assignment(facility_id uuid, facility_name text, day_assignment integer,
        planned_day integer, team_assignment integer, planned_position integer)
    WHERE assignment.team_assignment = v_run.team_number
  LOOP
    INSERT INTO public.plan_route_run_stops(
      account_id, route_run_id, route_plan_id, team_number, survey_type,
      facility_id, facility_name_snapshot, planned_day, planned_position, status, removed_at
    ) VALUES (
      v_run.account_id, v_run.id, v_run.route_plan_id, v_run.team_number, v_run.survey_type,
      v_stop.facility_id, v_stop.facility_name, v_stop.planned_day, v_stop.planned_position, 'pending', NULL
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
  SET status = CASE WHEN existing.status = 'completed' THEN 'completed' ELSE 'removed' END,
      removed_at = COALESCE(existing.removed_at, now()), updated_at = now()
  WHERE existing.route_run_id = v_run.id
    AND existing.facility_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(public._route_plan_assignments_from_data(v_run.account_id, v_plan_data))
        AS assignment(facility_id uuid, facility_name text, day_assignment integer,
          planned_day integer, team_assignment integer, planned_position integer)
      WHERE assignment.team_assignment = v_run.team_number
        AND assignment.facility_id = existing.facility_id
    );
END;
$$;
REVOKE ALL ON FUNCTION public._sync_plan_route_run_stops(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_plan_route_run(
  target_account_id uuid, target_route_plan_id uuid, target_team_number integer,
  target_stops jsonb, force_new boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_run_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_account_access(target_account_id) THEN
    RAISE EXCEPTION 'Not authorized for this account';
  END IF;
  PERFORM 1 FROM public.route_plans
  WHERE id = target_route_plan_id AND account_id = target_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route plan not found for this account'; END IF;

  IF force_new THEN
    UPDATE public.plan_route_runs current_run
    SET status = CASE WHEN EXISTS (
      SELECT 1 FROM public.plan_route_run_stops stop
      WHERE stop.route_run_id = current_run.id AND stop.removed_at IS NULL AND stop.status <> 'completed'
    ) THEN 'abandoned' ELSE 'completed' END,
    ended_at = now(), ended_by = auth.uid()
    WHERE account_id = target_account_id AND route_plan_id = target_route_plan_id
      AND team_number = COALESCE(target_team_number, 1) AND survey_type = 'spcc_plan' AND status = 'active';
  ELSE
    SELECT id INTO v_run_id FROM public.plan_route_runs
    WHERE account_id = target_account_id AND route_plan_id = target_route_plan_id
      AND team_number = COALESCE(target_team_number, 1) AND survey_type = 'spcc_plan' AND status = 'active'
    ORDER BY started_at DESC LIMIT 1;
  END IF;
  IF v_run_id IS NULL THEN
    INSERT INTO public.plan_route_runs(account_id, route_plan_id, survey_type, team_number, status, started_by)
    VALUES(target_account_id, target_route_plan_id, 'spcc_plan', COALESCE(target_team_number, 1), 'active', auth.uid())
    RETURNING id INTO v_run_id;
  END IF;
  PERFORM public._sync_plan_route_run_stops(v_run_id, target_stops);
  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_plan_route_run_stops(target_run_id uuid, target_stops jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_run public.plan_route_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active' AND survey_type = 'spcc_plan';
  IF v_run.id IS NULL OR auth.uid() IS NULL OR NOT public.user_has_account_access(v_run.account_id) THEN
    RAISE EXCEPTION 'Not authorized for this SPCC Plan route run';
  END IF;
  PERFORM 1 FROM public.route_plans WHERE id = v_run.route_plan_id AND account_id = v_run.account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route plan not found for this account'; END IF;
  PERFORM public._sync_plan_route_run_stops(target_run_id, target_stops);
END;
$$;

/* Generalized post-migration synchronization. Membership and team assignment
   are always re-derived from the locked saved route; no client stop list is
   accepted. Completed rows remain historical, removed rows are marked, and
   newly added route facilities become pending stops in every initialized
   domain. */
CREATE FUNCTION public.sync_route_status_run_stops(target_run_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_run public.plan_route_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active'
    AND survey_type IN ('spcc_inspection', 'spcc_plan');
  IF v_run.id IS NULL OR auth.uid() IS NULL OR NOT public.user_has_account_access(v_run.account_id) THEN
    RAISE EXCEPTION 'Not authorized for this route status run';
  END IF;
  PERFORM 1 FROM public.route_plans
  WHERE id = v_run.route_plan_id AND account_id = v_run.account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route plan not found for this account'; END IF;
  PERFORM public._sync_plan_route_run_stops(v_run.id, '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_route_status_run_stops(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_route_status_run_stops(uuid) TO authenticated;

/* Preserve the mature photo/history implementation behind a Plan-only guard. */
ALTER FUNCTION public.set_plan_route_stop_photos(uuid, uuid, boolean, timestamptz, text, uuid)
  RENAME TO _set_plan_route_stop_photos_legacy;
REVOKE ALL ON FUNCTION public._set_plan_route_stop_photos_legacy(uuid, uuid, boolean, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.set_plan_route_stop_photos(
  target_run_id uuid, target_facility_id uuid, target_completed boolean,
  target_occurred_at timestamptz DEFAULT now(), target_source text DEFAULT 'route_planning',
  target_idempotency_key uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.plan_route_runs%ROWTYPE;
  v_response jsonb;
BEGIN
  SELECT * INTO v_run FROM public.plan_route_runs run
  WHERE run.id = target_run_id AND run.status = 'active' AND run.survey_type = 'spcc_plan';
  IF v_run.id IS NULL OR auth.uid() IS NULL OR NOT public.user_has_account_access(v_run.account_id)
  THEN RAISE EXCEPTION 'Not authorized for this SPCC Plan route run'; END IF;
  v_response := public._set_plan_route_stop_photos_legacy(
    target_run_id, target_facility_id, target_completed, target_occurred_at,
    target_source, target_idempotency_key
  );
  UPDATE public.plan_route_stop_action_requests
  SET route_plan_id = v_run.route_plan_id,
      team_number = v_run.team_number,
      survey_type = v_run.survey_type,
      action_kind = 'plan_photos'
  WHERE idempotency_key = target_idempotency_key
    AND route_run_id = v_run.id
    AND facility_id = target_facility_id;
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.set_plan_route_stop_photos(uuid, uuid, boolean, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_plan_route_stop_photos(uuid, uuid, boolean, timestamptz, text, uuid) TO authenticated;

CREATE FUNCTION public.reset_route_status(
  target_account_id uuid, target_route_plan_id uuid, target_team_number integer,
  target_scope text, target_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_data jsonb;
  v_existing public.route_status_reset_requests%ROWTYPE;
  v_domain text;
  v_domains text[];
  v_run public.plan_route_runs%ROWTYPE;
  v_stops jsonb;
  v_runs jsonb := '[]'::jsonb;
  v_response jsonb;
  v_unique integer;
  v_domain_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF target_team_number IS NULL OR target_team_number < 1 THEN RAISE EXCEPTION 'Invalid team number'; END IF;
  IF target_scope NOT IN ('spcc_inspection', 'spcc_plan', 'all') THEN RAISE EXCEPTION 'Invalid route status scope'; END IF;
  IF target_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;
  IF NOT public.user_has_account_access(target_account_id) THEN RAISE EXCEPTION 'Not authorized for this account'; END IF;

  SELECT plan_data INTO v_plan_data FROM public.route_plans
  WHERE id = target_route_plan_id AND account_id = target_account_id FOR UPDATE;
  IF v_plan_data IS NULL THEN RAISE EXCEPTION 'Route plan not found for this account'; END IF;

  SELECT * INTO v_existing FROM public.route_status_reset_requests WHERE idempotency_key = target_idempotency_key;
  IF v_existing.idempotency_key IS NOT NULL THEN
    IF v_existing.account_id IS DISTINCT FROM target_account_id
      OR v_existing.route_plan_id IS DISTINCT FROM target_route_plan_id
      OR v_existing.team_number IS DISTINCT FROM target_team_number
      OR v_existing.requested_scope IS DISTINCT FROM target_scope
    THEN RAISE EXCEPTION 'Idempotency key is already used for another route status reset'; END IF;
    RETURN v_existing.response;
  END IF;

  v_domains := CASE WHEN target_scope = 'all'
    THEN ARRAY['spcc_inspection', 'spcc_plan']::text[] ELSE ARRAY[target_scope]::text[] END;

  FOREACH v_domain IN ARRAY v_domains LOOP
    UPDATE public.plan_route_runs current_run
    SET status = CASE WHEN EXISTS (
      SELECT 1 FROM public.plan_route_run_stops stop
      WHERE stop.route_run_id = current_run.id AND stop.removed_at IS NULL AND stop.status <> 'completed'
    ) THEN 'abandoned' ELSE 'completed' END,
    ended_at = now(), ended_by = auth.uid()
    WHERE current_run.account_id = target_account_id
      AND current_run.route_plan_id = target_route_plan_id
      AND current_run.team_number = target_team_number
      AND current_run.survey_type = v_domain
      AND current_run.status = 'active';

    INSERT INTO public.plan_route_runs(account_id, route_plan_id, survey_type, team_number, status, started_by)
    VALUES(target_account_id, target_route_plan_id, v_domain, target_team_number, 'active', auth.uid())
    RETURNING * INTO v_run;
    PERFORM public._sync_plan_route_run_stops(v_run.id, '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(to_jsonb(stop) ORDER BY stop.planned_day, stop.planned_position), '[]'::jsonb), COUNT(*)::integer
    INTO v_stops, v_domain_count
    FROM public.plan_route_run_stops stop
    WHERE stop.route_run_id = v_run.id AND stop.removed_at IS NULL AND stop.status <> 'removed';
    v_runs := v_runs || jsonb_build_array(jsonb_build_object(
      'survey_type', v_domain, 'run', to_jsonb(v_run), 'stops', v_stops
    ));
  END LOOP;

  SELECT COUNT(DISTINCT assignment.facility_id)::integer INTO v_unique
  FROM jsonb_to_recordset(public._route_plan_assignments_from_data(target_account_id, v_plan_data))
    AS assignment(facility_id uuid, facility_name text, day_assignment integer,
      planned_day integer, team_assignment integer, planned_position integer)
  WHERE assignment.team_assignment = target_team_number;

  SELECT COUNT(*)::integer INTO v_domain_count
  FROM public.plan_route_run_stops stop
  JOIN public.plan_route_runs run ON run.id = stop.route_run_id
  WHERE run.id IN (
    SELECT (item.value->'run'->>'id')::uuid
    FROM jsonb_array_elements(v_runs) AS item(value)
  )
    AND stop.removed_at IS NULL AND stop.status <> 'removed';

  v_response := jsonb_build_object(
    'account_id', target_account_id, 'route_plan_id', target_route_plan_id,
    'team_number', target_team_number, 'requested_scope', target_scope,
    'runs', v_runs, 'unique_facility_count', COALESCE(v_unique, 0),
    'domain_stop_count', COALESCE(v_domain_count, 0)
  );
  INSERT INTO public.route_status_reset_requests(
    idempotency_key, account_id, route_plan_id, team_number, requested_scope, requested_by, response
  ) VALUES(target_idempotency_key, target_account_id, target_route_plan_id, target_team_number, target_scope, auth.uid(), v_response);
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_route_status(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_route_status(uuid, uuid, integer, text, uuid) TO authenticated;

CREATE FUNCTION public.complete_inspection_route_stop(
  target_run_id uuid, target_facility_id uuid, target_source text,
  target_source_record_id uuid, target_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.plan_route_runs%ROWTYPE;
  v_stop public.plan_route_run_stops%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_inspection public.inspections%ROWTYPE;
  v_evidence public.inspection_route_completion_evidence%ROWTYPE;
  v_request public.plan_route_stop_action_requests%ROWTYPE;
  v_response jsonb;
BEGIN
  IF target_source NOT IN ('inspection', 'manual_internal', 'manual_external') THEN
    RAISE EXCEPTION 'Invalid inspection completion source';
  END IF;
  SELECT * INTO v_run FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active' AND survey_type = 'spcc_inspection' FOR UPDATE;
  IF v_run.id IS NULL OR auth.uid() IS NULL OR NOT public.user_has_account_access(v_run.account_id) THEN
    RAISE EXCEPTION 'Not authorized for this SPCC Inspection route run';
  END IF;
  SELECT * INTO v_stop FROM public.plan_route_run_stops
  WHERE route_run_id = v_run.id AND facility_id = target_facility_id
    AND removed_at IS NULL AND status <> 'removed' FOR UPDATE;
  SELECT * INTO v_facility FROM public.facilities
  WHERE id = target_facility_id AND account_id = v_run.account_id;
  IF v_stop.id IS NULL OR v_facility.id IS NULL
    OR v_stop.account_id IS DISTINCT FROM v_run.account_id
    OR v_stop.route_plan_id IS DISTINCT FROM v_run.route_plan_id
    OR v_stop.team_number IS DISTINCT FROM v_run.team_number
    OR v_stop.survey_type IS DISTINCT FROM v_run.survey_type
  THEN RAISE EXCEPTION 'Facility is not an active stop on this inspection route run'; END IF;

  IF target_source = 'inspection' THEN
    SELECT * INTO v_inspection FROM public.inspections inspection
    WHERE inspection.id = target_source_record_id
      AND inspection.facility_id = target_facility_id
      AND inspection.account_id = v_run.account_id
      AND inspection.status = 'completed';
    IF v_inspection.id IS NULL THEN
      RAISE EXCEPTION 'Completed inspection not found for this route stop';
    END IF;
    IF v_inspection.updated_at IS NULL OR v_inspection.updated_at < v_run.started_at THEN
      RAISE EXCEPTION 'Inspection completion predates the active route status run';
    END IF;
    IF v_inspection.conducted_at IS NULL
      OR v_inspection.conducted_at + INTERVAL '1 year' <= now() + INTERVAL '60 days'
    THEN
      RAISE EXCEPTION 'Inspection evidence is expired or within the 60-day warning window';
    END IF;
  ELSE
    SELECT * INTO v_evidence FROM public.inspection_route_completion_evidence evidence
    WHERE evidence.id = target_source_record_id
      AND evidence.account_id = v_run.account_id
      AND evidence.facility_id = target_facility_id
      AND evidence.source = target_source;
    IF v_evidence.id IS NULL THEN
      RAISE EXCEPTION 'Manual completion evidence not found for this route stop';
    END IF;
    IF v_evidence.recorded_at < v_run.started_at THEN
      RAISE EXCEPTION 'Manual completion evidence predates the active route status run';
    END IF;
    IF v_evidence.completed_on + INTERVAL '1 year' <= current_date + INTERVAL '60 days' THEN
      RAISE EXCEPTION 'Manual completion evidence is expired or within the 60-day warning window';
    END IF;
    IF (target_source = 'manual_internal' AND v_facility.spcc_completion_type IS DISTINCT FROM 'internal')
      OR (target_source = 'manual_external' AND v_facility.spcc_completion_type IS DISTINCT FROM 'external')
      OR v_facility.spcc_inspection_date IS DISTINCT FROM v_evidence.completed_on
    THEN RAISE EXCEPTION 'Manual completion evidence no longer matches the facility'; END IF;
  END IF;

  SELECT * INTO v_request FROM public.plan_route_stop_action_requests WHERE idempotency_key = target_idempotency_key;
  IF v_request.idempotency_key IS NOT NULL THEN
    IF v_request.account_id IS DISTINCT FROM v_run.account_id
      OR v_request.route_run_id IS DISTINCT FROM v_run.id
      OR v_request.facility_id IS DISTINCT FROM target_facility_id
      OR v_request.action_kind IS DISTINCT FROM 'inspection_complete'
      OR v_request.source_record_id IS DISTINCT FROM target_source_record_id
    THEN RAISE EXCEPTION 'Idempotency key is already used by another route stop action'; END IF;
    RETURN v_request.response;
  END IF;

  UPDATE public.plan_route_run_stops SET status = 'completed', completed_at = now(),
    completed_by = auth.uid(), updated_at = now() WHERE id = v_stop.id RETURNING * INTO v_stop;
  v_response := jsonb_build_object('run_id', v_run.id, 'stop_id', v_stop.id,
    'facility_id', target_facility_id, 'status', v_stop.status, 'completed_at', v_stop.completed_at);
  INSERT INTO public.plan_route_stop_action_requests(
    idempotency_key, account_id, route_run_id, route_plan_id, team_number, survey_type,
    facility_id, requested_completed, action_kind, source_record_id, response
  ) VALUES(target_idempotency_key, v_run.account_id, v_run.id, v_run.route_plan_id,
    v_run.team_number, v_run.survey_type, target_facility_id, true,
    'inspection_complete', target_source_record_id, v_response);
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_inspection_route_stop(uuid, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_inspection_route_stop(uuid, uuid, text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.start_plan_route_run(uuid, uuid, integer, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_plan_route_run(uuid, uuid, integer, jsonb, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_plan_route_run_stops(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_plan_route_run_stops(uuid, jsonb) TO authenticated;
