import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isInvitationExpired } from '../src/utils/invitationStatus.ts';

const teamManagementSource = await readFile(
  new URL('../src/components/TeamManagement.tsx', import.meta.url),
  'utf8',
);
const agencySettingsSource = await readFile(
  new URL('../src/components/AgencySettings.tsx', import.meta.url),
  'utf8',
);

test('a stale pending invitation is treated as expired by its timestamp', () => {
  assert.equal(isInvitationExpired({
    status: 'pending',
    expires_at: '2026-09-18T23:27:57.307Z',
  }, Date.parse('2026-10-29T16:04:28Z')), true);
});

test('an active pending invitation remains sendable without renewal', () => {
  assert.equal(isInvitationExpired({
    status: 'pending',
    expires_at: '2026-11-05T16:04:28Z',
  }, Date.parse('2026-10-29T16:04:28Z')), false);
});

test('resending an expired invitation renews the same row before sending', () => {
  assert.match(teamManagementSource, /if \(wasExpired\) \{[\s\S]*?\.rpc\('renew_invitation'/);
  assert.match(teamManagementSource, /inviteToken: invitationToSend\.token/);
  assert.match(teamManagementSource, /isExpired \? 'Renew & Send' : 'Resend'/);
  assert.match(agencySettingsSource, /if \(wasExpired\) \{[\s\S]*?\.rpc\('renew_invitation'/);
  assert.match(agencySettingsSource, /inviteToken: invitationToSend\.token/);
  assert.match(agencySettingsSource, /expired \? 'Renew & Send' : 'Resend'/);
});
