/*
  # Harden account role management

  Membership rows are security boundaries. They must only be created by the
  invitation/account-management RPCs, and role/removal changes must be scoped
  to the caller's current account. This also removes an older self-insert
  policy that allowed an invitation recipient to choose a role client-side.
*/

-- No client may write account membership rows directly. SECURITY DEFINER RPCs
-- below, accept_user_invitation(), and the agency co-owner triggers are the
-- only supported write paths.
DO $drop_account_user_write_policies$
DECLARE
  policy record;
BEGIN
  FOR policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_users'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.account_users', policy.policyname);
  END LOOP;
END;
$drop_account_user_write_policies$;

-- Account administrators need to see the membership roster only for accounts
-- they administer. The helper includes account-scoped admins plus the primary
-- agency owner and agency co-owners.
DROP POLICY IF EXISTS "Agency owners can view account memberships" ON public.account_users;
DROP POLICY IF EXISTS "Account managers can view account memberships" ON public.account_users;
CREATE POLICY "Account managers can view account memberships"
  ON public.account_users FOR SELECT
  TO authenticated
  USING (public._can_manage_account_invitations(account_id));

CREATE OR REPLACE FUNCTION public.is_agency_admin_for_account(
  target_account_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = target_account_id
        AND public._is_agency_admin(a.agency_id)
    );
$$;

