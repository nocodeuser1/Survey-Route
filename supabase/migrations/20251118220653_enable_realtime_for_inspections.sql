/*
  # Enable Realtime for Inspections Table

  1. Changes
    - Enable realtime replication for the `inspections` table
    - This allows the frontend to receive instant updates when inspections are created, updated, or deleted

  2. Notes
    - Realtime subscriptions are filtered by account_id on the client side for security
    - RLS policies still apply to realtime events
*/

-- Enable realtime for inspections table
ALTER PUBLICATION supabase_realtime ADD TABLE inspections;
