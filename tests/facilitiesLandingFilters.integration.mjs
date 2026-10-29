/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/facilitiesLandingFilters.integration.mjs
 *
 * Landing in a mode must show the same list as toggling into it. A status
 * filter or plan chip left over from an earlier session (or from the other
 * mode) used to open Plans on "0/25" until the user toggled All → Plans.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'facilities-landing-qa-'));
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const INSPECTION_ID = '22222222-2222-4222-8222-222222222222';
const types = [
  { id: PLAN_ID, name: 'SPCC Plans', is_system: true, system_kind: 'spcc_plan', enabled: true },
  { id: INSPECTION_ID, name: 'SPCC Inspections', is_system: true, system_kind: 'spcc_inspection', enabled: true },
];
const records = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, name: `Facility ${i}`, status: 'active', latitude: 35, longitude: -97 }));
// Mirrors App: facilities and survey types both arrive after mount, and the
// global survey type can change from Route Planning without this toggle.
const app = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FacilitiesManager from './src/components/FacilitiesManager';
function App() {
 const [facilities, setFacilities] = useState([]); const [loading, setLoading] = useState(true);
 const [surveyTypes, setSurveyTypes] = useState([]); const [globalType, setGlobalType] = useState(window.qa.globalType);
 const [active, setActive] = useState(null);
 window.qa.load = () => { setSurveyTypes(window.qa.types); setFacilities(window.qa.records); setLoading(false); };
 window.qa.setGlobalType = setGlobalType;
 return <FacilitiesManager key="acct" facilities={facilities} accountId="acct" userId="qa-user" isLoading={loading}
   onFacilitiesChange={() => {}} surveyTypes={surveyTypes} activeSurveyTypeId={active} onSurveyTypeSelect={setActive}
   globalSurveyType={globalType} onGlobalSurveyTypeChange={setGlobalType} />;
}
createRoot(document.getElementById('root')).render(<App />);`;
const mockClient = `export const supabase = {
 from() { const chain = {
   select() { return this }, eq() { return this }, in() { return this }, order() { return this }, range() { return this },
   is() { return this }, not() { return this }, limit() { return this }, update() { return this }, upsert() { return this },
   async maybeSingle() { return { data: null, error: null } },
   then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) },
 }; return chain; },
 channel() { return { on() { return this }, subscribe() { return this } } }, removeChannel() {},
};`;
await build({stdin:{contents:app,loader:'jsx',resolveDir:root},outfile:join(output,'app.js'),bundle:true,format:'iife',jsx:'automatic',logLevel:'error',plugins:[{name:'mock-services',setup(plugin){
 plugin.onResolve({filter:/(?:lib\/supabase|contexts\/(?:AccountContext|AuthContext)|hooks\/useFacilityIdLabel)$/},args=>({path:args.path,namespace:'mock'}));
 plugin.onResolve({filter:/^\.\//},args=>args.importer.endsWith('FacilitiesManager.tsx') && !['./SearchInput','./CustomFilterBuilder'].includes(args.path) ? {path:args.path,namespace:'stub-component'} : undefined);
 plugin.onLoad({filter:/.*/,namespace:'stub-component'},()=>({contents:'export default function Stub(){return null}',loader:'js'}));
 plugin.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:
 args.path.endsWith('AccountContext') ? 'export const useAccount=()=>({isAgencyAdmin:false});' :
 args.path.endsWith('AuthContext') ? 'export const useAuth=()=>({user:{email:"qa@example.test"}});' :
 args.path.endsWith('useFacilityIdLabel') ? 'export const useFacilityIdLabel=()=>({long:"Facility ID",short:"ID"});' : mockClient,loader:'js',resolveDir:root}));
}}]});

const defaults = {sort_column:'name',sort_direction:'asc',hide_empty_fields:false,columns:{},search_query:'',status_filter:'all',spcc_plan_filter:'all',show_sold_facilities:false,custom_filter_rules:[],column_widths:{}};
let dom;
const doc = () => dom.window.document;
const counter = () => [...doc().querySelectorAll('h2')].find(h => h.textContent === 'Facilities')?.nextElementSibling?.textContent;
async function land(globalType, cachedPrefs = {}) {
  dom?.window.close();
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true });
  Object.assign(dom.window, { IntersectionObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} }, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  // Prefs as an earlier session on this device left them.
  dom.window.localStorage.setItem('facilities_prefs_acct', JSON.stringify({ ...defaults, ...cachedPrefs }));
  dom.window.qa = { records, types, globalType };
  dom.window.eval(await readFile(join(output, 'app.js'), 'utf8'));
  await delay(30);
  dom.window.qa.load();
  await delay(150);
}
const results = [];
try {
  await land(PLAN_ID, { status_filter: '["inspected"]' });
  assert.equal(counter(), '25/25');
  results.push('Plans ignores an Inspections status filter saved by an earlier session');

  await land(PLAN_ID, { status_filter: '["plan_overdue"]', spcc_plan_filter: 'overdue' });
  assert.equal(counter(), '25/25');
  results.push('Plans opens without the previous session\'s plan status filter or overdue chip');

  await land('all', { status_filter: '["plan_valid"]' });
  assert.equal(counter(), '25/25');
  results.push('All opens without a saved Plans status filter');

  // Pick an inspection status in All, then switch to Plans the way the Route
  // Planning mode buttons do (global type only, not this component's toggle).
  await land('all');
  doc().querySelector('#tb-filters').click(); await delay(30);
  const inspected = [...doc().querySelectorAll('label')].find(label => label.textContent.trim() === 'Inspected');
  assert.ok(inspected, 'Missing Inspected status option');
  inspected.querySelector('input').click(); await delay(50);
  assert.equal(counter(), '0/25');
  dom.window.qa.setGlobalType(PLAN_ID); await delay(80);
  assert.equal(counter(), '25/25');
  results.push('Switching modes outside the Facilities toggle keeps the list populated');
  console.log(results.map(result => `✓ ${result}`).join('\n'));
} finally {
  dom?.window.close();
}
