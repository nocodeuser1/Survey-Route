/*
  Secure account invitations and keep every membership change tenant-scoped.

  The previous flow exposed pending invitations to anonymous table reads,
  accepted caller-supplied account/user/role values through a SECURITY DEFINER
  function, and offered cleanup helpers that could remove memberships from
  unrelated accounts. This migration replaces those paths with two narrow RPCs:

    - get_invitation_by_token(token): safe, read-only invitation preview
    - accept_user_invitation(token): authenticated, atomic acceptance

  Every value used to create the membership is loaded from the invitation row.
*/

BEGIN;

-- Anonymous PostgREST table reads cannot be restricted to the token supplied
-- in a query string. Use get_invitation_by_token() instead. Remove every old
-- client-facing policy first because permissive RLS policies are ORed together.
DROP POLICY IF EXISTS "Account admins can view invitations for their accounts" ON public.user_invitations;
DROP POLICY IF EXISTS "Account admins can view invitations for their account" ON public.user_invitations;
DROP POLICY IF EXISTS "Account admins and agency owners can view invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Agency owners can view all invitations in their agency" ON public.user_invitations;
DROP POLICY IF EXISTS "Invited users can view their own invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Invited users can view their own pending invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Users can view their accepted/declined invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Anyone can view invitations by token" ON public.user_invitations;
DROP POLICY IF EXISTS "Anonymous users can view invitations by token" ON public.user_invitations;

DROP POLICY IF EXISTS "Account admins can create invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Agency owners can create invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Authorized users can create invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Account admins and agency owners can create invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Agency owners can insert user_invitations for their agency accounts" ON public.user_invitations;

DROP POLICY IF EXISTS "Account admins can update invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Account admins can update invitations for their account" ON public.user_invitations;
DROP POLICY IF EXISTS "Invited users can accept their invitations" ON public.user_invitations;

DROP POLICY IF EXISTS "Authorized users can delete invitations" ON public.user_invitations;
DROP POLICY IF EXISTS "Account admins can delete invitations for their accounts" ON public.user_invitations;
DROP POLICY IF EXISTS "Agency owners can delete invitations for their agency" ON public.user_invitations;

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_invitations FROM anon;

