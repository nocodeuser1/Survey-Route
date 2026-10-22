import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChecklistColumns, buildChecklistFilterFields, checklistColumnId, checklistMatchesSearch, getChecklistColumnText, getChecklistColumnValue } from '../src/utils/checklistColumns.ts';
import { DEFAULT_SITE_VISIT_CHECKLIST, DRUMS_ITEM_ID as drums, DAY_TANKS_ITEM_ID as tanks, DRAIN_VALVES_ITEM_ID as drains, normalizeChecklist, setChecklistAnswer } from '../src/utils/siteVisitChecklist.ts';
import { setContainerInventory } from '../src/utils/containerInventory.ts';
const at = '2026-10-02T19:00:00.000Z';
const columns = buildChecklistColumns(DEFAULT_SITE_VISIT_CHECKLIST);
const column = (id: string, field = 'answer') => columns.find(col => col.id === checklistColumnId(id, field))!;
const value = (id: string, progress: unknown, field = 'answer') => getChecklistColumnValue(column(id, field), progress);
const text = (id: string, progress: unknown, field = 'answer') => getChecklistColumnText(column(id, field), progress);

test('current template supplies every completion answer and timestamp with stable collision-safe IDs', () => {
  const items = normalizeChecklist([...DEFAULT_SITE_VISIT_CHECKLIST, { id: 'custom:photos', label: 'Inspect painted posts' }]);
  const result = buildChecklistColumns(items);
  for (const item of items) {
    assert.ok(result.some(col => col.id === checklistColumnId(item.id)));
    assert.ok(result.some(col => col.id === checklistColumnId(item.id, 'completed_at')));
  }
  assert.equal(new Set(result.map(col => col.id)).size, result.length);
  const renamed = buildChecklistColumns([{ id: 'custom:photos', label: 'Renamed question' }]);
  assert.equal(renamed[0].id, checklistColumnId('custom:photos'));
  assert.match(renamed[0].label, /Renamed question/);
  assert.notEqual(checklistColumnId('custom:photos'), checklistColumnId('custom', 'photos:answer'));
  assert.deepEqual(buildChecklistColumns(normalizeChecklist([])), []);
  assert.equal(buildChecklistColumns([items[0], items[0]]).length, 5);
});

test('presence distinguishes unanswered, explicit No, and Yes without details', () => {
  for (const id of [drums, tanks, drains]) {
    assert.equal(text(id, {}), 'Unanswered');
    assert.equal(text(id, { [id]: at }), 'Unanswered');
    assert.equal(text(id, setChecklistAnswer({}, id, 'no', at)), 'No');
    assert.equal(text(id, setChecklistAnswer({}, id, 'yes', at)), 'Yes');
  }
  const yes = setChecklistAnswer({}, drums, 'yes', at);
  assert.equal(text(drums, yes, 'inventory'), 'Yes · details not recorded');
  assert.equal(value(drums, yes, 'gallons'), null);
  assert.equal(value(drums, yes, 'quantity'), null);
  assert.equal(text(drums, yes, 'gallons'), 'Not recorded');
  const no = setChecklistAnswer({}, drums, 'no', at);
  assert.equal(value(drums, no, 'gallons'), 0);
  assert.equal(value(drums, no, 'quantity'), 0);
  assert.equal(text(drums, no, 'inventory'), 'No');
});

test('size/quantity/fluid associations and numeric totals come only from canonical metadata', () => {
  const progress = setContainerInventory({}, tanks, { answer: 'yes', containers: [
    { gallons: 55, quantity: 3, contents: 'Methanol' },
    { gallons: 55, quantity: 2, contents: 'Lube oil' },
    { gallons: 125.5, quantity: 1, contents: 'Antifreeze' },
  ] }, at);
  assert.equal(value(tanks, progress, 'quantity'), 6);
  assert.equal(value(tanks, progress, 'gallons'), 400.5);
  assert.equal(text(tanks, progress, 'fluids'), 'Methanol (55 gal × 3) · Lube oil (55 gal × 2) · Antifreeze (125.5 gal × 1)');
  assert.match(text(tanks, progress, 'inventory'), /55 gal × 3 \(Methanol\)/);
  assert.ok(checklistMatchesSearch(columns, progress, 'methanol'));
  assert.ok(checklistMatchesSearch(columns, progress, '400.5'));
  assert.ok(checklistMatchesSearch(columns, progress, 'day tanks present yes'));
  assert.equal(checklistMatchesSearch(columns, progress, 'unrelated fluid'), false);
  assert.equal(value(tanks, progress, 'completed_at'), at);
  assert.equal(value(tanks, { [tanks]: at }, 'completed_at'), null);
});

test('stale/malformed metadata cannot revive data or infer No/zero', () => {
  const progress = setContainerInventory({}, drums, { answer: 'yes', containers: [{ gallons: 55, quantity: 3 }] }, at);
  const staleAnswer = { ...progress, [drums]: '2026-10-03T01:00:00Z' };
  assert.equal(text(drums, staleAnswer), 'Unanswered');
  assert.equal(value(drums, staleAnswer, 'quantity'), null);
  const malformed = { ...progress, [`__inventory:${drums}`]: 'bad json' };
  assert.equal(text(drums, malformed), 'Yes');
  assert.equal(text(drums, malformed, 'inventory'), 'Yes · details not recorded');
  assert.equal(value(drums, malformed, 'quantity'), null);
  assert.equal(value(drums, null, 'quantity'), null);
});

test('ordinary/custom checkbox columns do not confuse completion with presence answers', () => {
  assert.equal(text('ground_photos', {}), 'Not completed');
  assert.equal(text('ground_photos', { ground_photos: at }), 'Completed');
  assert.equal(value('ground_photos', { ground_photos: at }, 'completed_at'), at);
  const fields = buildChecklistFilterFields(columns);
  const quantity = fields.find(field => field.id === checklistColumnId(drums, 'quantity'))!;
  const facility = { site_visit_checklist_progress: setChecklistAnswer({}, drums, 'yes', at) };
  assert.equal(quantity.getValue!(facility as never), null);
  assert.ok(quantity.operators.some(op => op.id === 'number_greater'));
  const answer = fields.find(field => field.id === checklistColumnId(drums))!;
  assert.deepEqual(answer.operators[0].valueChoices?.map(choice => choice.value), ['Yes', 'No']);
});
