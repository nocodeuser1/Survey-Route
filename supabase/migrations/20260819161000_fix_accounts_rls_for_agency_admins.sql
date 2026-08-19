/*
  # Fix account creation for agency admins

  The Agency Dashboard lets both primary owners and agency co-owners manage
  customer accounts, but the accounts INSERT policy still only recognized the
  primary `agencies.owner_email` path. That blocked valid co-owners with:

    new row violates row-level security policy for table "accounts"

  Keep the existing helper name used by the accounts policies, but update its
  logic to match the agency-admin model introduced with agency_co_owners.
*/

CREATE OR REPLACE FUNCTION public._is_agency_admin(target_agency_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM public.agencies a
     WHERE a.id = target_agency_id
       AND LOWER(a.owner_email) = LOWER((auth.jwt()->>'email'))
  ) OR EXISTS (
    SELECT 1
      FROM public.agency_co_owners co
      JOIN public.users u ON u.id = co.user_id
     WHERE co.agency_id = target_agency_id
       AND u.auth_user_id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._is_agency_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_agency_owner(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public._is_agency_admin(p_agency_id);
$$;

GRANT EXECUTE ON FUNCTION public.is_agency_owner(uuid) TO authenticated;

DROP POLICY IF EXISTS "Agency owners can create accounts" ON public.accounts;
DROP POLICY IF EXISTS "Agency owners can update accounts" ON public.accounts;
DROP POLICY IF EXISTS "Agency owners can delete accounts" ON public.accounts;
DROP POLICY IF EXISTS "Agency admins can view accounts in their agency" ON public.accounts;

CREATE POLICY "Agency owners can create accounts"
  ON public.accounts FOR INSERT
  TO authenticated
  WITH CHECK (public.is_agency_owner(agency_id));

CREATE POLICY "Agency admins can view accounts in their agency"
  ON public.accounts FOR SELECT
  TO authenticated
  USING (public.is_agency_owner(agency_id));

CREATE POLICY "Agency owners can update accounts"
  ON public.accounts FOR UPDATE
  TO authenticated
  USING (public.is_agency_owner(agency_id))
  WITH CHECK (public.is_agency_owner(agency_id));

CREATE POLICY "Agency owners can delete accounts"
  ON public.accounts FOR DELETE
  TO authenticated
  USING (public.is_agency_owner(agency_id));
