/*
  # Allow agency owners + account admins to delete team signatures

  ## Problem
  The existing DELETE policy on `user_signatures` only allows a user to
  delete their OWN signature:

      USING (user_owns_signature(user_id) AND user_has_account_access(account_id))

  This silently rejects agency owners and account admins trying to delete
  someone else's signature — Postgres RLS returns 0 rows affected with no
  error, so the UI showed a fake success while the row stayed in place.

  ## Solution
  Replace the policy with one that allows delete when ANY of the
  following is true:
    1. The caller owns the signature (existing behavior).
    2. The caller is an agency owner of the agency that owns this account.
    3. The caller is an account_admin on this account.

  ## Security
  - Account access is verified by `user_has_account_access(account_id)`
    in every branch — admins can't reach across accounts.
  - `is_account_admin(check_account_id)` is SECURITY DEFINER so we don't
    re-trigger RLS on `account_users`.
  - Agency-owner branch is scoped to the agency that owns the
    signature's account, so an agency owner can only delete signatures
    in agencies they actually own.

  ## Idempotent
  - Drops and recreates the policy. Safe to re-run.
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
      -- owns this account.
      OR EXISTS (
        SELECT 1
        FROM public.accounts a
        JOIN public.agencies ag ON ag.id = a.agency_id
        JOIN auth.users au ON au.email = ag.owner_email
        WHERE a.id = user_signatures.account_id
          AND au.id = (SELECT auth.uid())
      )
    )
  );
