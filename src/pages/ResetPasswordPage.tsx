import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { passwordRecovery, supabase } from '../lib/supabase';
import { completePasswordReset, safeReturnPath } from '../lib/passwordRecovery';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const navigationTimer = useRef<ReturnType<typeof setTimeout>>();

  const returnTo = useMemo(() => {
    const requested = searchParams.get('redirect');
    return safeReturnPath(requested);
  }, [searchParams]);
  const newLinkUrl = useMemo(() => {
    const params = new URLSearchParams({ forgot: '1' });
    if (returnTo !== '/login') params.set('redirect', returnTo);
    return `/login?${params}`;
  }, [returnTo]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (!mounted) return;
      setRecoveryUserId(sessionError ? null : passwordRecovery.userIdFor(session));
      setCheckingSession(false);
    }).catch(() => {
      if (!mounted) return;
      setRecoveryUserId(null);
      setCheckingSession(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setRecoveryUserId(passwordRecovery.userIdFor(session));
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(navigationTimer.current);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const updated = await completePasswordReset(supabase.auth, passwordRecovery, recoveryUserId, password);
      if (!updated) {
        setRecoveryUserId(null);
        return;
      }
      setPassword('');
      setConfirmPassword('');
      setComplete(true);
      navigationTimer.current = setTimeout(() => navigate(returnTo, { replace: true }), 1200);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'We could not update your password. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 text-white flex items-center justify-center p-4">
      <div className="bg-white text-gray-900 rounded-2xl shadow-xl border border-gray-200 max-w-md w-full p-8">
        <div className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center mx-auto mb-5">
          <KeyRound className="w-6 h-6 text-white" />
        </div>

        {complete ? (
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Password Updated</h1>
            <p className="text-gray-600">Returning you to Survey-Route...</p>
          </div>
        ) : checkingSession ? (
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-blue-600 mx-auto mb-4" />
            <h1 className="text-xl font-bold">Checking Reset Link</h1>
          </div>
        ) : !recoveryUserId ? (
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Reset Link Unavailable</h1>
            <p className="text-gray-600 mb-6">
              This link is invalid or expired. Request a new password reset email.
            </p>
            <button
              type="button"
              onClick={() => navigate(newLinkUrl)}
              title="Request a new password reset link"
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              Request New Link
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold mb-2">Choose a New Password</h1>
              <p className="text-gray-600 text-sm">Use at least 8 characters.</p>
            </div>

            {error && (
              <div className="border border-red-300 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="reset-new-password" className="block text-sm font-semibold text-gray-800 mb-2">
                New Password
              </label>
              <div className="relative">
                <input
                  id="reset-new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="form-input pr-12"
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
              <label htmlFor="reset-confirm-password" className="block text-sm font-semibold text-gray-800 mb-2">
                Confirm Password
              </label>
              <input
                id="reset-confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="form-input"
                minLength={8}
                required
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
