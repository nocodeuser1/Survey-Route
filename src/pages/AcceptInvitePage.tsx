import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  LogIn,
  Shield,
  UserPlus,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface InvitationPreview {
  id: string;
  email: string;
  account_id: string;
  account_name: string;
  role: 'account_admin' | 'user';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  expired: boolean;
  already_member: boolean;
  recipient_state: 'new_user' | 'existing_user';
}

type PageState = 'loading' | 'ready' | 'joining' | 'check-email' | 'complete';

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { supabaseUser, signOut, reloadUserProfile } = useAuth();

  const token = searchParams.get('token') || '';
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const redirectPath = useMemo(
    () => `/accept-invite?token=${encodeURIComponent(token)}`,
    [token],
  );

  const loginUrl = useMemo(() => {
    if (!invitation) return '/login';
    const params = new URLSearchParams({
      email: invitation.email,
      redirect: redirectPath,
    });
    return `/login?${params.toString()}`;
  }, [invitation, redirectPath]);

  const recoveryUrl = useMemo(() => {
    if (!invitation) return '/login';
    const params = new URLSearchParams({
      email: invitation.email,
      redirect: redirectPath,
      forgot: '1',
    });
    return `/login?${params.toString()}`;
  }, [invitation, redirectPath]);

  useEffect(() => {
    let cancelled = false;

    async function loadInvitation() {
      setError('');
      setPageState('loading');

      if (!token) {
        setError('This invitation link is missing its token. Ask the account administrator for a new link.');
        setPageState('ready');
        return;
      }

      const { data, error: invitationError } = await supabase.rpc(
        'get_invitation_by_token',
        { invitation_token: token },
      );

      if (cancelled) return;

      if (invitationError) {
        console.error('[AcceptInvite] Invitation lookup failed:', invitationError);
        setError('We could not verify this invitation. Ask the account administrator to resend it.');
        setPageState('ready');
        return;
      }

      const preview = data as InvitationPreview | null;
      if (!preview) {
        setError('This invitation link is invalid. Ask the account administrator to send a new one.');
        setPageState('ready');
        return;
      }

      setInvitation(preview);

      if (preview.status !== 'pending') {
        setError(
          preview.status === 'accepted'
            ? 'This invitation has already been accepted.'
            : 'This invitation is no longer active. Ask the account administrator to send a new one.',
        );
      } else if (preview.expired) {
        setError('This invitation has expired. Ask the account administrator to renew it.');
      }

      setPageState('ready');
    }

    loadInvitation();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signedInWithInvitedEmail = Boolean(
    invitation
      && supabaseUser?.email
      && supabaseUser.email.toLowerCase() === invitation.email.toLowerCase(),
  );

  const signedInWithDifferentEmail = Boolean(
    invitation && supabaseUser?.email && !signedInWithInvitedEmail,
  );

  async function finishAcceptance() {
    if (!invitation) return;

    setPageState('joining');
    setError('');

    const { data, error: acceptError } = await supabase.rpc(
      'accept_user_invitation',
      { invitation_token: token },
    );

    if (acceptError || !data?.success) {
      console.error('[AcceptInvite] Acceptance failed:', acceptError || data);
      setError(
        acceptError?.message
          || data?.error
          || 'We could not add you to this account. The invitation may have already been used.',
      );
      setPageState('ready');
      return;
    }

    localStorage.setItem('currentAccountId', data.account_id || invitation.account_id);
    localStorage.setItem('currentView', 'facilities');
    localStorage.setItem('needsSignature', 'true');
    await reloadUserProfile();
    setPageState('complete');
    navigate('/setup-signature', { replace: true });
  }

  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!invitation) return;

    setError('');

    if (fullName.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setPageState('joining');

    try {
      const confirmationUrl = new URL(redirectPath, window.location.origin).toString();
      const { data, error: signupError } = await supabase.auth.signUp({
        email: invitation.email,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: confirmationUrl,
        },
      });

      if (signupError) throw signupError;

      if (!data.session?.user) {
        setPageState('check-email');
        return;
      }

      await finishAcceptance();
    } catch (signupError: unknown) {
      console.error('[AcceptInvite] Signup failed:', signupError);
      const message = signupError instanceof Error
        ? signupError.message
        : 'We could not create your sign-in.';
      setError(
        message.toLowerCase().includes('already')
          ? 'An account already exists for this email. Sign in or reset your password to accept the invitation.'
          : message,
      );
      setPageState('ready');
    }
  }

  async function handleUseInvitedEmail() {
    await signOut();
    window.location.reload();
  }

  function continueToAccount() {
    if (!invitation) return;
    localStorage.setItem('currentAccountId', invitation.account_id);
    localStorage.setItem('currentView', 'facilities');
    navigate('/app', { replace: true });
  }

  const roleLabel = invitation?.role === 'account_admin' ? 'Account administrator' : 'Team member';
  const workspaceName = invitation ? possessive(invitation.account_name) : '';

  if (pageState === 'loading' || pageState === 'joining' || pageState === 'complete') {
    return (
      <InviteShell>
        <div className="px-6 sm:px-9 py-12 text-center">
          {pageState === 'complete' ? (
            <CheckCircle className="w-11 h-11 text-emerald-600 mx-auto mb-5" />
          ) : (
            <div className="animate-spin rounded-full h-11 w-11 border-[3px] border-slate-200 border-t-blue-600 mx-auto mb-5" />
          )}
          <h1 className="text-xl font-bold text-slate-900">
            {pageState === 'loading' ? 'Checking your invitation' : 'Setting up your workspace'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">This should only take a moment.</p>
        </div>
      </InviteShell>
    );
  }

  if (pageState === 'check-email') {
    return (
      <InviteShell>
        <div className="px-6 sm:px-9 py-11 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="w-6 h-6 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Confirm your email</h1>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-500">
            We sent a confirmation link to <span className="font-semibold text-slate-700">{invitation?.email}</span>.
            Confirm it, then reopen this invitation to finish joining{' '}
            {invitation ? possessive(invitation.account_name) : 'the'} workspace.
          </p>
        </div>
      </InviteShell>
    );
  }

  if (!invitation || (error && (invitation.status !== 'pending' || invitation.expired))) {
    return (
      <InviteShell>
        <div className="px-6 sm:px-9 py-11 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">This invitation isn&rsquo;t available</h1>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-500">{error}</p>
          {invitation?.already_member && signedInWithInvitedEmail && (
            <button
              type="button"
              onClick={continueToAccount}
              className="mt-6 w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              Go to workspace
            </button>
          )}
        </div>
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <div className="px-6 sm:px-9 pt-7 pb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-blue-600">
          Account invitation
        </p>
        <h1 className="mt-2.5 text-[25px] sm:text-[28px] leading-[1.2] font-bold text-slate-900">
          Join {workspaceName} Workspace
          <span className="block mt-1 text-lg sm:text-xl font-semibold text-slate-400">
            in Survey-Route.com
          </span>
        </h1>

        {/* The grant, shown as a record — mirrors the invitation email */}
        <dl className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 divide-y divide-slate-200/70">
          <InviteFact label="Workspace" value={invitation.account_name} />
          <InviteFact label="Your role" value={roleLabel} />
          <InviteFact label="Invited email" value={invitation.email} />
        </dl>

        {error && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="mt-6">
          {signedInWithDifferentEmail ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="font-semibold text-slate-900 text-sm mb-1">Switch accounts to continue</p>
                <p className="text-sm text-slate-600">
                  You&rsquo;re signed in as {supabaseUser?.email}, but this invitation was sent to{' '}
                  {invitation.email}.
                </p>
              </div>
              <button
                type="button"
                onClick={handleUseInvitedEmail}
                className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors"
              >
                Sign out and continue
              </button>
            </div>
          ) : signedInWithInvitedEmail ? (
            <div className="space-y-3">
              {invitation.already_member ? (
                <button
                  type="button"
                  onClick={continueToAccount}
                  className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors"
                >
                  Go to workspace
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finishAcceptance}
                  className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-5 h-5" />
                  Accept invitation
                </button>
              )}
              <p className="text-xs text-slate-400 text-center">Signed in as {supabaseUser?.email}</p>
            </div>
          ) : invitation.recipient_state === 'existing_user' ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 text-center leading-relaxed">
                You already have a Survey-Route sign-in. Log in and this workspace will be added to your profile.
              </p>
              <button
                type="button"
                onClick={() => navigate(loginUrl)}
                className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors flex items-center justify-center gap-2"
              >
                <LogIn className="w-5 h-5" />
                Sign in to accept
              </button>
              <button
                type="button"
                onClick={() => navigate(recoveryUrl)}
                className="w-full border border-slate-300 text-slate-700 py-3.5 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
              >
                Forgot password
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label htmlFor="invite-full-name" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Full name
                </label>
                <input
                  id="invite-full-name"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="form-input"
                  placeholder="Your name"
                  required
                />
              </div>

              <div>
                <label htmlFor="invite-password" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Create password
                </label>
                <div className="relative">
                  <input
                    id="invite-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="form-input pr-12"
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="invite-confirm-password" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Confirm password
                </label>
                <input
                  id="invite-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="form-input"
                  placeholder="Enter it again"
                  minLength={8}
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors"
              >
                Create sign-in and join
              </button>
            </form>
          )}
        </div>

        <div className="border-t border-slate-100 mt-7 pt-5 flex items-start gap-2.5">
          <Shield className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-slate-400">
            This invitation can only be accepted while signed in as {invitation.email}, and grants
            access to {invitation.account_name} only.
          </p>
        </div>
      </div>
    </InviteShell>
  );
}

/** "Camino" → "Camino's"; "Jones" → "Jones'" */
function possessive(name: string) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'this';
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}

/** One labelled row in the invitation record. */
function InviteFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-slate-900 break-words">{value}</dd>
    </div>
  );
}

/**
 * Shared frame for every state of the invite flow: brand rule, the real
 * Survey-Route lockup, and the BEAR Data line — so the page a recipient lands
 * on looks like the email that brought them here.
 */
function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#eef2f7] via-white to-[#e9eef6] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_12px_44px_-14px_rgba(15,23,42,0.22)] overflow-hidden">
          <div className="h-1 bg-blue-600" />
          <div className="px-6 sm:px-9 pt-8 pb-6 text-center border-b border-slate-100">
            <img
              src="/survey-route-logo-v2.png"
              alt="Survey-Route by BEAR DATA"
              width={165}
              height={55}
              className="w-[165px] h-auto mx-auto"
            />
          </div>
          {children}
        </div>
        <p className="mt-5 text-center text-[11px] text-slate-400">
          Survey-Route <span className="text-slate-300">·</span>{' '}
          <span className="tracking-wide">by BEAR Data</span>
        </p>
      </div>
    </div>
  );
}
