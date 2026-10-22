/** DOM integration with mocked services; no account data or network writes.
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/facilitiesChecklistColumns.integration.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_SITE_VISIT_CHECKLIST, DRUMS_ITEM_ID, DAY_TANKS_ITEM_ID, setChecklistAnswer } from '../src/utils/siteVisitChecklist.ts';
import { setContainerInventory } from '../src/utils/containerInventory.ts';
import { checklistColumnId } from '../src/utils/checklistColumns.ts';

const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'facilities-columns-qa-'));
const at = '2026-10-02T19:00:00.000Z';
const records = [
  { id: 'a', name: 'Alpha', site_visit_checklist_progress: setContainerInventory({}, DAY_TANKS_ITEM_ID, { answer: 'yes', containers: [{ gallons: 55, quantity: 3, contents: 'Methanol' }] }, at) },
  { id: 'b', name: 'Beta', site_visit_checklist_progress: setChecklistAnswer({}, DRUMS_ITEM_ID, 'no', at) },
  { id: 'c', name: 'Gamma', site_visit_checklist_progress: setChecklistAnswer({}, DRUMS_ITEM_ID, 'yes', at) },
];
const app = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FacilitiesManager from './src/components/FacilitiesManager';
function App() {
 const [account, setAccount] = useState('a'); const [epoch, setEpoch] = useState(0);
 window.qa.account = setAccount; window.qa.remount = () => setEpoch(v => v + 1);
 return <FacilitiesManager key={epoch} facilities={window.qa.records} accountId={account} userId="qa-user" onFacilitiesChange={() => {}} />;
}
createRoot(document.getElementById('root')).render(<App />);`;
const mockClient = `export const supabase = {
 from(table) { let account; let payload;
   const chain = {
     select() { return this }, eq(key, value) { if (key === 'id' || key === 'account_id') account = value; return this },
     in() { return this }, order() { return this }, range() { return this }, is() { return this }, not() { return this }, limit() { return this },
     update(value) { payload=value; return this }, upsert(value) { payload=value; return this },
     async maybeSingle() {
       if(table === 'accounts') { await new Promise(resolve => setTimeout(resolve, window.qa.templateDelay)); return window.qa.templateError ? { data:null,error:{message:'Test failure'} } : { data: { site_visit_checklist: window.qa.templates[account] }, error: null }; }
       return { data:null, error:null };
     },
     then(resolve, reject) { if(payload) window.qa.writes.push({table,payload}); return Promise.resolve({ data:[], error:null }).then(resolve,reject) }
   }; return chain;
 },
 channel() { return { on(){return this}, subscribe(){return this} } }, removeChannel() {},
};`;
const mockPrefs = `import { useState, useCallback, useEffect } from 'react';
const defaults = {sort_column:'name',sort_direction:'asc',hide_empty_fields:false,columns:{},search_query:'',status_filter:'all',spcc_plan_filter:'all',show_sold_facilities:false,custom_filter_rules:[]};
export function useFacilitiesPreferences(accountId) {
 const read = id => window.qa.prefs[id] || {...defaults};
 const [preferences,setPreferences]=useState(() => read(accountId));
 useEffect(()=>setPreferences(read(accountId)),[accountId]);
 const updatePreferences=useCallback(patch=>setPreferences(previous=>{
   const next={...previous,...patch}; window.qa.prefs[accountId]=next; return next;
 }),[accountId]);
 return { preferences,updatePreferences };
}`;
await build({stdin:{contents:app,loader:'jsx',resolveDir:root},outfile:join(output,'app.js'),bundle:true,format:'iife',jsx:'automatic',plugins:[{name:'mock-services',setup(plugin){
 plugin.onResolve({filter:/(?:lib\/supabase|contexts\/(?:AccountContext|AuthContext)|hooks\/(?:useFacilityIdLabel|useFacilitiesPreferences))$/},args=>({path:args.path,namespace:'mock'}));
 plugin.onResolve({filter:/^\.\//},args=>args.importer.endsWith('FacilitiesManager.tsx') && !['./SearchInput','./CustomFilterBuilder'].includes(args.path) ? {path:args.path,namespace:'stub-component'} : undefined);
 plugin.onLoad({filter:/.*/,namespace:'stub-component'},()=>({contents:'export default function Stub(){return null}',loader:'js'}));
 plugin.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:
 args.path.endsWith('AccountContext') ? 'export const useAccount=()=>({isAgencyAdmin:true});' :
 args.path.endsWith('AuthContext') ? 'export const useAuth=()=>({user:{email:"qa@example.test"}});' :
 args.path.endsWith('useFacilityIdLabel') ? 'export const useFacilityIdLabel=()=>({long:"Facility ID",short:"ID"});' :
 args.path.endsWith('useFacilitiesPreferences') ? mockPrefs : mockClient,loader:'js',resolveDir:root}));
}}]});
let dom;
const doc=()=>dom.window.document;
const wait=async(condition,label='state')=>{for(let i=0;i<300;i++){if(condition())return;await delay(10)}throw Error('Timed out: '+label)};
const buttons=(label)=>[...doc().querySelectorAll('button')].filter(button=>button.textContent.trim()===label);
const click=async(label)=>{const button=buttons(label)[0];assert.ok(button,'Missing '+label);button.click();await delay(30)};
const headers=()=>[...doc().querySelectorAll('thead th[data-col]')].map(node=>node.dataset.col);
const bodyRows=()=>[...doc().querySelectorAll('tbody tr')].map(row=>row.textContent);
const type=async(selector,value)=>{const el=doc().querySelector(selector);assert.ok(el,selector);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await delay(30)};
const columnRow=label=>[...doc().querySelectorAll('span')].find(span=>span.textContent===label)?.parentElement;
const results=[];
async function boot({prefs={},templateDelay=0}={}){
 dom?.window.close();
 dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true});
 Object.assign(dom.window,{IntersectionObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},scrollTo(){}});
 dom.window.qa={records,prefs,templates:{a:[...DEFAULT_SITE_VISIT_CHECKLIST,{id:'custom_item',label:'Check separator paint'}],b:[]},templateDelay,writes:[],templateError:false};
 dom.window.eval(await readFile(join(output,'app.js'),'utf8'));
 await wait(()=>doc().querySelector('#tb-columns'),'table toolbar');
}
try {
 await boot({templateDelay:150});
 doc().querySelector('#tb-columns').click();
 await wait(()=>columnRow('Drums Present'),'async chooser registry');
 assert.equal(headers().some(id=>id.startsWith('checklist:')),false);
 assert.ok(columnRow('Drums Present').querySelector('[title="Show column"]'));
 assert.ok(columnRow('Checklist: Check separator paint').querySelector('[title="Show column"]'));
 await type('input[placeholder="Search fields..."]','drums');
 assert.ok(columnRow('Drums Present'));
 assert.equal(columnRow('Day Tanks Present'),undefined);
 await type('input[placeholder="Search fields..."]','');
 columnRow('Drums Present').querySelector('button').click();
 columnRow('Day Tank Fluid Descriptions').querySelector('button').click();
 await delay(30);
 await click('Apply');
 await wait(()=>headers().includes(checklistColumnId(DRUMS_ITEM_ID)));
 assert.ok(bodyRows().find(text=>text.includes('Beta')).includes('No'));
 assert.ok(bodyRows().find(text=>text.includes('Gamma')).includes('Yes'));
 assert.ok(bodyRows().find(text=>text.includes('Alpha')).includes('Unanswered'));
 results.push('Async chooser lists every template field hidden by default; selection applies canonical Yes/No/Unanswered');
 await type('input[placeholder^="Search name"]','methanol');
 assert.equal(bodyRows().length,1);assert.ok(bodyRows()[0].includes('Alpha'));
 await type('input[placeholder^="Search name"]','');
 results.push('Global facility search finds saved fluid descriptions');
 // The dynamic answer fields share the existing rule builder/evaluator.
 doc().querySelector('#tb-filters').click();await delay(20);await click('Add Filter');
 const select = async (element, value) => {
   Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(element,value);
   element.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await delay(30);
 };
 await select(doc().querySelector('select[title="Choose the field to filter on"]'),checklistColumnId(DRUMS_ITEM_ID));
 await select([...doc().querySelectorAll('select')].find(el=>[...el.options].some(option=>option.value==='No')),'No');
 assert.equal(bodyRows().length,1);assert.ok(bodyRows()[0].includes('Beta'));
 await click('Clear all');await delay(20);
 doc().querySelector('#tb-filters').click();await delay(20);
 const header=[...doc().querySelectorAll('thead th[data-col]')].find(el=>el.dataset.col===checklistColumnId(DRUMS_ITEM_ID));
 header.click();await delay(30);
 assert.ok(bodyRows()[0].includes('Beta'));assert.ok(bodyRows().at(-1).includes('Alpha'));
 header.click();await delay(30);
 assert.ok(bodyRows()[0].includes('Gamma'));assert.ok(bodyRows().at(-1).includes('Alpha'));
 results.push('Dynamic Yes/No filters and ascending/descending sorting preserve unanswered distinctions');
 // Capture the generated CSV instead of navigating or saving a real file.
 dom.window.URL.createObjectURL=blob=>{dom.window.qa.exportBlob=blob;return 'blob:qa'};
 dom.window.HTMLAnchorElement.prototype.click=function(){};
 doc().querySelector('#tb-csv').click();await delay(30);
 const exportButton=[...doc().querySelectorAll('button')].find(button=>/^Export \d+ Columns?$/.test(button.textContent.trim()));
 assert.ok(exportButton);exportButton.click();await delay(30);
 const csv=await new Promise((resolve,reject)=>{const reader=new dom.window.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(dom.window.qa.exportBlob)});
 assert.ok(csv.includes('"Drums Present"'));assert.ok(csv.includes('Methanol (55 gal × 3)'));
 assert.ok(csv.includes('"Unanswered"'));assert.equal(csv.includes('__inventory:'),false);
 results.push('CSV export uses the same labels and readable metadata-backed answers, including fluids');

 const saved=structuredClone(dom.window.qa.prefs.a.columns);
 dom.window.qa.remount();await delay(50);await wait(()=>headers().includes(checklistColumnId(DRUMS_ITEM_ID)));
 assert.deepEqual(JSON.parse(JSON.stringify(dom.window.qa.prefs.a.columns)),saved);
 assert.ok(headers().includes(checklistColumnId(DAY_TANKS_ITEM_ID,'fluids')));
 results.push('Enabled columns and existing layout survive remount and async template loading');
 // A rename must update its label without changing the stable preference ID.
 doc().querySelector('#tb-columns').click();await delay(20);
 columnRow('Checklist: Check separator paint').querySelector('button').click();await delay(30);await click('Apply');
 const beforeTemplateChange=structuredClone(dom.window.qa.prefs.a.columns);
 dom.window.qa.templates.a.find(item=>item.id==='custom_item').label='Check freshly painted separator';
 dom.window.dispatchEvent(new dom.window.Event('focus'));
 await wait(()=>[...doc().querySelectorAll('thead th')].some(node=>node.textContent.includes('freshly painted')));
 assert.deepEqual(JSON.parse(JSON.stringify(dom.window.qa.prefs.a.columns)),beforeTemplateChange);
 dom.window.qa.templates.a.push({id:'new_item',label:'New hidden item'});
 dom.window.dispatchEvent(new dom.window.Event('focus'));await delay(200);
 assert.equal(headers().includes(checklistColumnId('new_item')),false);
 results.push('Template renames retain selections; newly added questions remain hidden');
 dom.window.qa.account('b');await delay(250);
 assert.equal(headers().some(id=>id.startsWith('checklist:')),false);
 doc().querySelector('#tb-columns').click();await delay(20);
 assert.equal(columnRow('Drums Present'),undefined);
 await click('Cancel');
 dom.window.qa.account('a');await delay(250);
 assert.ok(headers().includes(checklistColumnId(DRUMS_ITEM_ID)));
 results.push('Empty-template account cannot leak another account’s columns; returning restores selections');
 console.log(JSON.stringify({results,output},null,2));
} finally { dom?.window.close(); }
