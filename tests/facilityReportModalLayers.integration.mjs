/** Selected-facility Overview/Reports regression using real manager/overview DOM.
 * JSDOM_MODULE=/path/to/jsdom/lib/api.js node tests/facilityReportModalLayers.integration.mjs
 * Mock services and synthetic facilities only. Portals, layer classes, desktop and
 * mobile action paths, Escape isolation and selected export scope are tested.
 * JSDOM does not establish rendered geometry or browser hit-testing.
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
const records = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, name: `Facility ${i}`, status: 'active', spcc_completion_type:'internal', spcc_inspection_date: new Date().toISOString(), latitude: 35, longitude: -97 }));
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
   select() { return this }, single() {return Promise.resolve({data:null,error:null})}, eq() { return this }, in() { return this }, order() { return this }, range() { return this },
   is() { return this }, not() { return this }, limit() { return this }, update() { return this }, upsert() { return this },
   async maybeSingle() { return { data: null, error: null } },
   then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) },
 }; return chain; },
 channel() { return { on() { return this }, subscribe() { return this } } }, removeChannel() {},
};`;
await build({stdin:{contents:app,loader:'jsx',resolveDir:root},outfile:join(output,'app.js'),bundle:true,format:'iife',jsx:'automatic',logLevel:'error',plugins:[{name:'mock-services',setup(plugin){
 plugin.onResolve({filter:/(?:lib\/supabase|contexts\/(?:AccountContext|AuthContext|DarkModeContext)|hooks\/useFacilityIdLabel)$/},args=>({path:args.path,namespace:'mock'}));
 plugin.onResolve({filter:/^\.\//},args=>args.importer.endsWith('FacilitiesManager.tsx') && !['./SearchInput','./CustomFilterBuilder','./ModalPortal','./InspectionsOverviewModal','./SPCCPlansOverviewModal'].includes(args.path) ? {path:args.path,namespace:'stub-component'} : undefined);
 plugin.onLoad({filter:/.*/,namespace:'stub-component'},args=>({contents:args.path.endsWith('InspectionReportExport') ? 'import React from "react"; export default function Stub({facilities}){return <div data-export-scope={facilities.map(f=>f.id).join(",")}/>;}' : 'export default function Stub(){return null}',loader:'jsx',resolveDir:root}));
 plugin.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:
 args.path.endsWith('AccountContext') ? 'export const useAccount=()=>({isAgencyAdmin:false});' :
 args.path.endsWith('DarkModeContext') ? 'export const useDarkMode=()=>({darkMode:false});' :
 args.path.endsWith('AuthContext') ? 'export const useAuth=()=>({user:{email:"qa@example.test"}});' :
 args.path.endsWith('useFacilityIdLabel') ? 'export const useFacilityIdLabel=()=>({long:"Facility ID",short:"ID"});' : mockClient,loader:'js',resolveDir:root}));
}}]});

