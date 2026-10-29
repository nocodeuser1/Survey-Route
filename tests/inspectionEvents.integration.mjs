/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/inspectionEvents.integration.mjs
 *
 * Events: the form edits them per question, and the read-only report shows
 * each event's description with only its own photos underneath.
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
 from(table) { const filters = [];
   // Array fixtures honor .eq() so lookups by the wrong id find nothing.
   const rows = () => { const r = raw(table); return Array.isArray(r) ? r.filter(row => filters.every(([k, v]) => !(k in row) || row[k] === v)) : r; };
   const chain = {
   select() { return this }, eq(k, v) { filters.push([k, v]); return this }, in() { return this }, order() { return this }, limit() { return this },
   update() { return this }, insert() { return this }, delete() { return this },
   async single() { const r = rows(); return { data: Array.isArray(r) ? r[0] ?? null : r ?? null, error: null } },
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
const results = [];
try {
  const draft = { id: 'i1', facility_id: 'f1', status: 'draft', inspector_name: 'Sam Lee', created_at: '2026-10-28T14:00:00Z', updated_at: '2026-10-29T09:30:00Z', responses };
  // Signature saved only in another workspace (e.g. during an invite).
  const signatureElsewhere = { id: 's1', user_id: 'profile-1', account_id: 'other-workspace', signature_name: 'Jordan Ray', signature_data: 'data:image/png;base64,AA==', created_at: '2026-10-29T08:00:00Z' };
  await render({ view: 'form', draft, rows: { inspection_photos: photoRows, inspections: draft, inspection_templates: template, user_signatures: [signatureElsewhere] } });
  const complete = [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === 'Complete');
  assert.equal(complete.disabled, false);
  assert.doesNotMatch(doc().body.textContent, /Signature Required/);
  results.push('A signature saved in another workspace is used, so Complete is enabled');
  const labels = () => [...doc().querySelectorAll('span')].map(s => s.textContent).filter(t => /^Event \d$/.test(t));
  assert.deepEqual(labels(), ['Event 1', 'Event 2']);
  const areas = () => [...doc().querySelectorAll('textarea')];
  assert.deepEqual(areas().map(a => a.value), ['Drip pan 1/3 full of rain water', 'Pan drained & <re>checked']);
  // Photos load async; event 2 owns p3, event 1 keeps the rest.
  const badges = () => [...doc().querySelectorAll('button')].filter(b => b.textContent.startsWith('Add Photo')).map(b => b.textContent.replace('Add Photo', ''));
  assert.deepEqual(badges(), ['2', '1']);
  assert.match(doc().body.textContent, /Started by Sam Lee/);
  results.push('Form shows each event with its own description, photos, and Add Photo; banner names who started the draft');

  [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === 'Add event').click();
  await delay(30);
  assert.deepEqual(labels(), ['Event 1', 'Event 2', 'Event 3']);
  await type(areas()[2], 'After cleanup');
  assert.equal(areas()[2].value, 'After cleanup');
  doc().querySelector('[aria-label="Delete event 3"]').click();
  await delay(30);
  assert.deepEqual(labels(), ['Event 1', 'Event 2']);
  results.push('Events can be added, described, and removed');

  doc().querySelector('[aria-label="Delete event 1"]').click();
  await delay(60);
  assert.deepEqual(labels(), []);
  assert.deepEqual(areas().map(a => a.value), ['Pan drained & <re>checked']);
  assert.deepEqual(badges(), ['1']);
  results.push('Deleting Event 1 removes its photos, promotes Event 2, and closes the numbering gap');

  const completed = { ...draft, status: 'completed', template_id: 't1', inspector_name: 'Jordan Ray', conducted_at: '2026-10-29T10:00:00Z', flagged_items_count: 1, actions_count: 0, signature_data: null };
  await render({ view: 'viewer', completed, rows: { inspection_photos: photoRows, inspection_templates: template, user_settings: null, accounts: {}, account_users: null } });
  const text = doc().body.textContent;
  assert.match(text, /Event 1.*Drip pan 1\/3 full of rain water.*Event 2.*Pan drained & <re>checked/s);
  const eventBlocks = [...doc().querySelectorAll('p')].filter(p => /^Event \d$/.test(p.textContent)).map(p => p.parentElement);
  assert.equal(eventBlocks.length, 2);
  const photoCount = block => block.querySelectorAll('.grid > *').length;
  assert.deepEqual(eventBlocks.map(photoCount), [2, 1]);
  results.push('Report viewer prints each event with only its own photos');

  // Exported HTML (printed to PDF): capture the generated file.
  const brokenPhoto = { ...photoRows[0], id: 'p4', photo_url: 'i1/q1/broken.jpg' };
  await render({ view: 'export', rows: { inspections: [completed], inspection_photos: [...photoRows, brokenPhoto], inspection_templates: template, user_settings: null, accounts: {} } });
  await delay(200);
  dom.window.URL.createObjectURL = blob => { dom.window.qa.blob = blob; return 'blob:qa'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === 'Select All').click();
  await delay(30);
  [...doc().querySelectorAll('button')].find(b => /^Export 1 Report \(HTML\)$/.test(b.textContent.trim())).click();
  await delay(100);
  const html = await new Promise((resolve, reject) => { const r = new dom.window.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(dom.window.qa.blob); });
  const audit = html.slice(html.indexOf('Drip pans dry?'));
  assert.match(audit, /Event 1<\/div>[\s\S]*Drip pan 1\/3 full of rain water[\s\S]*Event 2<\/div>[\s\S]*Pan drained &amp; &lt;re&gt;checked/);
  const eventHtml = audit.split('class="event-label"').slice(1);
  const imgs = chunk => (chunk.match(/class="photo-thumbnail"/g) || []).length;
  assert.deepEqual([imgs(eventHtml[0].split('Event 2')[0]), imgs(eventHtml[1].split('signature')[0])], [2, 1]);
  assert.doesNotMatch(html, /broken\.jpg/);
  assert.match(html, /\.event,\s*\.photo-thumbnail \{\s*page-break-inside: avoid/);
  assert.match(html, /Prepared by:[\s\S]*Jordan Ray/);
  results.push('Exported HTML/PDF groups photos by event, escapes text, skips failed photos, keeps events together when printed, and names the submitter');
  console.log(results.map(r => `✓ ${r}`).join('\n'));
} finally {
  dom?.window.close();
}
