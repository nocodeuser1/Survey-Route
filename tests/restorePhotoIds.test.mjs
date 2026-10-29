import assert from 'node:assert/strict';
import test from 'node:test';
import { remapResponsePhotoIds } from '../src/utils/restorePhotoIds.ts';
import { groupResponseEvents } from '../src/utils/inspectionEvents.ts';

const idMap = new Map([['old-1', 'new-1'], ['old-2', 'new-2'], ['old-3', 'new-3']]);

test('restore remaps event photo ids and drops photos that were not restored', () => {
  const responses = [
    { question_id: 'q1', comments: 'Leak', events: [{ id: 'e2', description: 'Fixed', photo_ids: ['old-3', 'old-gone'] }] },
    { question_id: 'q2', comments: '' },
  ];
  const remapped = remapResponsePhotoIds(responses, idMap);
  assert.deepEqual(remapped[0].events, [{ id: 'e2', description: 'Fixed', photo_ids: ['new-3'] }]);
  assert.equal(remapped[0].comments, 'Leak');
  assert.equal(remapped[1], responses[1]);
  // Restored photos land in the right events again.
  const restoredPhotos = [{ id: 'new-3' }, { id: 'new-2' }, { id: 'new-1' }];
  const groups = groupResponseEvents(remapped[0], restoredPhotos);
  assert.deepEqual(groups.map(g => g.photos.map(p => p.id)), [['new-2', 'new-1'], ['new-3']]);
});

test('restore skips inspections without events', () => {
  assert.equal(remapResponsePhotoIds([{ question_id: 'q1', comments: 'x' }], idMap), null);
  assert.equal(remapResponsePhotoIds(null, idMap), null);
  assert.equal(remapResponsePhotoIds([{ question_id: 'q1', events: [{ id: 'e2', description: 'd', photo_ids: [] }] }], idMap), null);
});
