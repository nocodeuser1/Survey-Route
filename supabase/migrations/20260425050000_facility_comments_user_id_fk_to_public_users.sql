/*
  # facility_comments.user_id → reference public.users (not auth.users)

  The original facility_comments migration (2026-04-15) declared:

      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE

  ...so the FK expects user_id to be an auth.users.id (= auth.uid()). But
  the RLS fix (2026-04-17) and the agency-owner extension (this branch)
  both expect user_id to be a public.users.id whose `auth_user_id` matches
  auth.uid():

      (SELECT auth_user_id FROM users WHERE id = user_id) = auth.uid()

  These two are mutually exclusive. With the FK pointed at auth.users, no
  client value can satisfy both:
    - user_id = auth.uid()       → FK passes, RLS fails (no public.users row with that id)
    - user_id = public.users.id  → RLS passes, FK fails (auth.users has no row with that id)

  The user-facing symptom: after the RLS rewrite, every Add Comment hits
  "insert or update on table 'facility_comments' violates foreign key
  constraint 'facility_comments_user_id_fkey'".

  Fix: re-point the FK at `public.users(id)`, matching every other table
  in this multi-tenant codebase (account_users.user_id, accounts.created_by,
  invitations.invited_by, etc. all reference public.users).

  Backfill: any existing comments inserted under the old FK would have
  user_id = auth.uid(). Map those to the corresponding public.users.id
  before swapping the constraint, so we don't strand old rows.

  Idempotent — re-running on a table that's already pointed at public.users
  is a no-op (the UPDATE matches nothing, the DROP IF EXISTS skips, the
  ADD CONSTRAINT … if not exists pattern handled by checking pg_constraint).
*/

-- 1. Migrate any existing rows whose user_id is an auth.users.id over to
--    the corresponding public.users.id. After this runs, every row's
--    user_id is a public.users.id (or invalid, but `users.auth_user_id`
--    is unique so the join is safe).
UPDATE public.facility_comments fc
SET user_id = u.id
FROM public.users u
WHERE u.auth_user_id = fc.user_id
  AND fc.user_id <> u.id;

-- 2. Drop the old FK that targeted auth.users.
ALTER TABLE public.facility_comments
  DROP CONSTRAINT IF EXISTS facility_comments_user_id_fkey;

-- 3. Add the FK pointing at public.users so it lines up with the RLS
--    policy and the rest of the multi-tenant schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'facility_comments_user_id_fkey'
      AND conrelid = 'public.facility_comments'::regclass
  ) THEN
    ALTER TABLE public.facility_comments
      ADD CONSTRAINT facility_comments_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;
