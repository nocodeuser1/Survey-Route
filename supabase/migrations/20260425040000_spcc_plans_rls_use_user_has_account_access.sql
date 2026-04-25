/*
  # spcc_plans RLS — use user_has_account_access helper

  When I created spcc_plans (20260423000000), I hand-rolled four RLS
  policies that gated everything through `account_users` membership.
  That's the same mistake as the original facility_comments policies —
  agency owners aren't in `account_users` for their own accounts, so
  every INSERT / UPDATE / DELETE from the bulk SPCC upload (and the
  per-berm InlineSPCCPlanUpload) returns:

      new row violates row-level security policy for table "spcc_plans"

  Repro: agency owner runs the Bulk SPCC Plan Import flow → 0 plans
  uploaded, "106 errors" with the message above for every file.

  The repo already has a `user_has_account_access(account_id)`
  SECURITY DEFINER helper (added 2025-11-05 to fix accounts-RLS
  recursion). It returns TRUE when:
    - the current user is the owner_email of the agency that owns the
      account, OR
    - the current user is in account_users for the account.

  Both conditions cover the agency-owner case. Switching the spcc_plans
  policies to use this helper fixes the bulk-upload failure AND keeps
  the policy file consistent with how facilities, home_base, route_plans,
  user_settings, etc. already do their access checks.

  Idempotent — DROP POLICY IF EXISTS / CREATE POLICY pattern.
*/

-- SELECT
DROP POLICY IF EXISTS "Users can view spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can view spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND public.user_has_account_access(f.account_id)
    )
  );

-- INSERT
DROP POLICY IF EXISTS "Users can insert spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can insert spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND public.user_has_account_access(f.account_id)
    )
  );

-- UPDATE
DROP POLICY IF EXISTS "Users can update spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can update spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND public.user_has_account_access(f.account_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND public.user_has_account_access(f.account_id)
    )
  );

-- DELETE
DROP POLICY IF EXISTS "Users can delete spcc plans for accessible facilities" ON public.spcc_plans;
CREATE POLICY "Users can delete spcc plans for accessible facilities"
  ON public.spcc_plans
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = spcc_plans.facility_id
        AND public.user_has_account_access(f.account_id)
    )
  );
