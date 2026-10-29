import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeInspectionIdentity, resolveInspectionIdentity } from '../src/utils/inspectionIdentity.ts';

const formSource = await readFile(new URL('../src/components/InspectionForm.tsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261029162000_inspection_identity.sql', import.meta.url), 'utf8');

test('inspection identity normalizes the contact email without changing login identity', () => {
  assert.deepEqual(normalizeInspectionIdentity({
    fullName: ' Israel Hindman ',
    inspectionEmail: ' Israel@BaberEnvironmental.com ',
  }), {
    fullName: 'Israel Hindman',
    inspectionEmail: 'israel@baberenvironmental.com',
  });
});

test('profile name takes priority while legacy signature and draft names remain safe fallbacks', () => {
  assert.deepEqual(resolveInspectionIdentity(
    { fullName: 'Israel Hindman', inspectionEmail: 'israel@baberenvironmental.com' },
    'Agency Owner',
    'Draft',
  ), {
    inspectorName: 'Israel Hindman',
    inspectorEmail: 'israel@baberenvironmental.com',
  });
  assert.equal(resolveInspectionIdentity(null, 'Legacy Signer', 'Draft').inspectorName, 'Legacy Signer');
  assert.equal(resolveInspectionIdentity(null, null, 'Existing Inspector').inspectorName, 'Existing Inspector');
});

test('draft and completion saves snapshot both inspector name and email', () => {
  assert.equal((formSource.match(/inspector_email: resolvedIdentity\.inspectorEmail/g) || []).length, 2);
  assert.equal((formSource.match(/inspector_name: resolvedIdentity\.inspectorName/g) || []).length, 2);
});

test('identity migration is additive and does not rewrite historical records', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS inspection_email/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS inspector_email/i);
  assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE|DROP|UPDATE)\b/i);
});

import { inspectionAuthorship } from '../src/utils/inspectionIdentity.ts';

test('a shared draft keeps the name of whoever started it while others edit', () => {
  const me = { inspectorName: 'Jordan Ray', inspectorEmail: 'jordan@example.test' };
  const draft = { inspector_name: 'Sam Lee', inspector_email: 'sam@example.test' };
  assert.deepEqual(inspectionAuthorship('draft', me, draft), { inspectorName: 'Sam Lee', inspectorEmail: 'sam@example.test' });
  assert.deepEqual(inspectionAuthorship('draft', me, null), me);
  assert.deepEqual(inspectionAuthorship('draft', me, { inspector_name: 'Draft' }), me);
});

test('submitting someone else\'s draft records the submitter, not the starter', () => {
  const me = { inspectorName: 'Jordan Ray', inspectorEmail: 'jordan@example.test' };
  assert.deepEqual(inspectionAuthorship('completed', me, { inspector_name: 'Sam Lee', inspector_email: 'sam@example.test' }), me);
});
