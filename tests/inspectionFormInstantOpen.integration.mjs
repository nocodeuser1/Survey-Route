/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/inspectionFormInstantOpen.integration.mjs
 *
 * The form must open from the device's template copy and the draft the
 * caller already has, even when every network request is stalled.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'inspection-open-qa-'));
const template = { id: 't1', name: 'SPCC Inspection', questions: [{ id: 'q1', text: 'Drip pans dry?' }, { id: 'q2', text: 'Valves OK?' }] };
const draft = {
  id: 'd1', facility_id: 'f1', status: 'draft', created_at: '2026-10-28T14:00:00Z', updated_at: '2026-10-29T09:30:00Z',
  responses: [{ question_id: 'q1', answer: 'no', comments: 'Drip pan 1/3 full of rain water', action_required: false, action_notes: '' }],
};
const app = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import InspectionForm from './src/components/InspectionForm';
createRoot(document.getElementById('root')).render(
  <InspectionForm facility={{ id: 'f1', name: 'Ash 1WH' }} userId="auth-1" accountId="acct" teamNumber={1}
    initialDraft={window.qa.initialDraft} onClose={() => {}} />);`;
// Every query hangs until the test releases it, like a stalled mobile request.
const mockClient = `export const supabase = {
 from(table) { const chain = {
  select() { return this }, eq() { return this }, gte() { return this }, in() { return this }, order() { return this }, limit() { return this },
   update() { return this }, insert() { return this }, single() { return this.maybeSingle() },
   maybeSingle() { window.qa.queries.push(table); return new Promise(r => window.qa.release.push(() => r({ data: window.qa.rows[table] ?? null, error: null }))) },
   then(resolve, reject) { return new Promise(r => window.qa.release.push(() => r({ data: [], error: null }))).then(resolve, reject) },
 }; return chain; },
};`;
await build({stdin:{contents:app,loader:'jsx',resolveDir:root},outfile:join(output,'app.js'),bundle:true,format:'iife',jsx:'automatic',logLevel:'error',plugins:[{name:'mock-services',setup(plugin){
 plugin.onResolve({filter:/(?:lib\/supabase|contexts\/AuthContext)$/},args=>({path:args.path,namespace:'mock'}));
 plugin.onLoad({filter:/.*/,namespace:'mock'},args=>({contents: args.path.endsWith('AuthContext')
   ? 'export const useAuth=()=>({user:{id:"profile-1",email:"qa@example.test"}});' : mockClient, loader:'js', resolveDir:root}));
}}]});

let dom;
const text = () => dom.window.document.body.textContent;
async function open({ cachedTemplate, initialDraft, rows = {} }) {
  dom?.window.close();
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.alert = () => {};
  if (cachedTemplate) dom.window.localStorage.setItem('survey-route:inspection-template:v1:acct', JSON.stringify(template));
  dom.window.qa = { initialDraft, rows, queries: [], release: [] };
  dom.window.eval(await readFile(join(output, 'app.js'), 'utf8'));
  await delay(30);
}
const releaseAll = async () => { const q = dom.window.qa.release.splice(0); q.forEach(fn => fn()); await delay(30); };
const comment = () => dom.window.document.querySelector('textarea')?.value;
const results = [];
try {
  await open({ cachedTemplate: true, initialDraft: draft });
  assert.doesNotMatch(text(), /Loading inspection form/);
  assert.equal(comment(), 'Drip pan 1/3 full of rain water');
  assert.match(text(), /Draft started .* · Last saved /);
  assert.doesNotMatch(text(), /Signature Required/);
  results.push('Opens instantly on the known draft with the started/last-saved banner while the network is stalled');

  await releaseAll();
  assert.equal(comment(), 'Drip pan 1/3 full of rain water');
  results.push('Background template and draft refreshes do not wipe the opened answers');

  const newer = { ...draft, updated_at: '2026-10-29T11:00:00Z', responses: [{ ...draft.responses[0], comments: 'Pan drained' }] };
  await open({ cachedTemplate: true, initialDraft: null, rows: { inspections: newer } });
  assert.doesNotMatch(text(), /Loading inspection form/);
  await releaseAll();
  assert.equal(comment(), 'Pan drained');
  assert.match(text(), /Draft started /);
  results.push('A draft found only on the server opens once it arrives');

  await open({ cachedTemplate: false, initialDraft: draft, rows: { inspection_templates: template } });
  assert.match(text(), /Loading inspection form/);
  await releaseAll();
  assert.equal(comment(), 'Drip pan 1/3 full of rain water');
  assert.ok(dom.window.localStorage.getItem('survey-route:inspection-template:v1:acct'));
  results.push('Without a device copy it waits once, keeps the draft, and caches the template');
  console.log(results.map(r => `✓ ${r}`).join('\n'));
} finally {
  dom?.window.close();
}
