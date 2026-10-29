import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupResponseEvents, reportableEvents, claimPhotosForEvent, releasePhoto, stripPhotosForClone, assignAddedPhotosToEvents, deleteInspectionEvent,
} from '../src/utils/inspectionEvents.ts';
import { escapeHtml } from '../src/utils/escapeHtml.ts';

const photos = [{ id: 'p3' }, { id: 'p2' }, { id: 'p1' }];

test('an inspection saved before events reads as one event: comments plus all photos', () => {
  const groups = groupResponseEvents({ comments: 'Drip pan full' }, photos);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].description, 'Drip pan full');
  assert.deepEqual(groups[0].photos.map(p => p.id), ['p3', 'p2', 'p1']);
});

test('later events claim their photos; the rest stay with event 1, in photo order', () => {
  const response = {
    comments: 'Leak at valve',
    events: [{ id: 'e2', description: 'Cleanup', photo_ids: ['p1', 'p3'] }],
  };
  const groups = groupResponseEvents(response, photos);
  assert.deepEqual(groups.map(g => [g.eventId, g.description, g.photos.map(p => p.id)]), [
    [null, 'Leak at valve', ['p2']],
    ['e2', 'Cleanup', ['p3', 'p1']],
  ]);
});

test('a photo id that no longer exists is ignored, and blank later events are not printed', () => {
  const response = { comments: '', events: [{ id: 'e2', description: '', photo_ids: ['gone'] }, { id: 'e3', description: 'After', photo_ids: [] }] };
  const groups = reportableEvents(groupResponseEvents(response, photos));
  assert.deepEqual(groups.map(g => g.eventId), [null, 'e3']);
  assert.equal(groups[0].photos.length, 3);
});

test('claiming and releasing photos keeps event membership in sync', () => {
  const events = [{ id: 'e2', description: '', photo_ids: ['p1'] }];
  const claimed = claimPhotosForEvent(events, 'e2', ['p4', 'p5']);
  assert.deepEqual(claimed[0].photo_ids, ['p4', 'p5', 'p1']);
  assert.deepEqual(releasePhoto(claimed, 'p5')[0].photo_ids, ['p4', 'p1']);
  assert.equal(releasePhoto(undefined, 'p1'), undefined);
});

test('deleting event 1 promotes event 2 and keeps its photos with the promoted event', () => {
  const response = {
    comments: 'Before cleanup',
    events: [
      { id: 'e2', description: 'After cleanup', photo_ids: ['p2'] },
      { id: 'e3', description: 'Final check', photo_ids: ['p3'] },
    ],
  };
  const next = deleteInspectionEvent(response, null);
  assert.equal(next.comments, 'After cleanup');
  assert.deepEqual(next.events, [{ id: 'e3', description: 'Final check', photo_ids: ['p3'] }]);
  assert.deepEqual(groupResponseEvents(next, photos).map(group => [group.description, group.photos.map(photo => photo.id)]), [
    ['After cleanup', ['p2', 'p1']],
    ['Final check', ['p3']],
  ]);
});

test('deleting a later event closes the numbering gap without changing the others', () => {
  const response = {
    comments: 'Event one',
    events: [
      { id: 'e2', description: 'Event two', photo_ids: ['p2'] },
      { id: 'e3', description: 'Event three', photo_ids: ['p3'] },
    ],
  };
  assert.deepEqual(deleteInspectionEvent(response, 'e2').events, [
    { id: 'e3', description: 'Event three', photo_ids: ['p3'] },
  ]);
});

test('cloning keeps event text but not the source inspection\'s photos', () => {
  const cloned = stripPhotosForClone({ comments: 'x', photos: [{ id: 'p1' }], events: [{ id: 'e2', description: 'y', photo_ids: ['p1'] }] });
  assert.deepEqual(cloned.photos, []);
  assert.deepEqual(cloned.events, [{ id: 'e2', description: 'y', photo_ids: [] }]);
});

test('report text is escaped before going into generated HTML', () => {
  assert.equal(escapeHtml('Tank <A> & "B"'), 'Tank &lt;A&gt; &amp; &quot;B&quot;');
  assert.equal(escapeHtml(null), '');
});

test('photos added in admin edit go to the chosen event; event 1 and unknown events stay unclaimed', () => {
  const responses = [
    { question_id: 'q1', comments: 'Leak', events: [{ id: 'e2', description: 'Fix', photo_ids: ['p1'] }] },
    { question_id: 'q2', comments: '' },
  ];
  const out = assignAddedPhotosToEvents(responses, [
    { questionId: 'q1', eventId: 'e2', photoId: 'n1' },
    { questionId: 'q1', eventId: 'e2', photoId: 'n2' },
    { questionId: 'q1', eventId: null, photoId: 'n3' },
    { questionId: 'q1', eventId: 'gone', photoId: 'n4' },
    { questionId: 'q2', eventId: null, photoId: 'n5' },
  ]);
  assert.deepEqual(out[0].events[0].photo_ids, ['n2', 'n1', 'p1']);
  assert.equal(out[1], responses[1]);
  const groups = groupResponseEvents(out[0], [{ id: 'n4' }, { id: 'n3' }, { id: 'n2' }, { id: 'n1' }, { id: 'p1' }]);
  assert.deepEqual(groups.map(g => g.photos.map(p => p.id)), [['n4', 'n3'], ['n2', 'n1', 'p1']]);
});