const defaults = {sort_column:'name',sort_direction:'asc',hide_empty_fields:false,columns:{},search_query:'',status_filter:'all',spcc_plan_filter:'all',show_sold_facilities:false,custom_filter_rules:[],column_widths:{}};
let dom;
const doc = () => dom.window.document;
const counter = () => [...doc().querySelectorAll('h2')].find(h => h.textContent === 'Facilities')?.nextElementSibling?.textContent;
async function land(globalType, cachedPrefs = {}) {
  dom?.window.close();
  dom = new JSDOM('<!doctype html><nav id="global-nav" style="position:sticky;z-index:70"><button>Facilities</button></nav><div id="root" style="position:relative;z-index:1;transform:translateZ(0)"></div>', { url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true });
  Object.assign(dom.window, { IntersectionObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} }, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  // Prefs as an earlier session on this device left them.
  dom.window.localStorage.setItem('facilities_prefs_acct', JSON.stringify({ ...defaults, ...cachedPrefs }));
  dom.window.qa = { records, types, globalType };
  dom.window.eval(await readFile(join(output, 'app.js'), 'utf8'));
  await delay(30);
  dom.window.qa.load();
  await delay(150);
}
const button = text => [...doc().querySelectorAll('button')].find(b => b.textContent.trim() === text);
const selectionBar = () => [...doc().querySelectorAll('div')].find(e => e.classList.contains('z-[9999]') && e.classList.contains('fixed') && /selected/.test(e.textContent));
function assertDialog(label) {
 const dialog=doc().querySelector(`[role="dialog"][aria-label="${label}"]`);
 assert.ok(dialog,label);assert.equal(dialog.parentElement,doc().body,'portal escapes transformed/stacking ancestor');
 assert.ok(dialog.classList.contains('z-[10000]'),'dialog above navigation70 and selection9999');
 doc().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(selectionBar(),undefined,'selection toolbar stays behind workflow');return dialog;
}
async function selectOne(){const boxes=[...doc().querySelectorAll('input[type=checkbox]')];assert.ok(boxes.length>1);boxes[1].click();await delay(30);assert.ok(selectionBar());}
async function closeOverview(label){const dialog=assertDialog(label);dialog.querySelector('button').focus();assert.ok(dialog.contains(doc().activeElement));dialog.querySelector('button').click();await delay(30);assert.ok(selectionBar(),'selection preserved and toolbar restored');}
try{
 for (const width of [390,1280]) {
  await land('all');Object.defineProperty(dom.window,'innerWidth',{value:width,configurable:true});await selectOne();
  if(width===390){
   doc().querySelector('[aria-label="Open facility actions"]').click();await delay(20);assert.equal(selectionBar(),undefined);
   doc().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay(20);assert.ok(selectionBar(),'mobile Escape preserves selection');
   doc().querySelector('[aria-label="Open facility actions"]').click();await delay(20);[...doc().querySelectorAll('[aria-label="Facility actions"] button')].find(b=>b.textContent.trim()==='Overview').click();
  }else{doc().querySelector('#tb-overview').click();}
  await delay(30);assertDialog('Choose overview');
  const inspections=[...doc().querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('SPCC Inspections'));inspections.focus();inspections.click();await delay(80);await closeOverview('Inspection overview');
  doc().querySelector('#tb-overview').click();await delay(20);[...doc().querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('SPCC Plans')).click();await delay(40);await closeOverview('SPCC plans overview');
  if(width===390){doc().querySelector('[aria-label="Open facility actions"]').click();await delay(20);[...doc().querySelectorAll('[aria-label="Facility actions"] button')].find(b=>b.textContent.trim()==='Reports').click();}
  else{doc().querySelector('#tb-reports').click();}
  await delay(20);assertDialog('Export reports');assert.match(doc().querySelector('[aria-label="Export reports"]').textContent,/1 selected/);
  [...doc().querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('Inspection Reports')).click();await delay(40);
  const exportScope=doc().querySelector('[data-export-scope]');assert.ok(exportScope);assert.equal(exportScope.getAttribute('data-export-scope').split(',').length,1);assert.equal(selectionBar(),undefined);
  const exportRoot=exportScope.closest('.fixed');assert.equal(exportRoot.parentElement,doc().body);assert.ok(exportRoot.classList.contains('z-[10000]'));exportRoot.querySelector('button').click();await delay(30);assert.ok(selectionBar());
 }
 for(const [mode,label] of [[PLAN_ID,'SPCC plans overview'],[INSPECTION_ID,'Inspection overview']]) {
  await land(mode);await selectOne();doc().querySelector('#tb-overview').click();await delay(60);await closeOverview(label);
 }
 console.log('PASS: selected facilities, both overview picker/direct routes, Reports transition, body portals/layer tiers, focused close actions, 390/1280 viewport setup, preserved selection/export scope. DOM structural tests, not browser hit-testing.');
}finally{dom?.window.close()}
