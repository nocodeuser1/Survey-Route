/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/exportSurveys.integration.mjs
 *
 * The bulk export (SurveyMode / RouteResults "Export Surveys") prints the
 * real responses, signature, and event-grouped photos.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'export-surveys-qa-'));
const template = { id: 't1', name: 'SPCC Inspection', questions: [
  { id: 'q1', text: 'Drip pans dry?', category: 'Containment' },
  { id: 'q2', text: 'Other notes', category: 'General', type: 'comment' },
] };
const completed = {
  id: 'i1', facility_id: 'f1', status: 'completed', template_id: 't1', inspector_name: 'Jordan Ray', inspector_email: 'jr@example.test',
  conducted_at: '2026-10-29T15:00:00Z', signature_data: 'data:image/png;base64,SIGNATURE', flagged_items_count: 1, actions_count: 1,
  responses: [
    { question_id: 'q1', answer: 'no', comments: 'Pan <full>', action_required: true, action_notes: 'Drain it',
      events: [{ id: 'e2', description: 'Drained', photo_ids: ['p3'] }] },
    { question_id: 'q2', answer: null, comments: 'Quiet day', action_required: false, action_notes: '' },
  ],
};
const photoRows = ['p1', 'p2', 'p3'].map((id, i) => ({ id, inspection_id: 'i1', question_id: 'q1', photo_url: `i1/q1/${id}.jpg`, file_name: `${id}.jpg`, file_size: 1, created_at: `2026-10-29T10:0${3 - i}:00Z` }));
const brokenPhoto = { ...photoRows[0], id: 'p4', photo_url: 'i1/q1/broken.jpg' };

const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ExportSurveys from './src/components/ExportSurveys';
const facility = { id: 'f1', name: 'Ash 1WH', address: '1 Main', latitude: 37, longitude: -97 };
createRoot(document.getElementById('root')).render(
  <ExportSurveys facilityIds={['f1']} facilities={[facility]} userId="u1" accountId="acct" onClose={() => { window.qa.closed = true; }} />);`;
const mockClient = `
const rows = (table) => window.qa.rows[table];
export const supabase = {
 from(table) { const chain = {
   select() { return this }, eq() { return this }, in() { return this }, order() { return this }, limit() { return this },
   async single() { return { data: Array.isArray(rows(table)) ? rows(table)[0] : rows(table) ?? null, error: null } },
   async maybeSingle() { return this.single() },
   then(resolve, reject) { const r = rows(table); return Promise.resolve({ data: Array.isArray(r) ? r : r ? [r] : [], error: null }).then(resolve, reject) },
 }; return chain; },
 storage: { from() { return {
   async download(path) { return path.includes('broken') ? { data: null, error: { message: 'missing' } } : { data: new Blob(['img:' + path], { type: 'image/jpeg' }), error: null } },
 } } },
};`;
await build({ stdin: { contents: app, loader: 'jsx', resolveDir: root }, outfile: join(output, 'app.js'), bundle: true, format: 'iife', jsx: 'automatic', logLevel: 'error', plugins: [{ name: 'mock-services', setup(plugin) {
  plugin.onResolve({ filter: /lib\/supabase$/ }, args => ({ path: args.path, namespace: 'mock' }));
  plugin.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mockClient, loader: 'js', resolveDir: root }));
} }] });

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true });
try {
  const doc = dom.window.document;
  Object.assign(dom.window, { alert(message) { throw new Error('unexpected alert: ' + message); } });
  dom.window.qa = { rows: { inspections: [completed], inspection_photos: [...photoRows, brokenPhoto], inspection_templates: template } };
  dom.window.eval(await readFile(join(output, 'app.js'), 'utf8'));
  await delay(120);
  dom.window.URL.createObjectURL = blob => { dom.window.qa.blob = blob; return 'blob:qa'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  [...doc.querySelectorAll('button')].find(b => /^Export 1 Report \(HTML\)$/.test(b.textContent.trim())).click();
  await delay(200);
  assert.ok(dom.window.qa.blob, 'export produced a file');
  assert.equal(dom.window.qa.closed, true);
  const html = await new Promise((res, rej) => { const r = new dom.window.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(dom.window.qa.blob); });

  assert.match(html, /Drip pans dry\?/);
  assert.match(html, /Pan &lt;full&gt;/);
  assert.match(html, /Action Required<\/em>: Drain it/);
  const q1 = html.slice(html.indexOf('Drip pans dry?'), html.indexOf('Other notes'));
  const [event1, event2] = q1.split('Event 2</div>');
  assert.equal((event1.match(/class="photo"/g) || []).length, 2);
  assert.equal((event2.match(/class="photo"/g) || []).length, 1);
  assert.match(event1, /src="data:image\/jpeg;base64,/);
  assert.doesNotMatch(html, /broken\.jpg/);
  const notes = html.slice(html.indexOf('Other notes'), html.indexOf('Inspector Signature'));
  assert.match(notes, /Quiet day/);
  assert.doesNotMatch(notes, /class="answer/);
  assert.match(html, /Inspector Signature:[\s\S]*data:image\/png;base64,SIGNATURE[\s\S]*Jordan Ray[\s\S]*jr@example\.test/);
  console.log('✓ Bulk export prints responses, event-grouped embedded photos, action notes, and the signature');
} finally {
  dom.window.close();
}
