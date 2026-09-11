export const AUTH_SITE_URL = 'https://survey-route.com';
const RECOVERY_KEY = 'survey-route:password-recovery:v1';

export function safeReturnPath(value: string | null | undefined, fallback = '/login'): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) {
    return fallback;
  }
  try {
    const url = new URL(value, AUTH_SITE_URL);
    if (url.pathname === '/login' || url.pathname === '/reset-password') return fallback;
    return url.origin === AUTH_SITE_URL ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function passwordResetRedirect(returnTo?: string): string {
  const url = new URL('/reset-password', AUTH_SITE_URL);
  if (returnTo) url.searchParams.set('redirect', safeReturnPath(returnTo));
  return url.toString();
}

// A recovery callback can arrive at the site root when an older email did not
// specify a redirect. Route it before React or the auth SDK removes the hash.
export function recoveryCallbackPath(url: URL): string | null {
  const hash = new URLSearchParams(url.hash.slice(1));
  if (hash.get('type') !== 'recovery' || url.pathname === '/reset-password') return null;
  const target = new URL(passwordResetRedirect(url.searchParams.get('redirect') || undefined));
  return `${target.pathname}${target.search}${url.hash}`;
}

type SessionIdentity = { user: { id: string }; expires_at?: number } | null;
type RecoveryMarker = { userId: string; expiresAt: number };
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createRecoveryTracker(storage: RecoveryStorage | null, now = Date.now) {
  let marker: RecoveryMarker | null = null;
  try {
    const saved = storage?.getItem(RECOVERY_KEY);
    if (saved) marker = JSON.parse(saved) as RecoveryMarker;
  } catch { /* Recovery can still complete with tab storage unavailable. */ }

  function clear() {
    marker = null;
    try { storage?.removeItem(RECOVERY_KEY); } catch { /* Use in-memory state. */ }
  }

  function beginCallback(url: URL) {
    const hash = new URLSearchParams(url.hash.slice(1));
    if (hash.get('type') === 'recovery' || hash.has('error') || url.searchParams.has('error')) {
      clear();
    }
  }

  function handleAuthEvent(event: string, session: SessionIdentity) {
    if (!session || (marker && session.user.id !== marker.userId)) clear();
    if (event === 'PASSWORD_RECOVERY' && session?.expires_at) {
      marker = { userId: session.user.id, expiresAt: Math.min(session.expires_at * 1000, now() + 3600000) };
      try { storage?.setItem(RECOVERY_KEY, JSON.stringify(marker)); } catch { /* Use in-memory state. */ }
    }
  }

  function userIdFor(session: SessionIdentity): string | null {
    if (!marker || !session || marker.userId !== session.user.id || !(marker.expiresAt > now())) return null;
    return marker.userId;
  }

  return { beginCallback, handleAuthEvent, userIdFor, clear };
}

interface PasswordResetAuth {
  getSession(): Promise<{ data: { session: SessionIdentity }; error: Error | null }>;
  updateUser(attributes: { password: string }): Promise<{ error: Error | null }>;
}

export async function completePasswordReset(
  auth: PasswordResetAuth,
  tracker: ReturnType<typeof createRecoveryTracker>,
  expectedUserId: string | null,
  password: string,
): Promise<boolean> {
  const { data: { session }, error: sessionError } = await auth.getSession();
  if (sessionError || !expectedUserId || tracker.userIdFor(session) !== expectedUserId) return false;
  const { error } = await auth.updateUser({ password });
  if (error) throw error;
  tracker.clear();
  return true;
}
