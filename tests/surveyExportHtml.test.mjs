import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSurveysExportHtml } from '../src/utils/surveyExportHtml.ts';

const questions = [
  { id: 'q1', text: 'Drip pans <dry>?' },
  { id: 'q2', text: 'Tanks labeled?' },
  { id: 'q3', text: 'General notes', type: 'comment' },
];
const inspection = {
  id: 'i1', facility_id: 'f1', conducted_at: '2026-10-29T15:00:00Z',
  inspector_name: 'Jordan <Ray>', inspector_email: 'jr@example.test',
  signature_data: 'data:image/png;base64,SIG',
  responses: [
    { question_id: 'q1', answer: 'no', comments: 'Pan full & dirty', action_required: true, action_notes: 'Drain <now>',
      events: [{ id: 'e2', description: 'Drained', photo_ids: ['p3'] }] },
    { question_id: 'q2', answer: 'yes', comments: '', action_required: true, action_notes: 'stale' },
    { question_id: 'q3', answer: null, comments: 'Site was quiet', action_required: false, action_notes: '' },
  ],
};
const facilities = [{ id: 'f1', name: 'Ash <1WH>', address: null, latitude: 37.1, longitude: -97.2 }];
const photos = ['p1', 'p2', 'p3'].map(id => ({ id, question_id: 'q1', photo_url: `data:image/jpeg;base64,${id}` }));

const html = buildSurveysExportHtml({ title: 'Reports <2026>', inspections: [inspection], facilities, questions, photosByInspection: new Map([['i1', photos]]) });
const section = (from, to) => html.slice(html.indexOf(from), to ? html.indexOf(to) : undefined);

test('export renders real responses against template questions, escaped', () => {
  assert.match(html, /Drip pans &lt;dry&gt;\?/);
  assert.match(html, /Ash &lt;1WH&gt;/);
  assert.match(html, /Pan full &amp; dirty/);
  assert.match(html, /Jordan &lt;Ray&gt;/);
  assert.doesNotMatch(html, /<dry>|<Ray>|<1WH>|<now>|<2026>/);
  assert.doesNotMatch(html, /undefined/);
});

test('export groups photos by event', () => {
  const q1 = section('Drip pans', 'Tanks labeled');
  const [e1, e2] = q1.split('Event 2</div>');
  assert.match(e1, /Event 1/);
  assert.deepEqual(e1.match(/base64,p\d/g) || [], ['base64,p1', 'base64,p2']);
  assert.match(e2, /Drained/);
  assert.deepEqual(e2.match(/base64,p\d/g) || [], ['base64,p3']);
});

test('export shows Action Required only for "no"; comment questions get no answer badge', () => {
  assert.match(section('Drip pans', 'Tanks labeled'), /Action Required<\/em>: Drain &lt;now&gt;/);
  assert.doesNotMatch(section('Tanks labeled', 'General notes'), /Action Required/);
  assert.match(section('Tanks labeled', 'General notes'), /class="answer answer-yes"/);
  const notes = section('General notes');
  assert.match(notes, /Site was quiet/);
  assert.doesNotMatch(notes.split('Inspector Signature')[0], /class="answer/);
});

test('export signature comes from signature_data with inspector name/email', () => {
  const sig = section('Inspector Signature:');
  assert.match(sig, /src="data:image\/png;base64,SIG"/);
  assert.match(sig, /jr@example\.test/);
});

test('export of an inspection without signature or responses still renders', () => {
  const out = buildSurveysExportHtml({ title: 't', inspections: [{ id: 'i2', facility_id: 'f1', conducted_at: '2026-01-01T00:00:00Z', inspector_name: 'A', responses: null, signature_data: null }], facilities, questions, photosByInspection: new Map() });
  assert.match(out, /No responses recorded/);
  assert.doesNotMatch(out, /Inspector Signature/);
});
