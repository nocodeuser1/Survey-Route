-- Direct profile claiming lacks invitation/email binding. The existing
-- accept_user_invitation(text) SECURITY DEFINER path performs that binding,
-- preserves the profile identity and is already used by AcceptInvitePage.
-- Do not replace this policy with email-only client writes: public profile
-- email is editable and is not authority to link an Auth identity.
DROP POLICY IF EXISTS "Users can link auth to unlinked accounts" ON public.users;
