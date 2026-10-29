import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectInspectionDescriptionHistory,
  MAX_RECENT_DESCRIPTIONS_PER_QUESTION,
  parseInspectionDescriptionHistory,
  rememberInspectionDescription,
} from '../src/utils/inspectionDescriptionHistory.ts';

test('today history stays question-specific and includes descriptions from later events', () => {
  const history = collectInspectionDescriptionHistory([{
    updated_at: '2026-10-29T16:00:00.000Z',
    responses: [
      {
        question_id: 'q1', answer: 'no', comments: 'Oil in drain', action_required: true, action_notes: 'Call cleanup crew',
        events: [{ id: 'e2', description: 'Water under compressor', photo_ids: [] }],
      },
      { question_id: 'q2', answer: 'no', comments: 'Valve corrosion', action_required: false, action_notes: '' },
      { question_id: 'q3', answer: 'yes', comments: 'Do not suggest this', action_required: false, action_notes: '' },
    ],
  }]);

  assert.deepEqual(history.q1.map(entry => entry.text), ['Oil in drain', 'Water under compressor']);
  assert.deepEqual(history.q2.map(entry => entry.text), ['Valve corrosion']);
  assert.equal(history.q3, undefined);
  assert.doesNotMatch(JSON.stringify(history), /Call cleanup crew/);
});

test('remembering a repeated description moves the newest spelling to the front without duplicates', () => {
  const first = rememberInspectionDescription({}, 'q1', '  Oil in drain  ', '2026-10-29T12:00:00.000Z');
  const second = rememberInspectionDescription(first, 'q1', 'oil   in DRAIN', '2026-10-29T13:00:00.000Z');
  assert.deepEqual(second.q1, [{ text: 'oil   in DRAIN', usedAt: '2026-10-29T13:00:00.000Z' }]);
});

test('history parsing is safe and limits every question to the most recent entries', () => {
  let history = {};
  for (let index = 0; index < MAX_RECENT_DESCRIPTIONS_PER_QUESTION + 3; index += 1) {
    history = rememberInspectionDescription(history, 'q1', `Description ${index}`, `2026-10-29T${String(index).padStart(2, '0')}:00:00.000Z`);
  }
  assert.equal(history.q1.length, MAX_RECENT_DESCRIPTIONS_PER_QUESTION);
  assert.equal(history.q1[0].text, `Description ${MAX_RECENT_DESCRIPTIONS_PER_QUESTION + 2}`);
  assert.deepEqual(parseInspectionDescriptionHistory('{not-json'), {});
  assert.deepEqual(parseInspectionDescriptionHistory(JSON.stringify(history)), history);
});