REVOKE ALL ON FUNCTION public.is_agency_admin_for_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_agency_admin_for_account(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_account_team_members(
  target_account_id uuid
)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text,
  signature_completed boolean,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  is_agency_owner boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF NOT public._can_manage_account_invitations(target_account_id) THEN
    RAISE EXCEPTION 'Not authorized to view this account team';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    au.role,
    coalesce(u.signature_completed, false),
    au.joined_at,
    auth_user.last_sign_in_at,
    (
      lower(u.email) = lower(ag.owner_email)
      OR EXISTS (
        SELECT 1
        FROM public.agency_co_owners co
        WHERE co.agency_id = a.agency_id
          AND co.user_id = u.id
      )
    ) AS is_agency_owner
  FROM public.users u
  JOIN public.account_users au ON au.user_id = u.id
  JOIN public.accounts a ON a.id = au.account_id
  JOIN public.agencies ag ON ag.id = a.agency_id
  LEFT JOIN auth.users auth_user ON auth_user.id = u.auth_user_id
  WHERE au.account_id = target_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_team_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_team_members(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_account_member_role(
  target_account_id uuid,
  target_user_id uuid,
  new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id uuid;
  v_caller_user_id uuid;
  v_target_email text;
  v_owner_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF new_role NOT IN ('account_admin', 'user') THEN
    RAISE EXCEPTION 'Invalid account role';
  END IF;

  IF NOT public._can_manage_account_invitations(target_account_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this account';
  END IF;

  SELECT a.agency_id, ag.owner_email
  INTO v_agency_id, v_owner_email
  FROM public.accounts a
  JOIN public.agencies ag ON ag.id = a.agency_id
  WHERE a.id = target_account_id;

  SELECT u.id
  INTO v_caller_user_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  SELECT u.email
  INTO v_target_email
  FROM public.account_users au
  JOIN public.users u ON u.id = au.user_id
  WHERE au.account_id = target_account_id
    AND au.user_id = target_user_id;

  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'Account member not found';
  END IF;

  IF target_user_id = v_caller_user_id THEN
    RAISE EXCEPTION 'You cannot change your own account role';
  END IF;

  IF lower(v_target_email) = lower(v_owner_email)
     OR EXISTS (
       SELECT 1
       FROM public.agency_co_owners co
       WHERE co.agency_id = v_agency_id
         AND co.user_id = target_user_id
     )
  THEN
    RAISE EXCEPTION 'Agency owner roles are managed at the agency level';
  END IF;

  UPDATE public.account_users
  SET role = new_role
  WHERE account_id = target_account_id
    AND user_id = target_user_id;

  RETURN jsonb_build_object('success', true, 'role', new_role);
END;
$$;

REVOKE ALL ON FUNCTION public.update_account_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_account_member_role(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_account_member(
  target_account_id uuid,
  target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id uuid;
  v_caller_user_id uuid;
  v_target_email text;
  v_owner_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT public._can_manage_account_invitations(target_account_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this account';
  END IF;

  SELECT a.agency_id, ag.owner_email
  INTO v_agency_id, v_owner_email
  FROM public.accounts a
  JOIN public.agencies ag ON ag.id = a.agency_id
  WHERE a.id = target_account_id;

  SELECT u.id
  INTO v_caller_user_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  SELECT u.email
  INTO v_target_email
  FROM public.account_users au
  JOIN public.users u ON u.id = au.user_id
  WHERE au.account_id = target_account_id
    AND au.user_id = target_user_id;

  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'Account member not found';
  END IF;

  IF target_user_id = v_caller_user_id THEN
    RAISE EXCEPTION 'You cannot remove your own account access';
  END IF;

  IF lower(v_target_email) = lower(v_owner_email)
     OR EXISTS (
       SELECT 1
       FROM public.agency_co_owners co
       WHERE co.agency_id = v_agency_id
         AND co.user_id = target_user_id
     )
  THEN
    RAISE EXCEPTION 'Agency owners cannot be removed from an account';
  END IF;

  DELETE FROM public.account_users
  WHERE account_id = target_account_id
    AND user_id = target_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_account_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_my_team_assignment(
  target_account_id uuid,
  target_team_assignment integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF target_team_assignment IS NOT NULL
     AND (target_team_assignment < 1 OR target_team_assignment > 100)
  THEN
    RAISE EXCEPTION 'Invalid team assignment';
  END IF;

  SELECT u.id
  INTO v_profile_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.account_users au
    WHERE au.account_id = target_account_id
      AND au.user_id = v_profile_id
  ) THEN
    RAISE EXCEPTION 'You are not a member of this account';
  END IF;

  UPDATE public.account_users
  SET team_assignment = target_team_assignment
  WHERE account_id = target_account_id
    AND user_id = v_profile_id;

  RETURN jsonb_build_object('success', true, 'team_assignment', target_team_assignment);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_team_assignment(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_team_assignment(uuid, integer) TO authenticated;

-- Older helpers remain in use by agency-management screens or policies, but
-- must never be callable by anonymous clients.
REVOKE ALL ON FUNCTION public.is_account_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_user_account_access(
  target_user_id uuid,
  target_account_id uuid,
  new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id uuid;
  v_caller_id uuid;
  v_owner_email text;
  v_target_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF new_role NOT IN ('account_admin', 'user') THEN
    RAISE EXCEPTION 'Invalid account role';
  END IF;

  SELECT a.agency_id, ag.owner_email
  INTO v_agency_id, v_owner_email
  FROM public.accounts a
  JOIN public.agencies ag ON ag.id = a.agency_id
  WHERE a.id = target_account_id;

  IF v_agency_id IS NULL OR NOT public._is_agency_admin(v_agency_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this account';
  END IF;

  SELECT u.id
  INTO v_caller_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  SELECT u.email
  INTO v_target_email
  FROM public.users u
  WHERE u.id = target_user_id;

  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF lower(v_target_email) = lower(v_owner_email)
     OR EXISTS (
       SELECT 1
       FROM public.agency_co_owners co
       WHERE co.agency_id = v_agency_id
         AND co.user_id = target_user_id
     )
  THEN
    RAISE EXCEPTION 'Agency owner roles are managed at the agency level';
  END IF;

  INSERT INTO public.account_users (account_id, user_id, role, invited_by)
  VALUES (target_account_id, target_user_id, new_role, v_caller_id)
  ON CONFLICT (account_id, user_id) DO UPDATE
  SET role = EXCLUDED.role;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_user_account_access(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_user_account_access(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_user_account_access(
  target_user_id uuid,
  target_account_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id uuid;
  v_owner_email text;
  v_target_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT a.agency_id, ag.owner_email
  INTO v_agency_id, v_owner_email
  FROM public.accounts a
  JOIN public.agencies ag ON ag.id = a.agency_id
  WHERE a.id = target_account_id;

  IF v_agency_id IS NULL OR NOT public._is_agency_admin(v_agency_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this account';
  END IF;

  SELECT u.email
  INTO v_target_email
  FROM public.users u
  WHERE u.id = target_user_id;

  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF lower(v_target_email) = lower(v_owner_email)
     OR EXISTS (
       SELECT 1
       FROM public.agency_co_owners co
       WHERE co.agency_id = v_agency_id
         AND co.user_id = target_user_id
     )
  THEN
    RAISE EXCEPTION 'Agency owners cannot be removed from an account';
  END IF;

  DELETE FROM public.account_users
  WHERE account_id = target_account_id
    AND user_id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_account_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_user_account_access(uuid, uuid) TO authenticated;
