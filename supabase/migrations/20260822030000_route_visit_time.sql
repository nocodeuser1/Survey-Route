/* Add editable, five-minute-granularity visit times. */

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS field_visit_time time;

DROP POLICY IF EXISTS "Users can update route visit events" ON public.route_visit_events;
CREATE POLICY "Users can update route visit events"
  ON public.route_visit_events FOR UPDATE TO authenticated
  USING (public.user_has_account_access(account_id))
  WITH CHECK (public.user_has_account_access(account_id));

CREATE OR REPLACE FUNCTION public.record_route_visit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rounded_visit_at timestamptz;
BEGIN
  IF NEW.photos_taken IS TRUE AND COALESCE(OLD.photos_taken, FALSE) IS FALSE THEN
    rounded_visit_at := date_trunc('minute', now())
      + make_interval(mins => (round(extract(minute FROM now()) / 5.0) * 5)::integer);

    INSERT INTO public.route_visit_events (facility_id, account_id, recorded_by, visited_at)
    VALUES (NEW.id, NEW.account_id, auth.uid(), rounded_visit_at);

    IF NEW.field_visit_date IS NULL OR NEW.field_visit_time IS NULL THEN
      UPDATE public.facilities
      SET field_visit_date = rounded_visit_at::date,
          field_visit_time = rounded_visit_at::time
      WHERE id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
