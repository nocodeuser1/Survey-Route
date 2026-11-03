/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/signage-test-tools/node_modules/jsdom/lib/api.js node tests/inspectionSignageReports.integration.mjs
 * Optional SIGNAGE_EVIDENCE_DIR saves generated HTML; SIGNAGE_FIXTURE supplies a synthetic PNG.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'inspection-events-qa-'));
const template = { id: 't1', name: 'SPCC Inspection', questions: [{ id: 'q1', text: 'Drip pans dry?', category: 'Containment' }] };
const responses = [{
  question_id: 'q1', answer: 'no', comments: 'Drip pan 1/3 full of rain water', action_required: false, action_notes: '',
  events: [{ id: 'e2', description: 'Pan drained & <re>checked', photo_ids: ['p3'] }],
}];
const photoRows = ['p1', 'p2', 'p3'].map((id, i) => ({ id, inspection_id: 'i1', question_id: 'q1', photo_url: `i1/q1/${id}.jpg`, file_name: `${id}.jpg`, file_size: 1, created_at: `2026-10-29T10:0${3 - i}:00Z` }));
const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import InspectionForm from './src/components/InspectionForm';
import InspectionViewer from './src/components/InspectionViewer';
import InspectionReportExport from './src/components/InspectionReportExport';
const facility = { id: 'f1', name: 'Ash 1WH' };
createRoot(document.getElementById('root')).render(window.qa.view === 'form'
  ? <InspectionForm facility={facility} userId="auth-1" accountId="acct" teamNumber={1} initialDraft={window.qa.draft} onClose={() => {}} />
  : window.qa.view === 'export'
    ? <InspectionReportExport facilities={[facility]} userId="u1" accountId="acct" />
    : <InspectionViewer inspection={window.qa.completed} facility={facility} onClose={() => {}} onClone={() => {}} userId="u1" accountId="acct" />);`;
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
const type = async (el, value) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await delay(30);
};

const evidenceDir = process.env.SIGNAGE_EVIDENCE_DIR;
if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const image = 'data:image/png;base64,' + (process.env.SIGNAGE_FIXTURE ? (await readFile(process.env.SIGNAGE_FIXTURE)).toString('base64') : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=');
const completed = { id: 'i1', facility_id: 'f1', account_id: 'acct', status: 'completed', conducted_at: '2026-10-29T10:00:00Z', created_at: '2026-10-29T10:00:00Z', inspector_name: 'Synthetic Inspector', responses, flagged_items_count: 1, actions_count: 0 };
try {
  for (const present of [false, true]) {
    const signage = { id: 's1', inspection_id: 'i1', question_id: '__facility_signage__', photo_url: image, file_name: 'NOT_FOR_DISPLAY.png', created_at: '2026-11-02T12:34:56Z' };
    await render({ view: 'export', rows: { inspections: [completed], inspection_photos: present ? [signage] : [], inspection_templates: template, user_settings: null, accounts: {} } });
    await delay(200);
    dom.window.URL.createObjectURL = blob => { dom.window.qa.blob = blob; return 'blob:qa'; };
    dom.window.URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () {};
    { const all = [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === 'Select All'); if (all.getAttribute('aria-pressed') !== 'true') all.click(); }
    await delay(30);
    [...doc().querySelectorAll('button')].find(b => /^Export 1 Report \(HTML\)$/.test(b.textContent.trim())).click();
    await delay(100);
    const html = await new Promise((resolve, reject) => { const r = new dom.window.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(dom.window.qa.blob); });
    const parsed = new JSDOM(html);
    assert.equal(parsed.window.document.querySelectorAll('figure.facility-signage').length, present ? 1 : 0);
    assert.doesNotMatch(html, /2026-11-02|12:34:56|NOT_FOR_DISPLAY/);
    if (present) {
      assert.equal(parsed.window.document.querySelector('figure img').src, image);
      assert.match(html, /max-height: 140px; object-fit: contain/);
      assert.match(html, /\.facility-signage \{[^}]*break-inside: avoid/);
    }
    if (evidenceDir) await writeFile(join(evidenceDir, `inspection-${present ? 'with' : 'without'}-signage.html`), html);
    parsed.window.close();
  }
  const signage = { id: 's1', inspection_id: 'i1', question_id: '__facility_signage__', photo_url: image };
  await render({ view: 'export', rows: { inspections: [completed, { ...completed, id: 'i2' }], inspection_photos: [signage], inspection_templates: template, user_settings: null, accounts: {} } });
  await delay(200);
  dom.window.URL.createObjectURL = blob => { dom.window.qa.blob = blob; return 'blob:qa'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  { const all = [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === 'Select All'); if (all.getAttribute('aria-pressed') !== 'true') all.click(); }
  await delay(30);
  [...doc().querySelectorAll('label')].find(l => l.textContent.includes('Create Combined Report')).querySelector('input').click();
  await delay(30);
  [...doc().querySelectorAll('button')].find(b => /^Export Combined Report/.test(b.textContent.trim())).click();
  await delay(100);
  const combinedHtml = await new Promise((resolve, reject) => { const r = new dom.window.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(dom.window.qa.blob); });
  const combined = new JSDOM(combinedHtml);
  assert.equal(combined.window.document.querySelectorAll('.report-page').length, 2);
  assert.equal(combined.window.document.querySelectorAll('figure.facility-signage').length, 1, 'only the inspection with a photo gains signage');
  if (evidenceDir) await writeFile(join(evidenceDir, 'combined-signage.html'), combinedHtml);
  combined.window.close();
  console.log('PASS: inspection HTML/print export includes compact undated signage only when present.');
} finally { dom?.window.close(); }