-- The obsolete invitations table had the same anonymous full-table policies.
DO $obsolete_invitations$
BEGIN
  IF to_regclass('public.invitations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can view invitations by token" ON public.invitations';
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can update invitation status when accepting" ON public.invitations';
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.invitations FROM anon';
  END IF;
END;
$obsolete_invitations$;

CREATE OR REPLACE FUNCTION public._can_manage_account_invitations(
  target_account_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.account_users au
      JOIN public.users u ON u.id = au.user_id
      WHERE au.account_id = target_account_id
        AND u.auth_user_id = auth.uid()
        AND au.role = 'account_admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.accounts a
      JOIN public.agencies ag ON ag.id = a.agency_id
      WHERE a.id = target_account_id
        AND lower(ag.owner_email) = lower(coalesce(auth.jwt()->>'email', ''))
    )
    OR EXISTS (
      SELECT 1
      FROM public.accounts a
      JOIN public.agency_co_owners co ON co.agency_id = a.agency_id
      JOIN public.users u ON u.id = co.user_id
      WHERE a.id = target_account_id
        AND u.auth_user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public._can_manage_account_invitations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._can_manage_account_invitations(uuid) TO authenticated;

-- Co-owners are agency administrators too. Without these policies the agency
-- dashboard could mistake a co-owner for a brand-new owner and create a second
-- agency instead of loading the agency they were invited to manage.
DROP POLICY IF EXISTS "Agency administrators can view agency" ON public.agencies;
CREATE POLICY "Agency administrators can view agency"
  ON public.agencies FOR SELECT
  TO authenticated
  USING (public._is_agency_admin(id));

DROP POLICY IF EXISTS "Agency administrators can update agency" ON public.agencies;
CREATE POLICY "Agency administrators can update agency"
  ON public.agencies FOR UPDATE
  TO authenticated
  USING (public._is_agency_admin(id))
  WITH CHECK (public._is_agency_admin(id));

-- One policy per operation avoids older permissive policies silently widening
-- access. Invitation recipients accept through accept_user_invitation(), never
-- by updating the table themselves.
DROP POLICY IF EXISTS "Invitation managers can view invitations" ON public.user_invitations;
CREATE POLICY "Invitation managers can view invitations"
  ON public.user_invitations FOR SELECT
  TO authenticated
  USING (public._can_manage_account_invitations(account_id));

DROP POLICY IF EXISTS "Invitation managers can create invitations" ON public.user_invitations;
CREATE POLICY "Invitation managers can create invitations"
  ON public.user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    public._can_manage_account_invitations(account_id)
    AND invited_by = (
      SELECT u.id
      FROM public.users u
      WHERE u.auth_user_id = auth.uid()
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS "Invitation managers can update invitations" ON public.user_invitations;
CREATE POLICY "Invitation managers can update invitations"
  ON public.user_invitations FOR UPDATE
  TO authenticated
  USING (public._can_manage_account_invitations(account_id))
  WITH CHECK (public._can_manage_account_invitations(account_id));

DROP POLICY IF EXISTS "Invitation managers can delete invitations" ON public.user_invitations;
CREATE POLICY "Invitation managers can delete invitations"
  ON public.user_invitations FOR DELETE
  TO authenticated
  USING (public._can_manage_account_invitations(account_id));

-- A pending invitation used to let its recipient insert any role they chose.
-- Membership creation now happens inside accept_user_invitation(), which takes
-- the role and account from the locked invitation row.
DROP POLICY IF EXISTS "Account admins can insert account members" ON public.account_users;
DROP POLICY IF EXISTS "Agency owners can add account members" ON public.account_users;
DROP POLICY IF EXISTS "Authorized users can add account members" ON public.account_users;
DROP POLICY IF EXISTS "Invitation managers can add account members" ON public.account_users;

CREATE POLICY "Invitation managers can add account members"
  ON public.account_users FOR INSERT
  TO authenticated
  WITH CHECK (public._can_manage_account_invitations(account_id));

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(
  invitation_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_invitation record;
  v_auth_user_id uuid;
  v_profile_id uuid;
  v_already_member boolean := false;
BEGIN
  IF invitation_token IS NULL OR length(invitation_token) < 20 OR length(invitation_token) > 200 THEN
    RETURN NULL;
  END IF;

  SELECT
    ui.id,
    lower(ui.email) AS email,
    ui.account_id,
    ui.role,
    ui.status,
    ui.expires_at,
    coalesce(nullif(a.company_name, ''), nullif(a.account_name, ''), 'Account') AS account_name
  INTO v_invitation
  FROM public.user_invitations ui
  JOIN public.accounts a ON a.id = ui.account_id
  WHERE ui.token = invitation_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT au.id
  INTO v_auth_user_id
  FROM auth.users au
  WHERE lower(au.email) = v_invitation.email
  LIMIT 1;

  SELECT u.id
  INTO v_profile_id
  FROM public.users u
  WHERE lower(u.email) = v_invitation.email
  ORDER BY (u.auth_user_id = v_auth_user_id) DESC NULLS LAST
  LIMIT 1;

  IF v_profile_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.account_users au
      WHERE au.account_id = v_invitation.account_id
        AND au.user_id = v_profile_id
    ) INTO v_already_member;
  END IF;

  RETURN jsonb_build_object(
    'id', v_invitation.id,
    'email', v_invitation.email,
    'account_id', v_invitation.account_id,
    'account_name', v_invitation.account_name,
    'role', v_invitation.role,
    'status', v_invitation.status,
    'expires_at', v_invitation.expires_at,
    'expired', v_invitation.expires_at <= now(),
    'already_member', v_already_member,
    'recipient_state', CASE
      WHEN v_auth_user_id IS NULL THEN 'new_user'
      ELSE 'existing_user'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_user_invitation(
  invitation_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitation record;
  v_caller_email text;
  v_profile_id uuid;
  v_existing_profile_auth_id uuid;
  v_already_member boolean;
  v_full_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  v_caller_email := lower(coalesce(auth.jwt()->>'email', ''));
  IF v_caller_email = '' THEN
    RAISE EXCEPTION 'Authenticated email is missing';
  END IF;

  SELECT ui.id, lower(ui.email) AS email, ui.account_id, ui.role, ui.invited_by
  INTO v_invitation
  FROM public.user_invitations ui
  WHERE ui.token = invitation_token
    AND ui.status = 'pending'
    AND ui.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation is invalid, expired, or already used';
  END IF;

  IF v_invitation.email <> v_caller_email THEN
    RAISE EXCEPTION 'Sign in with the email address that received this invitation';
  END IF;

  SELECT u.id
  INTO v_profile_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    SELECT u.id, u.auth_user_id
    INTO v_profile_id, v_existing_profile_auth_id
    FROM public.users u
    WHERE lower(u.email) = v_caller_email
    LIMIT 1;

    IF v_profile_id IS NOT NULL AND v_existing_profile_auth_id IS NOT NULL
       AND v_existing_profile_auth_id <> auth.uid() THEN
      RAISE EXCEPTION 'This email is linked to a different sign-in account';
    END IF;

    IF v_profile_id IS NOT NULL THEN
      UPDATE public.users
      SET auth_user_id = auth.uid()
      WHERE id = v_profile_id
        AND auth_user_id IS NULL;
    ELSE
      v_full_name := coalesce(
        nullif(auth.jwt()->'user_metadata'->>'full_name', ''),
        split_part(v_caller_email, '@', 1)
      );

      INSERT INTO public.users (auth_user_id, email, full_name, is_agency_owner)
      VALUES (auth.uid(), v_caller_email, v_full_name, false)
      RETURNING id INTO v_profile_id;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.account_users au
    WHERE au.account_id = v_invitation.account_id
      AND au.user_id = v_profile_id
  ) INTO v_already_member;

  INSERT INTO public.account_users (account_id, user_id, role, invited_by, joined_at)
  VALUES (
    v_invitation.account_id,
    v_profile_id,
    v_invitation.role,
    v_invitation.invited_by,
    now()
  )
  ON CONFLICT (account_id, user_id) DO UPDATE
  SET role = EXCLUDED.role,
      invited_by = EXCLUDED.invited_by;

  UPDATE public.user_invitations
  SET status = 'accepted'
  WHERE id = v_invitation.id;

  RETURN jsonb_build_object(
    'success', true,
    'account_id', v_invitation.account_id,
    'role', v_invitation.role,
    'already_member', v_already_member
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_user_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_user_invitation(text) TO authenticated;

-- Invitation preparation is an admin-only, read-only check. It must never
-- delete or unlink an auth account as a side effect of typing an email.
CREATE OR REPLACE FUNCTION public.prepare_email_for_invitation(
  target_email text,
  target_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_profile_id uuid;
  v_is_member boolean := false;
  v_auth_exists boolean := false;
BEGIN
  IF target_account_id IS NULL OR NOT public._can_manage_account_invitations(target_account_id) THEN
    RAISE EXCEPTION 'Not authorized to invite users to this account';
  END IF;

  SELECT u.id
  INTO v_profile_id
  FROM public.users u
  WHERE lower(u.email) = lower(trim(target_email))
  LIMIT 1;

  IF v_profile_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = target_account_id
        AND au.user_id = v_profile_id
    ) INTO v_is_member;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE lower(au.email) = lower(trim(target_email))
  ) INTO v_auth_exists;

  RETURN jsonb_build_object(
    'success', true,
    'can_invite', NOT v_is_member,
    'state', CASE
      WHEN v_is_member THEN 'already_member'
      WHEN v_auth_exists THEN 'existing_user'
      ELSE 'new_user'
    END,
    'message', CASE
      WHEN v_is_member THEN 'This user already belongs to this account'
      WHEN v_auth_exists THEN 'Existing user can be invited to this account'
      ELSE 'Email is ready for invitation'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_email_for_invitation(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_email_for_invitation(text, uuid) TO authenticated;

-- Team data is sensitive. SECURITY DEFINER must still enforce account-level
-- authorization instead of accepting any account UUID from any signed-in user.
CREATE OR REPLACE FUNCTION public.get_account_team_members(target_account_id uuid)
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
    coalesce(u.is_agency_owner, false)
  FROM public.users u
  JOIN public.account_users au ON au.user_id = u.id
  LEFT JOIN auth.users auth_user ON auth_user.id = u.auth_user_id
  WHERE au.account_id = target_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_team_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_team_members(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.renew_invitation(
  invitation_id uuid,
  days_to_extend integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_expires_at timestamptz;
BEGIN
  IF days_to_extend < 1 OR days_to_extend > 30 THEN
    RAISE EXCEPTION 'Renewal must be between 1 and 30 days';
  END IF;

  SELECT ui.account_id INTO v_account_id
  FROM public.user_invitations ui
  WHERE ui.id = invitation_id;

  IF v_account_id IS NULL OR NOT public._can_manage_account_invitations(v_account_id) THEN
    RAISE EXCEPTION 'Not authorized to renew this invitation';
  END IF;

  UPDATE public.user_invitations
  SET expires_at = now() + make_interval(days => days_to_extend),
      status = 'pending'
  WHERE id = invitation_id
    AND status IN ('pending', 'expired', 'revoked')
  RETURNING expires_at INTO v_expires_at;

  IF v_expires_at IS NULL THEN
    RAISE EXCEPTION 'Accepted invitations cannot be renewed';
  END IF;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.renew_invitation(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_invitation(uuid, integer) TO authenticated;

-- Retire generic or destructive invitation helpers. Existing definitions stay
-- in place for migration history, but browser clients can no longer execute them.
DO $retire_unsafe_helpers$
BEGIN
  IF to_regprocedure('public.upsert_account_membership(uuid,uuid,text,uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.upsert_account_membership(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.cleanup_failed_signup_via_invitation(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cleanup_failed_signup_via_invitation(text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.cleanup_orphaned_auth_user(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cleanup_orphaned_auth_user(text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.force_cleanup_auth_account(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.force_cleanup_auth_account(text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.prepare_email_for_invitation(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.prepare_email_for_invitation(text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.check_auth_account_status(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.check_auth_account_status(text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.check_auth_account_status(text,uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.check_auth_account_status(text, uuid) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.get_user_auth_status(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_user_auth_status(text) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.get_user_id_by_email(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon, authenticated';
  END IF;
END;
$retire_unsafe_helpers$;

COMMIT;
