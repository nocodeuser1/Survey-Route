import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SITE_VISIT_CHECKLIST, DRAIN_VALVES_ITEM_ID, countDone,
  getChecklistAnswer, isYesNoItem, makeItemId, normalizeChecklist,
  normalizeProgress, setChecklistAnswer,
} from '../src/utils/siteVisitChecklist.ts';

const id = DRAIN_VALVES_ITEM_ID;
const at = '2026-10-02T15:00:00.000Z';
const later = '2026-10-02T15:01:00.000Z';
const key = `__answer:${id}`;
const items = normalizeChecklist(null);

test('only the drain-valve presence item is Yes/No, including saved and renamed templates', () => {
  assert.deepEqual(items.filter(isYesNoItem).map(i => i.id), [id]);
  assert.equal(isYesNoItem(normalizeChecklist([{ id, label: 'Custom drain question' }])[0]), true);
  assert.equal(isYesNoItem({ id: 'drain_valve_condition', label: 'Drain photo' }), false);
  assert.deepEqual(normalizeChecklist([]), []);
  assert.deepEqual(normalizeChecklist([{ id: 'custom', label: 'Custom check' }]), [{ id: 'custom', label: 'Custom check' }]);
  assert.deepEqual(normalizeChecklist('invalid'), DEFAULT_SITE_VISIT_CHECKLIST);
});

test('legacy unchecked and checked records never imply Yes or No', () => {
  for (const raw of [null, {}, { [id]: at }]) {
    const progress = normalizeProgress(raw);
    assert.equal(getChecklistAnswer(progress, id), null);
    assert.equal(countDone(items, progress), 0);
  }
  assert.deepEqual(normalizeProgress({ [id]: at }), { [id]: at });
});

test('Yes and No each roundtrip as an explicit completed answer', () => {
  for (const value of ['yes', 'no'] as const) {
    const progress = setChecklistAnswer({ ground_photos: at }, id, value, later);
    const reloaded = normalizeProgress(JSON.parse(JSON.stringify(progress)));
    assert.equal(getChecklistAnswer(reloaded, id), value);
    assert.equal(reloaded[id], later);
    assert.equal(reloaded.ground_photos, at);
    assert.equal(countDone(items, reloaded), 2);
  }
});

test('changing and clearing an answer preserves other checklist ticks', () => {
  const original = { ground_photos: at, [id]: at };
  const yes = setChecklistAnswer(original, id, 'yes', at);
  const no = setChecklistAnswer(yes, id, 'no', later);
  assert.equal(getChecklistAnswer(no, id), 'no');
  assert.deepEqual(setChecklistAnswer(no, id, null), { ground_photos: at });
  assert.deepEqual(original, { ground_photos: at, [id]: at });
  assert.equal(countDone(items, {}), 0);
});

test('older clients preserve Yes/No strings while toggling an unrelated checkbox', () => {
  const saved = setChecklistAnswer({}, id, 'no', at);
  // Exact value filtering used by the pre-Yes/No normalizeProgress.
  const oldClient = Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === 'string' && v));
  oldClient.ground_photos = later;
  assert.equal(getChecklistAnswer(normalizeProgress(oldClient), id), 'no');
  assert.equal(countDone(items, oldClient), 2);
});

test('old-client uncheck/recheck never revives a stale answer', () => {
  const saved = setChecklistAnswer({}, id, 'yes', at);
  delete saved[id];
  assert.equal(getChecklistAnswer(saved, id), null);
  saved[id] = later;
  assert.equal(getChecklistAnswer(saved, id), null);
  assert.equal(countDone(items, saved), 0);
});

test('malformed or mismatched response metadata is unanswered', () => {
  for (const raw of ['no', '{', 'null', '[]', '{}',
    JSON.stringify({ answer: true, answeredAt: at }),
    JSON.stringify({ answer: 'no', answeredAt: later }),
    JSON.stringify({ answer: 'yes', answeredAt: '' }),
    JSON.stringify({ answer: 'yes', answeredAt: 123 }),
  ]) {
    assert.equal(getChecklistAnswer({ [id]: at, [key]: raw }, id), null);
  }
  assert.equal(getChecklistAnswer({ [key]: JSON.stringify({ answer: 'yes', answeredAt: at }) }, id), null);
  assert.equal(getChecklistAnswer({ [id]: 'not-a-date', [key]: JSON.stringify({ answer: 'no', answeredAt: 'not-a-date' }) }, id), null);
});

test('reserved answer metadata cannot become a checkbox or affect totals', () => {
  assert.equal(normalizeChecklist([{ id: 'ground_photos', label: 'Photos' }, { id: key, label: 'Metadata' }]).length, 1);
  const saved = setChecklistAnswer({}, id, 'no', at);
  assert.equal(countDone([], saved), 0);
  assert.equal(countDone([{ id: 'ground_photos', label: 'Photos' }], saved), 0);
  assert.equal(makeItemId('__answer:drain_valves_presence', new Set()).includes(':'), false);
});

test('normalization retains legacy and orphaned string records, rejecting invalid containers', () => {
  assert.deepEqual(normalizeProgress({ [id]: at, orphan: later, empty: '', bool: false, object: {}, nil: null }), { [id]: at, orphan: later });
  for (const raw of [null, [], false, 'bad']) assert.deepEqual(normalizeProgress(raw), {});
});
