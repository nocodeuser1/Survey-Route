import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  LogIn,
  Route,
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

  if (pageState === 'loading' || pageState === 'joining' || pageState === 'complete') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 text-white flex items-center justify-center p-4">
        <div className="bg-white text-gray-900 rounded-2xl shadow-xl border border-gray-200 p-10 text-center max-w-md w-full">
          {pageState === 'complete' ? (
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
          ) : (
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600 mx-auto mb-4" />
          )}
          <h1 className="text-2xl font-bold mb-2">
            {pageState === 'loading' ? 'Checking Your Invitation' : 'Joining Your Account'}
          </h1>
          <p className="text-gray-600">This should only take a moment.</p>
        </div>
      </div>
    );
  }

  if (pageState === 'check-email') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 text-white flex items-center justify-center p-4">
        <div className="bg-white text-gray-900 rounded-2xl shadow-xl border border-gray-200 p-8 text-center max-w-md w-full">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-3">Check Your Email</h1>
          <p className="text-gray-600">
            Confirm your email address, then reopen this invitation link to finish joining {invitation?.account_name}.
          </p>
        </div>
      </div>
    );
  }

  if (!invitation || (error && (invitation.status !== 'pending' || invitation.expired))) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 text-white flex items-center justify-center p-4">
        <div className="bg-white text-gray-900 rounded-2xl shadow-xl border border-gray-200 p-8 text-center max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-3">Invitation Unavailable</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          {invitation?.already_member && signedInWithInvitedEmail && (
            <button
              type="button"
              onClick={continueToAccount}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              Continue to Account
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 text-white flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white text-gray-900 rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white p-7 sm:p-8 text-center">
          <div className="w-14 h-14 bg-blue-800 text-white rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Route className="w-8 h-8 text-white" />
          </div>
          <p className="text-blue-100 text-sm font-medium mb-2">Survey Route invitation</p>
          <h1 className="text-3xl font-bold">Join {invitation.account_name}</h1>
        </div>

        <div className="p-6 sm:p-8">
          <div className="border border-gray-200 rounded-xl p-4 mb-6">
            <div className="flex gap-3">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0">
                <UserPlus className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{invitation.email}</p>
                <p className="text-sm text-gray-600 mt-1">
                  Access: {invitation.role === 'account_admin' ? 'Account administrator' : 'Team member'}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  This invitation grants access only to {invitation.account_name}.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="border border-red-300 rounded-xl p-4 mb-5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {signedInWithDifferentEmail ? (
            <div className="space-y-4">
              <div className="border border-amber-300 rounded-xl p-4">
                <p className="font-semibold text-gray-900 mb-1">Use the invited email</p>
                <p className="text-sm text-gray-600">
                  You are signed in as {supabaseUser?.email}. This invitation belongs to {invitation.email}.
                </p>
              </div>
              <button
                type="button"
                onClick={handleUseInvitedEmail}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
              >
                Sign Out and Continue
              </button>
            </div>
          ) : signedInWithInvitedEmail ? (
            <div className="space-y-4">
              {invitation.already_member ? (
                <button
                  type="button"
                  onClick={continueToAccount}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                >
                  Continue to Account
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finishAcceptance}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-5 h-5" />
                  Accept Invitation
                </button>
              )}
              <p className="text-xs text-gray-500 text-center">
                Signed in as {supabaseUser?.email}
              </p>
            </div>
          ) : invitation.recipient_state === 'existing_user' ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 text-center">
                You already have a Survey Route sign-in. Log in to add this account to your existing profile.
              </p>
              <button
                type="button"
                onClick={() => navigate(loginUrl)}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <LogIn className="w-5 h-5" />
                Sign In to Accept
              </button>
              <button
                type="button"
                onClick={() => navigate(recoveryUrl)}
                className="w-full border border-gray-300 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                Forgot Password
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreateAccount} className="space-y-5">
              <div>
                <label htmlFor="invite-full-name" className="block text-sm font-semibold text-gray-800 mb-2">
                  Full Name
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
                <label htmlFor="invite-password" className="block text-sm font-semibold text-gray-800 mb-2">
                  Create Password
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="invite-confirm-password" className="block text-sm font-semibold text-gray-800 mb-2">
                  Confirm Password
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
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
              >
                Create Sign-In and Join
              </button>
            </form>
          )}

          <div className="border-t border-gray-200 mt-6 pt-5 flex items-start gap-2">
            <Shield className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500">
              The invitation can only be accepted while signed in with {invitation.email}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
