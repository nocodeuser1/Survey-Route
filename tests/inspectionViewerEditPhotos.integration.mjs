/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/inspectionViewerEditPhotos.integration.mjs
 *
 * Admin edit mode: photos added to a later event are claimed by that event
 * when saved; photos added to event 1 (or to a question without events) stay
 * unclaimed, exactly as before.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'viewer-edit-photos-qa-'));
const template = { id: 't1', name: 'SPCC Inspection', questions: [
  { id: 'q1', text: 'Drip pans dry?', category: 'Containment' },
  { id: 'q2', text: 'Tanks labeled?', category: 'Containment' },
] };
const completed = {
  id: 'i1', facility_id: 'f1', account_id: 'acct', user_id: 'someone-else', status: 'completed', template_id: 't1',
  inspector_name: 'Jordan Ray', conducted_at: '2026-10-29T10:00:00Z', created_at: '2026-10-29T10:00:00Z', signature_data: null,
  flagged_items_count: 1, actions_count: 0,
  responses: [
    { question_id: 'q1', answer: 'no', comments: 'Leak', action_required: false, action_notes: '',
      events: [{ id: 'e2', description: 'Cleanup', photo_ids: ['p-old'] }] },
    { question_id: 'q2', answer: 'yes', comments: '', action_required: false, action_notes: '' },
  ],
};
const photoRows = [{ id: 'p-old', inspection_id: 'i1', question_id: 'q1', photo_url: 'i1/q1/old.jpg', file_name: 'old.jpg', file_size: 1, created_at: '2026-10-29T10:00:00Z' }];

const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import InspectionViewer from './src/components/InspectionViewer';
createRoot(document.getElementById('root')).render(
  <InspectionViewer inspection={window.qa.completed} facility={{ id: 'f1', name: 'Ash 1WH' }} onClose={() => {}} onClone={() => {}} userId="admin-1" accountId="acct" />);`;
const mockClient = `
let counter = 0;
export const supabase = {
 from(table) {
   const op = { table, kind: 'select', filters: [] };
   const result = (many) => {
     if (op.kind === 'insert') { const id = 'new-photo-' + (++counter); window.qa.log.push({ ...op, id }); return { data: { id }, error: null }; }
     if (op.kind !== 'select') { window.qa.log.push(op); return { data: null, error: null }; }
     const r = window.qa.rows[table];
     return { data: many ? (Array.isArray(r) ? r : r ? [r] : []) : (Array.isArray(r) ? r[0] : r ?? null), error: null };
   };
   return {
     select() { return this }, order() { return this }, in() { return this }, limit() { return this },
     eq(col, val) { op.filters.push([col, val]); return this },
     insert(payload) { op.kind = 'insert'; op.payload = payload; return this },
     update(payload) { op.kind = 'update'; op.payload = payload; return this },
     delete() { op.kind = 'delete'; return this },
     async single() { return result(false) },
     async maybeSingle() { return result(false) },
     then(res, rej) { return Promise.resolve(result(true)).then(res, rej) },
   };
 },
 storage: { from() { return {
   async createSignedUrl(path) { return { data: { signedUrl: 'https://signed.test/' + path }, error: null } },
   async upload(path) { window.qa.log.push({ table: 'storage', kind: 'upload', path }); return { data: { path }, error: null } },
   async remove() { return { data: null, error: null } },
 } } },
};`;
await build({ stdin: { contents: app, loader: 'jsx', resolveDir: root }, outfile: join(output, 'app.js'), bundle: true, format: 'iife', jsx: 'automatic', logLevel: 'error', plugins: [{ name: 'mock-services', setup(plugin) {
  plugin.onResolve({ filter: /(?:lib\/supabase|contexts\/(?:AuthContext|AccountContext))$/ }, args => ({ path: args.path, namespace: 'mock' }));
  plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
    args.path.endsWith('AuthContext') ? 'export const useAuth=()=>({user:{id:"admin-1",email:"qa@example.test"}});'
    : args.path.endsWith('AccountContext') ? 'export const useAccount=()=>({accountRole:"account_admin"});'
    : mockClient, loader: 'js', resolveDir: root }));
} }] });

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true });
const silence = console.log;
console.log = () => {};
try {
  const doc = dom.window.document;
  Object.assign(dom.window, { alert() {}, confirm: () => true });
  dom.window.qa = { log: [], completed, rows: {
    inspection_templates: template, inspection_photos: photoRows, account_users: { role: 'account_admin' },
    user_settings: null, inspections: { account_id: 'acct' }, accounts: {},
  } };
  dom.window.eval(await readFile(join(output, 'app.js'), 'utf8'));
  await delay(150);
  const button = text => [...doc.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
  button('Edit Report').click();
  await delay(50);

  const addLabels = [...doc.querySelectorAll('label')].filter(l => /^Add Photos/.test(l.textContent.trim())).map(l => l.textContent.trim());
  assert.deepEqual(addLabels, ['Add Photos to Event 1', 'Add Photos to Event 2', 'Add Photos'], 'one control per event; questions without events keep a single control');

  const pick = async (labelText, names) => {
    const label = [...doc.querySelectorAll('label')].find(l => l.textContent.trim() === labelText);
    const input = label.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: names.map(n => new dom.window.File(['x'], n, { type: 'image/jpeg' })) });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await delay(30);
  };
  await pick('Add Photos to Event 2', ['a.jpg', 'b.jpg']);
  await pick('Add Photos to Event 1', ['c.jpg']);
  await pick('Add Photos', ['d.jpg']);
  const pending = [...doc.querySelectorAll('[data-new-photo-event]')].map(el => el.getAttribute('data-new-photo-event'));
  assert.deepEqual(pending, ['e2', 'e2', 'event-1', 'event-1']);

  button('Save Changes').click();
  for (let i = 0; i < 40 && !dom.window.qa.log.some(e => e.table === 'inspection_edits'); i++) await delay(25);
  const log = JSON.parse(JSON.stringify(dom.window.qa.log));
  const inserts = log.filter(e => e.table === 'inspection_photos' && e.kind === 'insert');
  assert.deepEqual(inserts.map(e => [e.payload.question_id, e.payload.file_name]), [['q1', 'a.jpg'], ['q1', 'b.jpg'], ['q1', 'c.jpg'], ['q2', 'd.jpg']]);
  const [a, b] = inserts.map(e => e.id);
  const update = log.find(e => e.table === 'inspections' && e.kind === 'update');
  assert.deepEqual(update.payload.responses[0].events, [{ id: 'e2', description: 'Cleanup', photo_ids: [b, a, 'p-old'] }]);
  assert.equal(update.payload.responses[1].events, undefined, 'question without events is unchanged');
  const audit = log.find(e => e.table === 'inspection_edits');
  assert.equal(audit.payload.changes_summary.photosAdded, 4);
  console.log = silence;
  console.log('✓ Admin edit adds photos to the chosen event; event 1 and event-less questions behave as before');
} finally {
  console.log = silence;
  dom.window.close();
}
