import test from 'node:test';
import assert from 'node:assert/strict';
import { completePasswordReset, createRecoveryTracker, passwordResetRedirect, recoveryCallbackPath, safeReturnPath } from '../src/lib/passwordRecovery.ts';

const now = 1000000;
const session = { user: { id: 'reset-user' }, expires_at: now / 1000 + 3600 };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('all reset requests use the canonical site, including a retained invitation', () => {
  assert.equal(passwordResetRedirect(), 'https://survey-route.com/reset-password');
  const invitation = '/accept-invite?token=example-invitation';
  const url = new URL(passwordResetRedirect(invitation));
  assert.equal(url.origin, 'https://survey-route.com');
  assert.equal(url.searchParams.get('redirect'), invitation);
});

test('return paths reject external, protocol-relative and backslash redirects', () => {
  for (const path of ['https://old.example/app', '//evil.example', '/\\evil.example', '/\nevil.example', 'javascript:alert(1)']) {
    assert.equal(safeReturnPath(path), '/login');
  }
  assert.equal(safeReturnPath('/accept-invite?token=a%2Fb'), '/accept-invite?token=a%2Fb');
  assert.equal(safeReturnPath('/login?redirect=/login', '/app'), '/app');
  assert.equal(safeReturnPath('/reset-password'), '/login');
});

test('root recovery callbacks reach the reset form without dropping tokens', () => {
  assert.equal(recoveryCallbackPath(new URL('https://survey-route.com/#type=recovery&access_token=example')), '/reset-password#type=recovery&access_token=example');
  assert.equal(recoveryCallbackPath(new URL('https://survey-route.com/reset-password#type=recovery')), null);
  assert.equal(recoveryCallbackPath(new URL('https://survey-route.com/#type=signup')), null);
});

test('an ordinary sign-in session never counts as password recovery', () => {
  const tracker = createRecoveryTracker(storage(), () => now);
  tracker.handleAuthEvent('SIGNED_IN', session);
  assert.equal(tracker.userIdFor(session), null);
});

test('verified recovery survives a reload in the same tab and expires', () => {
  const saved = storage();
  const tracker = createRecoveryTracker(saved, () => now);
  tracker.handleAuthEvent('PASSWORD_RECOVERY', session);
  assert.equal(createRecoveryTracker(saved, () => now).userIdFor(session), 'reset-user');
  assert.equal(createRecoveryTracker(saved, () => now + 3600001).userIdFor(session), null);
});

test('a new or expired link cannot fall back to a previous recovery session', () => {
  for (const hash of ['#type=recovery&access_token=invalid', '#error=access_denied&error_code=otp_expired']) {
    const tracker = createRecoveryTracker(storage(), () => now);
    tracker.handleAuthEvent('PASSWORD_RECOVERY', session);
    tracker.beginCallback(new URL('https://survey-route.com/reset-password' + hash));
    tracker.handleAuthEvent('INITIAL_SESSION', session);
    assert.equal(tracker.userIdFor(session), null);
  }
});

test('sign-out and switching users invalidate the recovery form', () => {
  const tracker = createRecoveryTracker(storage(), () => now);
  tracker.handleAuthEvent('PASSWORD_RECOVERY', session);
  tracker.handleAuthEvent('SIGNED_OUT', null);
  assert.equal(tracker.userIdFor(session), null);
  tracker.handleAuthEvent('PASSWORD_RECOVERY', session);
  tracker.handleAuthEvent('SIGNED_IN', { ...session, user: { id: 'other-user' } });
  assert.equal(tracker.userIdFor(session), null);
});

test('successful password submission clears recovery state', async () => {
  const tracker = createRecoveryTracker(storage(), () => now);
  tracker.handleAuthEvent('PASSWORD_RECOVERY', session);
  let updated = false;
  const auth = { getSession: async () => ({ data: { session }, error: null }), updateUser: async () => { updated = true; return { error: null }; } };
  assert.equal(await completePasswordReset(auth, tracker, session.user.id, 'test-only-password'), true);
  assert.equal(updated, true);
  assert.equal(tracker.userIdFor(session), null);
});

test('a changed session cannot update the wrong account password', async () => {
  const tracker = createRecoveryTracker(storage(), () => now);
  tracker.handleAuthEvent('PASSWORD_RECOVERY', session);
  let updated = false;
  const auth = { getSession: async () => ({ data: { session: { ...session, user: { id: 'other-user' } } }, error: null }), updateUser: async () => { updated = true; return { error: null }; } };
  assert.equal(await completePasswordReset(auth, tracker, session.user.id, 'test-only-password'), false);
  assert.equal(updated, false);
});

test('update failures are surfaced and allow a retry', async () => {
  const tracker = createRecoveryTracker(storage(), () => now);
  tracker.handleAuthEvent('PASSWORD_RECOVERY', session);
  const auth = { getSession: async () => ({ data: { session }, error: null }), updateUser: async () => ({ error: new Error('Network unavailable') }) };
  await assert.rejects(completePasswordReset(auth, tracker, session.user.id, 'test-only-password'), /Network unavailable/);
  assert.equal(tracker.userIdFor(session), session.user.id);
});
