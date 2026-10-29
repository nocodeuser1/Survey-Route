/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/dataBackupRestore.integration.mjs
 *
 * Restoring a backup gives photos new ids; events must follow them, and the
 * photo rows keep their original created_at so order survives.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const JSZip = createRequire(join(root, 'package.json'))('jszip');
const output = await mkdtemp(join(tmpdir(), 'data-backup-restore-qa-'));

const backup = {
  version: '1', exportDate: '2026-10-29T00:00:00Z', accountId: 'old-acct',
  facilities: [{ id: 'old-f1', name: 'Ash 1WH', latitude: 37, longitude: -97, account_id: 'old-acct' }],
  inspections: [
    { id: 'old-i1', facility_id: 'old-f1', status: 'completed', inspector_name: 'Sam', created_at: 'x', updated_at: 'y', responses: [
      { question_id: 'q1', answer: 'no', comments: 'Leak', action_required: false, action_notes: '',
        events: [{ id: 'e2', description: 'Cleanup', photo_ids: ['old-p3', 'old-missing'] }] },
    ] },
    { id: 'old-i2', facility_id: 'old-f1', status: 'completed', inspector_name: 'Sam', responses: [
      { question_id: 'q1', answer: 'yes', comments: '', action_required: false, action_notes: '' },
    ] },
  ],
  inspectionPhotos: ['old-p1', 'old-p2', 'old-p3'].map((id, i) => ({
    id, inspection_id: 'old-i1', original_inspection_id: 'old-i1', question_id: 'q1',
    photo_url: `old-i1/q1/${id}.jpg`, file_name: `${id}.jpg`, file_size: 1, created_at: `2026-10-29T10:0${i}:00Z`,
  })),
  routePlans: [],
};
const zip = new JSZip();
zip.file('backup.json', JSON.stringify(backup));
for (const photo of backup.inspectionPhotos) zip.file(`photos/${photo.photo_url}`, `img:${photo.id}`);
const zipBytes = await zip.generateAsync({ type: 'uint8array' });

const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import DataBackup from './src/components/DataBackup';
createRoot(document.getElementById('root')).render(<DataBackup accountId="acct" facilities={[]} onFacilitiesChange={() => {}} />);`;
const mockClient = `
const log = () => window.qa.log;
let counter = 0;
export const supabase = {
 from(table) {
   const op = { table, kind: 'select', filters: [] };
   const result = () => {
     if (op.kind === 'insert') {
       const id = 'new-' + table + '-' + (++counter);
       log().push({ ...op, id });
       return { data: { id, ...op.payload }, error: null };
     }
     if (op.kind === 'update') { log().push(op); return { data: null, error: null }; }
     return { data: null, error: null };
   };
   const chain = {
     select() { return this }, order() { return this }, in() { return this },
     eq(col, val) { op.filters.push([col, val]); return this },
     insert(payload) { op.kind = 'insert'; op.payload = payload; return this },
     update(payload) { op.kind = 'update'; op.payload = payload; return this },
     upsert(payload) { op.kind = 'insert'; op.payload = payload; return this },
     async single() { return result() },
     async maybeSingle() { return result() },
     then(res, rej) { return Promise.resolve(result()).then(res, rej) },
   };
   return chain;
 },
 storage: { from(bucket) { return {
   async upload(path) { window.qa.log.push({ table: 'storage:' + bucket, kind: 'upload', path }); return { data: { path }, error: null } },
   getPublicUrl(path) { return { data: { publicUrl: 'https://public.test/' + path } } },
 } } },
};`;
await build({ stdin: { contents: app, loader: 'jsx', resolveDir: root }, outfile: join(output, 'app.js'), bundle: true, format: 'iife', jsx: 'automatic', logLevel: 'error', plugins: [{ name: 'mock-services', setup(plugin) {
  plugin.onResolve({ filter: /lib\/supabase$/ }, args => ({ path: args.path, namespace: 'mock' }));
  plugin.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mockClient, loader: 'js', resolveDir: root }));
} }] });

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true });
try {
  const doc = dom.window.document;
  // JSZip's setImmediate shim waits on postMessage events with a source, which jsdom omits.
  Object.assign(dom.window, { alert() {}, confirm: () => true, setImmediate: (fn, ...args) => dom.window.setTimeout(fn, 0, ...args) });
  dom.window.qa = { log: [] };
  dom.window.eval(await readFile(join(output, 'app.js'), 'utf8'));
  await delay(100);
  const input = doc.querySelector('input[type="file"]');
  const file = new dom.window.File([zipBytes], 'backup.zip', { type: 'application/zip' });
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 200 && !/restored|Restore (complete|failed)|Successfully/i.test(doc.body.textContent); i++) await delay(50);
  await delay(100);

  const log = JSON.parse(JSON.stringify(dom.window.qa.log)); // plain objects from the jsdom realm
  if (process.env.DEBUG) console.log(JSON.stringify(log.map(e => [e.table, e.kind])), doc.body.textContent.slice(500, 1400));
  const photoInserts = log.filter(e => e.table === 'inspection_photos' && e.kind === 'insert');
  assert.equal(photoInserts.length, 3);
  assert.deepEqual(photoInserts.map(e => e.payload.created_at), backup.inspectionPhotos.map(p => p.created_at));
  const newI1 = log.find(e => e.table === 'inspections' && e.kind === 'insert' && e.payload.inspector_name === 'Sam' && e.payload.responses[0].events).id;
  assert.ok(photoInserts.every(e => e.payload.inspection_id === newI1));
  const newP3 = photoInserts[2].id;

  const updates = log.filter(e => e.table === 'inspections' && e.kind === 'update');
  assert.equal(updates.length, 1, 'only the inspection with events is updated');
  assert.deepEqual(updates[0].filters, [['id', newI1]]);
  assert.deepEqual(updates[0].payload.responses[0].events, [{ id: 'e2', description: 'Cleanup', photo_ids: [newP3] }]);
  assert.equal(updates[0].payload.responses[0].comments, 'Leak');
  console.log('✓ Restore remaps event photo ids to the restored photos and keeps photo created_at');
} finally {
  dom.window.close();
}
