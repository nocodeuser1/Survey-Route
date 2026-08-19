-- Allow agency owners and co-owners to seed/manage survey types for accounts
-- in their agency.
--
-- Account creation runs the seed_default_survey_types() trigger immediately
-- after inserting the account. At that point the agency admin has access to
-- the account through accounts.agency_id, but may not have an account_users
-- row for the brand-new account yet. The old survey_types INSERT policy only
-- checked account_users, so the account insert succeeded and the trigger then
-- failed with:
--   new row violates row-level security policy for table "survey_types"

CREATE OR REPLACE FUNCTION public.can_manage_account(check_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.is_account_admin(check_account_id) OR EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = check_account_id
      AND public._is_agency_admin(a.agency_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_account(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_has_account_access(account_id_param uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = account_id_param
      AND public._is_agency_admin(a.agency_id)
  ) OR EXISTS (
    SELECT 1
    FROM public.account_users au
    JOIN public.users u ON u.id = au.user_id
    WHERE au.account_id = account_id_param
      AND u.auth_user_id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_has_account_access(uuid) TO authenticated;

DROP POLICY IF EXISTS "Admins can insert survey types" ON public.survey_types;
DROP POLICY IF EXISTS "Admins can update survey types" ON public.survey_types;
DROP POLICY IF EXISTS "Admins can delete custom survey types" ON public.survey_types;

CREATE POLICY "Admins can insert survey types"
  ON public.survey_types FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_account(account_id));

CREATE POLICY "Admins can update survey types"
  ON public.survey_types FOR UPDATE
  TO authenticated
  USING (public.can_manage_account(account_id))
  WITH CHECK (public.can_manage_account(account_id));

CREATE POLICY "Admins can delete custom survey types"
  ON public.survey_types FOR DELETE
  TO authenticated
  USING (is_system = false AND public.can_manage_account(account_id));

DROP POLICY IF EXISTS "Admins can insert survey fields" ON public.survey_fields;
DROP POLICY IF EXISTS "Admins can update survey fields" ON public.survey_fields;
DROP POLICY IF EXISTS "Admins can delete non-system survey fields" ON public.survey_fields;

CREATE POLICY "Admins can insert survey fields"
  ON public.survey_fields FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.survey_types st
      WHERE st.id = survey_type_id
        AND public.can_manage_account(st.account_id)
    )
  );

CREATE POLICY "Admins can update survey fields"
  ON public.survey_fields FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.survey_types st
      WHERE st.id = survey_type_id
        AND public.can_manage_account(st.account_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.survey_types st
      WHERE st.id = survey_type_id
        AND public.can_manage_account(st.account_id)
    )
  );

CREATE POLICY "Admins can delete non-system survey fields"
  ON public.survey_fields FOR DELETE
  TO authenticated
  USING (
    is_system = false
    AND EXISTS (
      SELECT 1
      FROM public.survey_types st
      WHERE st.id = survey_type_id
        AND public.can_manage_account(st.account_id)
    )
  );
