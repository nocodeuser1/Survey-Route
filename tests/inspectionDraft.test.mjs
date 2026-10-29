import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInspectionInspectorName } from '../src/utils/inspectionDraft.ts';

test('a new draft can be saved without a configured signature', () => {
  assert.equal(resolveInspectionInspectorName(null, null), 'Draft');
});

test('an existing draft keeps its inspector name when no signature is configured', () => {
  assert.equal(resolveInspectionInspectorName(undefined, 'Israel Hindman'), 'Israel Hindman');
});

test('a configured signature takes priority for inspection saves', () => {
  assert.equal(resolveInspectionInspectorName(' Israel Hindman ', 'Draft'), 'Israel Hindman');
});
