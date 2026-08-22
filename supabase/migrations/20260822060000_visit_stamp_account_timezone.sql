/*
  # Stamp visit date/time in the account's timezone

  Two bugs in record_route_visit_event(), both visible as a visit recorded at
  11:01 PM Central showing up as 4:01 AM the next day:

  1. `rounded_visit_at::date` / `::time` cast a timestamptz using the Postgres
     session timezone, which is UTC on Supabase. So the bare date/time columns
     — which carry no zone of their own — were filled with UTC wall-clock
     while route_visit_events.visited_at (a real timestamptz) stayed correct.
     The two then disagreed by the UTC offset. Now the cast goes through
     `AT TIME ZONE <account timezone>`, using the zone already configurable on
     the Account Branding screen and defaulting to Central.

  2. The five-minute rounding started from `date_trunc('minute', now())` and
     then ADDED the rounded minutes, instead of starting from the top of the
     hour and replacing them. At 9:04 that produced 9:09 rather than 9:05, and
     at 9:58 it produced 10:58. Fixed to date_trunc('hour', ...).

  Also backfills rows the old trigger stamped. Only rows that provably came
  from it are touched: those whose field_visit_date/time exactly equal the UTC
  wall-clock of one of the facility's own visit events. Hand-typed dates never
  match that and are left alone.
*/

CREATE OR REPLACE FUNCTION public.record_route_visit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rounded_visit_at timestamptz;
  account_tz text;
  local_visit timestamp;
BEGIN
  IF NEW.photos_taken IS TRUE AND COALESCE(OLD.photos_taken, FALSE) IS FALSE THEN
    -- Top of the hour plus the rounded minutes. Starting from the truncated
    -- MINUTE and adding would double-count the minutes already elapsed.
    rounded_visit_at := date_trunc('hour', now())
      + make_interval(mins => (round(extract(minute FROM now()) / 5.0) * 5)::integer);

    INSERT INTO public.route_visit_events (facility_id, account_id, recorded_by, visited_at)
    VALUES (NEW.id, NEW.account_id, auth.uid(), rounded_visit_at);

    IF NEW.field_visit_date IS NULL OR NEW.field_visit_time IS NULL THEN
      SELECT COALESCE(NULLIF(a.timezone, ''), 'America/Chicago')
        INTO account_tz
        FROM public.accounts a
       WHERE a.id = NEW.account_id;

      -- No account row, or no zone set: the business runs on Central.
      local_visit := rounded_visit_at AT TIME ZONE COALESCE(account_tz, 'America/Chicago');

      UPDATE public.facilities
      SET field_visit_date = local_visit::date,
          field_visit_time = local_visit::time
      WHERE id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill: rewrite only the stamps that match a visit event's UTC wall-clock.
WITH stamped AS (
  SELECT DISTINCT ON (f.id)
         f.id AS facility_id,
         e.visited_at,
         COALESCE(NULLIF(a.timezone, ''), 'America/Chicago') AS tz
    FROM public.facilities f
    JOIN public.accounts a ON a.id = f.account_id
    JOIN public.route_visit_events e ON e.facility_id = f.id
   WHERE f.field_visit_date IS NOT NULL
     AND f.field_visit_time IS NOT NULL
     AND (e.visited_at AT TIME ZONE 'UTC')::date = f.field_visit_date
     AND (e.visited_at AT TIME ZONE 'UTC')::time = f.field_visit_time
   ORDER BY f.id, e.visited_at DESC
)
UPDATE public.facilities f
   SET field_visit_date = (s.visited_at AT TIME ZONE s.tz)::date,
       field_visit_time = (s.visited_at AT TIME ZONE s.tz)::time
  FROM stamped s
 WHERE f.id = s.facility_id
   AND (
     f.field_visit_date IS DISTINCT FROM (s.visited_at AT TIME ZONE s.tz)::date
     OR f.field_visit_time IS DISTINCT FROM (s.visited_at AT TIME ZONE s.tz)::time
   );

COMMENT ON COLUMN public.facilities.field_visit_time IS
  'Wall-clock time of the field visit in the ACCOUNT''s timezone (accounts.timezone, default America/Chicago). Pairs with field_visit_date; the zone-aware instant lives in route_visit_events.visited_at.';
