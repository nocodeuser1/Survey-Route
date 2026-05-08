/*
  # Fix: agency-owner branch of user_signatures DELETE policy was 403'ing

  ## Problem
  The previous migration (20260429120000) referenced `auth.users` directly
  in the agency-owner check:

      JOIN auth.users au ON au.email = ag.owner_email
      WHERE au.id = (SELECT auth.uid())

  The `authenticated` role doesn't have SELECT on `auth.users`, so policy
  evaluation 403'd with `permission denied for table users` (Postgres
  error 42501) — even for users who would have qualified via the other
  OR branches, because the EXISTS subquery errored before short-circuit
  could help.

  ## Solution
  Swap `auth.users` for `public.users`. Every authenticated user has a
  mirror row in `public.users` (via auth_user_id), and the existing RLS
  on `public.users` lets them see their own row — which is all this
  branch needs to verify ownership.

  ## Idempotent
  Drops and recreates the policy. Safe to re-run.
*/

DROP POLICY IF EXISTS "Users can delete own signature" ON public.user_signatures;
DROP POLICY IF EXISTS "Allow signature deletion" ON public.user_signatures;
DROP POLICY IF EXISTS "Agency owners and admins can delete team signatures" ON public.user_signatures;

CREATE POLICY "Agency owners and admins can delete team signatures"
  ON public.user_signatures
  FOR DELETE
  TO authenticated
  USING (
    -- Same account scope check as before — admins can't cross accounts.
    user_has_account_access(account_id)
    AND (
      -- Branch 1: the user is deleting their own signature.
      user_id IN (
        SELECT id FROM public.users WHERE auth_user_id = (SELECT auth.uid())
      )
      -- Branch 2: the caller is an account admin on this account.
      OR is_account_admin(account_id)
      -- Branch 3: the caller is the agency owner of the agency that
      -- owns this account. Joins through public.users (which the
      -- authenticated role can read its own row of) instead of
      -- auth.users (which is restricted).
      OR EXISTS (
        SELECT 1
        FROM public.accounts a
        JOIN public.agencies ag ON ag.id = a.agency_id
        JOIN public.users u ON u.email = ag.owner_email
        WHERE a.id = user_signatures.account_id
          AND u.auth_user_id = (SELECT auth.uid())
      )
    )
  );
