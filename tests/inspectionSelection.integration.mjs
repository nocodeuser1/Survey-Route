/** Synthetic DOM integration for export selection indicators. No customer data or writes.
 * JSDOM_MODULE=/path/to/jsdom/lib/api.js node tests/inspectionSelection.integration.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'inspection-events-qa-'));
const template = { id: 't1', name: 'SPCC Inspection', questions: [{ id: 'q1', text: 'Drip pans dry?', category: 'Containment' }] };
const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import InspectionReportExport from './src/components/InspectionReportExport';
const facility = { id: 'f1', name: 'Ash 1WH' };
createRoot(document.getElementById('root')).render(<InspectionReportExport facilities={window.qa.facilities || [facility]} userId="u1" accountId="acct" />);`;
const mockClient = `
const raw = (table) => window.qa.rows[table];
export const supabase = {
 from(table) { const filters = []; let mutation = null;
   // Array fixtures honor .eq() so lookups by the wrong id find nothing.
   const rows = () => { const r = raw(table); return Array.isArray(r) ? r.filter(row => filters.every(([k, v]) => !(k in row) || row[k] === v)) : r; };
   const chain = {
   select() { return this }, eq(k, v) { filters.push([k, v]); return this }, gte() { return this }, in() { return this }, order() { return this }, limit() { return this },
   update(payload) { mutation = { type: 'update', payload }; return this },
   insert(payload) { mutation = { type: 'insert', payload }; return this }, delete() { return this },
   async single() {
     if (table === 'inspections' && mutation) {
       const saved = { ...mutation.payload, id: window.qa.savedInspectionId || 'saved-i1', created_at: '2026-10-29T22:40:00Z', updated_at: mutation.payload.updated_at };
       window.qa.savedInspection = saved;
       return { data: saved, error: null };
     }
     const r = rows(); return { data: Array.isArray(r) ? r[0] ?? null : r ?? null, error: null };
   },
   async maybeSingle() { return this.single() },
   then(resolve, reject) { const r = rows(); return Promise.resolve({ data: Array.isArray(r) ? r : r ? [r] : [], error: null }).then(resolve, reject) },
 }; return chain; },
 storage: { from() { return {
   async createSignedUrl(path) { return { data: { signedUrl: 'https://signed.test/' + path }, error: null } },
   async createSignedUrls(paths) { return { data: paths.map(p => ({ signedUrl: 'https://signed.test/' + p })), error: null } },
   async download(path) { return path.includes('broken') ? { data: null, error: { message: 'missing' } } : { data: new Blob(['img:' + path], { type: 'image/jpeg' }), error: null } },
   async remove() { return { data: null, error: null } },
 } } },
};`;
await build({stdin:{contents:app,loader:'jsx',resolveDir:root},outfile:join(output,'app.js'),bundle:true,format:'iife',jsx:'automatic',logLevel:'error',plugins:[{name:'mock-services',setup(plugin){
 plugin.onResolve({filter:/(?:lib\/supabase|contexts\/(?:AuthContext|AccountContext))$/},args=>({path:args.path,namespace:'mock'}));
 plugin.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:
   args.path.endsWith('AuthContext') ? 'export const useAuth=()=>({user:{id:"profile-1",email:"qa@example.test"}});'
   : args.path.endsWith('AccountContext') ? 'export const useAccount=()=>({accountRole:"user"});'
   : mockClient, loader:'js', resolveDir:root}));
}}]});

let dom;
const doc = () => dom.window.document;
async function render(qa) {
  dom?.window.close();
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true });
  Object.assign(dom.window, { alert() {}, confirm: () => true });
  dom.window.localStorage.setItem('survey-route:inspection-template:v1:acct', JSON.stringify(template));
  dom.window.qa = qa;
  dom.window.eval(await readFile(join(output, 'app.js'), 'utf8'));
  await delay(120);
}
const button = text => [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === text);
const state = () => [button('Latest Only').getAttribute('aria-pressed'), button('Select All').getAttribute('aria-pressed')];
const rows = () => [...doc().querySelectorAll('label')].filter(el => !el.textContent.includes('Create Combined Report'));
const click = async el => { el.click(); await delay(30); };
const inspections = [
  { id: 'new-a', facility_id: 'f1', conducted_at: '2026-11-02T12:00:00Z', inspector_name: 'Latest A', status: 'completed', responses: [] },
  { id: 'old-a', facility_id: 'f1', conducted_at: '2026-10-01T12:00:00Z', inspector_name: 'Older A', status: 'completed', responses: [] },
  { id: 'new-b', facility_id: 'f2', conducted_at: '2026-11-01T12:00:00Z', inspector_name: 'Latest B', status: 'completed', responses: [] },
];
const setup = async data => {
  await render({ view: 'export', facilities: [{ id: 'f1', name: 'Synthetic North' }, { id: 'f2', name: 'Synthetic South' }], rows: { inspections: data, inspection_photos: [], inspection_templates: template, user_settings: null, accounts: {} } });
  await delay(200);
};
try {
  await setup(inspections);
  assert.deepEqual(state(), ['true', 'mixed']);
  assert.match(doc().querySelector('[role="status"]').textContent, /2 of 3 inspections selected/);
  await click(button('Latest Only'));
  assert.deepEqual(state(), ['false', 'false']);
  assert.equal(button('Clear All').disabled, true);
  await click(button('Latest Only'));
  assert.deepEqual(state(), ['true', 'mixed']);
  await click(rows().find(el => el.textContent.includes('Older A')).querySelector('input'));
  assert.deepEqual(state(), ['false', 'true']);
  await click(button('Select All'));
  assert.deepEqual(state(), ['false', 'false']);
  await click(button('Select All'));
  assert.deepEqual(state(), ['false', 'true']);
  await click(rows().find(el => el.textContent.includes('Older A')).querySelector('input'));
  assert.deepEqual(state(), ['true', 'mixed']);
  await click(rows().find(el => el.textContent.includes('Latest B')).querySelector('input'));
  assert.deepEqual(state(), ['false', 'mixed']);
  await click(button('Latest Only'));
  assert.deepEqual(state(), ['true', 'mixed']);
  const search = doc().querySelector('input[placeholder^="Search"]');
  const setSearch = async text => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, text);
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await delay(30);
  };
  await setSearch('no match');
  assert.equal(rows().length, 0);
  assert.deepEqual(state(), ['true', 'mixed']);
  await click(button('Select All'));
  assert.deepEqual(state(), ['false', 'true']);
  assert.match(doc().querySelector('[role="status"]').textContent, /3 of 3.*including inspections hidden by search/);
  await setSearch('');
  assert.equal(rows().filter(el => el.querySelector('input').checked).length, 3);
  await click(button('Clear All'));
  assert.deepEqual(state(), ['false', 'false']);
  for (const text of ['Latest Only', 'Select All', 'Clear All']) {
    assert.match(button(text).className, /min-h-\[44px\]/);
    assert.match(button(text).className, /focus-visible:ring-2/);
    assert.equal(button(text).type, 'button');
  }
  assert.ok(doc().querySelector('[role="group"][aria-label="Inspection selection"]'));
  await setup(inspections.filter(i => i.id !== 'old-a'));
  assert.deepEqual(state(), ['true', 'true']);
  await click(button('Select All'));
  assert.deepEqual(state(), ['false', 'false']);
  await click(button('Latest Only'));
  assert.deepEqual(state(), ['true', 'true']);
  await setup([]);
  assert.match(doc().body.textContent, /No completed inspections to export/);
  assert.equal(button('Select All'), undefined);
  console.log('PASS: derived selection states, individual changes, toggles/repeated clicks, latest/all equivalence, clear/empty/mixed/search, and accessible controls');
} finally { dom?.window.close(); }
