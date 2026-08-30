/*
  Keep the Facilities "Latest Photos Date" column current when an administrator
  adds, corrects, removes, or restores a photo-history record from any tab.
*/

DO $realtime$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'photo_visit_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_visit_events;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'photo_visit_event_revisions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_visit_event_revisions;
  END IF;
END;
$realtime$;
