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

import { pickLatestDraft, alignResponses, isDeviceBackupNewer, formatDraftTimestamp } from '../src/utils/inspectionDraft.ts';

test('the latest unsubmitted draft for the facility opens, even with several drafts', () => {
  const rows = [
    { id: 'old', facility_id: 'f1', status: 'draft', updated_at: '2026-10-28T10:00:00Z' },
    { id: 'done', facility_id: 'f1', status: 'completed', updated_at: '2026-10-29T12:00:00Z' },
    { id: 'new', facility_id: 'f1', status: 'draft', updated_at: '2026-10-29T09:00:00Z' },
    { id: 'other', facility_id: 'f2', status: 'draft', updated_at: '2026-10-29T13:00:00Z' },
  ];
  assert.equal(pickLatestDraft(rows, 'f1')?.id, 'new');
  assert.equal(pickLatestDraft(rows, 'f3'), null);
});

test('saved answers line up with the template by question id', () => {
  const blank = (id) => ({ question_id: id, answer: null });
  const aligned = alignResponses([{ id: 'q1' }, { id: 'q2' }], [{ question_id: 'q2', answer: 'no' }, { question_id: 'gone', answer: 'yes' }], blank);
  assert.deepEqual(aligned, [{ question_id: 'q1', answer: null }, { question_id: 'q2', answer: 'no' }]);
  assert.deepEqual(alignResponses([{ id: 'q1' }], null, blank), [{ question_id: 'q1', answer: null }]);
});

test('a device backup written alongside an autosave does not count as newer', () => {
  assert.equal(isDeviceBackupNewer('2026-10-29T10:00:01Z', '2026-10-29T10:00:00Z'), false);
  assert.equal(isDeviceBackupNewer('2026-10-29T10:05:00Z', '2026-10-29T10:00:00Z'), true);
  assert.equal(isDeviceBackupNewer('2026-10-29T10:05:00Z', null), true);
});

test('draft banner timestamps read naturally', () => {
  const now = new Date(2026, 9, 29, 15, 0);
  assert.match(formatDraftTimestamp(new Date(2026, 9, 29, 9, 14), now), /^Today 9:14\sAM$/);
  assert.match(formatDraftTimestamp(new Date(2026, 9, 28, 16, 2), now), /^Yesterday 4:02\sPM$/);
  assert.match(formatDraftTimestamp(new Date(2026, 9, 27, 16, 2), now), /^Oct 27, 4:02\sPM$/);
});
