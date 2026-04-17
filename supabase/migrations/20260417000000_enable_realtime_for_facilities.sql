-- Enable Supabase Realtime for the facilities table so that INSERT, UPDATE,
-- and DELETE events are broadcast to all subscribed clients in the same account.
-- This allows multiple users/devices to see changes without a manual refresh.

-- Ensure DELETE payloads carry the old row's id (required for client-side removal).
ALTER TABLE public.facilities REPLICA IDENTITY FULL;

-- Add the table to the realtime publication (no-op if already present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'facilities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.facilities;
  END IF;
END
$$;
