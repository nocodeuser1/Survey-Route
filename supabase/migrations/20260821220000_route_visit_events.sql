/* Record the actual order in which field visits are completed. */

CREATE TABLE IF NOT EXISTS public.route_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  visited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_visit_events_account_visited
  ON public.route_visit_events(account_id, visited_at);

CREATE INDEX IF NOT EXISTS idx_route_visit_events_facility_visited
  ON public.route_visit_events(facility_id, visited_at);

ALTER TABLE public.route_visit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view route visit events" ON public.route_visit_events;
CREATE POLICY "Users can view route visit events"
  ON public.route_visit_events FOR SELECT TO authenticated
  USING (public.user_has_account_access(account_id));

CREATE OR REPLACE FUNCTION public.record_route_visit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.photos_taken IS TRUE AND COALESCE(OLD.photos_taken, FALSE) IS FALSE THEN
    INSERT INTO public.route_visit_events (facility_id, account_id, recorded_by)
    VALUES (NEW.id, NEW.account_id, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS facilities_record_route_visit_event ON public.facilities;
CREATE TRIGGER facilities_record_route_visit_event
  AFTER UPDATE OF photos_taken ON public.facilities
  FOR EACH ROW
  WHEN (NEW.photos_taken IS TRUE AND COALESCE(OLD.photos_taken, FALSE) IS FALSE)
  EXECUTE FUNCTION public.record_route_visit_event();

