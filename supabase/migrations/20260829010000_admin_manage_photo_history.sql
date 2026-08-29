/*
  # Account-admin photo history management

  Administrators need to correct the photo history without defeating the
  ledger's audit purpose. Base photo_visit_events therefore remain immutable.
  Adds create a normal event, edits append a revision, and deletes append a
  tombstone. The original event and every prior value remain recoverable.
*/

CREATE TABLE IF NOT EXISTS public.photo_visit_event_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.photo_visit_events(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('edit', 'delete')),
  occurred_at timestamptz,
  occurred_on date,
  occurred_time time,
  reason text,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_visit_event_revisions_event_changed
  ON public.photo_visit_event_revisions(event_id, changed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photo_visit_event_revisions_account_changed
  ON public.photo_visit_event_revisions(account_id, changed_at DESC);

ALTER TABLE public.photo_visit_event_revisions ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.photo_visit_event_revisions
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.photo_visit_event_revisions TO authenticated;

DROP POLICY IF EXISTS "Users can view photo visit event revisions"
  ON public.photo_visit_event_revisions;
CREATE POLICY "Users can view photo visit event revisions"
  ON public.photo_visit_event_revisions FOR SELECT TO authenticated
  USING (public.user_has_account_access(account_id));

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

  SELECT COALESCE(NULLIF(timezone, ''), 'America/Chicago')
  INTO v_timezone
  FROM public.accounts
  WHERE id = target_account_id;

  IF target_occurred_time IS NOT NULL THEN
    v_occurred_at :=
      (target_occurred_on::timestamp + target_occurred_time) AT TIME ZONE v_timezone;
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

  SELECT * INTO v_event
  FROM public.photo_visit_events
  WHERE id = target_event_id;

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

  SELECT * INTO v_event
  FROM public.photo_visit_events
  WHERE id = target_event_id;

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

COMMENT ON TABLE public.photo_visit_event_revisions IS
  'Append-only admin corrections and tombstones for photo history. Base events are never updated or deleted.';
