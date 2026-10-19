/**
 * Synthetic component QA. No production data, network lookups or device location.
 * JSDOM_MODULE=/absolute/path/to/jsdom/lib/api.js node tests/homeBaseModal.integration.mjs
 * QA_PREVIEW=1 serves the same real components for browser layout checks.
 * Generated assets stay in ~/.codex/tmp, or QA_OUTPUT_DIR.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const scratch = join(homedir(), '.codex/tmp');
await mkdir(scratch, { recursive: true });
const output = process.env.QA_OUTPUT_DIR || await mkdtemp(join(scratch, 'survey-homebase-qa-'));
await mkdir(output, { recursive: true });
// Exercise the exact shortcut JSX used in RouteResults, with its real tooltip provider.
const toolbarSource = await readFile(join(root, 'src/components/RouteResults.tsx'), 'utf8');
const tree = ts.createSourceFile('RouteResults.tsx', toolbarSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let shortcut;
function inspect(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button' &&
    node.openingElement.attributes.properties.some(attribute => attribute.name?.getText(tree) === 'aria-label' && attribute.initializer?.text === 'Home base settings')) shortcut = node.getText(tree);
  ts.forEachChild(node, inspect);
}
inspect(tree);
assert.ok(shortcut, 'Route controls expose the home-base shortcut');
const mockClient = `
export const supabase = { from(table) {
  const qa = window.qa;
  let operation = 'read', values, filters = {};
  const query = {
    select() { return query; }, eq(key, value) { filters[key] = value; return query; },
    order() { return query; }, abortSignal() { return query; },
    update(value) { operation = 'update'; values = value; return query; },
    insert(value) { operation = 'insert'; values = value; return query; },
    async single() {
      qa.writes.push({table, operation, values, filters});
      if (qa.failSave) return { data: null, error: { message: 'Synthetic save failure' } };
      if (qa.zeroRows) return { data: null, error: null };
      const row = { ...values, id: filters.id || 'new-' + values.team_number, team_number: values.team_number || qa.rows.find(r=>r.id===filters.id)?.team_number };
      qa.rows = [...qa.rows.filter(r=>r.id!==row.id), row];
      return { data: row, error: null };
    },
    then(resolve, reject) {
      const result = qa.failLoad ? { data: null, error: { message: 'Synthetic load failure' } } : { data: qa.rows, error: null };
      return (qa.deferLoad ? new Promise(done => qa.pendingLoads.push(done)) : Promise.resolve(result)).then(resolve,reject);
    },
  }; return query;
}};`;
const app = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home, Pencil } from 'lucide-react';
import HomeBaseModal from './src/components/HomeBaseModal';
import ContextualHelpProvider from './src/components/ContextualHelpProvider';
const qa = window.qa;
function App() {
  const [open, setOpen] = useState(true);
  const [epoch, setEpoch] = useState(0);
  qa.reopen = () => { setOpen(true); setEpoch(value=>value+1); };
  const onConfigureHomeBase = () => setOpen(true);
  return <ContextualHelpProvider><main className="p-4">
    <div className="flex items-center gap-3 rounded-xl border p-4 dark:border-gray-700">
      <span className="flex-1 font-semibold text-gray-900 dark:text-white">Route Planning</span>${shortcut}
    </div>
    {open && <HomeBaseModal key={epoch} userId="synthetic-user" accountId="synthetic-account" teamCount={qa.teamCount}
      onTeamCountChange={count=>qa.savedTeams=count} onSaved={()=>qa.saved++}
      onClose={()=>{ qa.closes++; setOpen(false); }} />}
  </main></ContextualHelpProvider>;
}
const root = createRoot(document.getElementById('root'));
qa.destroy = () => root.unmount();
root.render(<App />);`;
await build({
  stdin: { contents: app, loader: 'tsx', resolveDir: root, sourcefile: 'home-base-qa.tsx' },
  outfile: join(output, 'app.js'), bundle: true, format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'synthetic-home-base-services', setup(plugin) {
    plugin.onResolve({ filter: /(?:lib\/supabase|services\/osrm)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.endsWith('osrm')
      ? `export function geocodeAddress(address) { return new Promise(resolve => window.qa.geocodes.push({address,resolve})); }`
      : mockClient, loader: 'js' }));
  }}],
});
const initialRow = { id: 'synthetic-home', team_number: 1, team_label: 'Team 1', address: '100 Sample Way, Sample City, OK', latitude: 35, longitude: -97 };
const makeQA = () => ({ rows: [initialRow], teamCount: 1, writes: [], geocodes: [], gps: [], pendingLoads: [], closes: 0, saved: 0 });
const bundle = await readFile(join(output, 'app.js'), 'utf8');
if (process.env.QA_PREVIEW === '1') {
  execFileSync(process.execPath, [join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', 'src/index.css', '-o', join(output, 'app.css'), '--minify'], { cwd: root, stdio: 'pipe' });
  const init = `window.qa=${JSON.stringify(makeQA())};
    if(location.search.includes('failure')) window.qa.failLoad=true;
    if(location.search.includes('empty')) window.qa.rows=[];
    if(location.search.includes('dark')) document.documentElement.classList.add('dark');
    Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(success,error){window.qa.gps.push({success,error});}}});`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body class="bg-gray-50 dark:bg-gray-900"><div id="root"></div><script>${init}</script><script src="/app.js"></script></body></html>`;
  const frames = `<!doctype html><html><body style="background:#e2e8f0;font:14px system-ui"><h1>Home base settings - synthetic layout QA</h1><div style="display:flex;gap:20px"><iframe title="320px light" src="/app?empty" width="320" height="740"></iframe><iframe title="390px dark" src="/app?dark" width="390" height="740"></iframe><iframe title="Desktop" src="/app" width="640" height="740"></iframe></div></body></html>`;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url,'http://localhost').pathname;
    res.setHeader('Content-Type', path === '/app.js' ? 'text/javascript' : path === '/app.css' ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? bundle : path === '/app.css' ? await readFile(join(output, 'app.css')) : path === '/app' ? html : frames);
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  console.log('Preview: http://127.0.0.1:' + server.address().port);
  console.log('Assets: ' + output);
} else {
  const { JSDOM, VirtualConsole } = await import(process.env.JSDOM_MODULE || 'jsdom');
  let dom;
  const wait = async predicate => { for(let i=0;i<150;i++){if(predicate())return;await delay(10);} throw Error('Timed out waiting for component'); };
  const doc = () => dom.window.document;
  const qa = () => dom.window.qa;
  const text = () => doc().body.textContent;
  const button = name => [...doc().querySelectorAll('button')].find(el => (el.getAttribute('aria-label') || el.textContent.trim()) === name);
  const click = async name => { const el=button(name); assert.ok(el,name); el.click(); await delay(20); };
  const input = async (selector,value) => {
    const el=doc().querySelector(selector); assert.ok(el,selector);
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);
    el.dispatchEvent(new dom.window.Event('input',{bubbles:true})); await delay(20);
  };
  const reload = async overrides => {
    dom?.window.qa.destroy();
    if (!dom) dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole().on('jsdomError', error => console.error(error)).on('error', (...args) => console.error(...args))});
    // JSDOM omits the rendered-text property used by the real help provider.
    if (!('innerText' in dom.window.HTMLElement.prototype)) Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    doc().body.innerHTML = '<div id="root"></div>';
    dom.window.qa={...makeQA(),...overrides};
    Object.defineProperty(dom.window.navigator,'geolocation',{configurable:true,value:{ getCurrentPosition(success,error,options){qa().gps.push({success,error,options});} }});
    dom.window.eval(bundle);
    await wait(()=>doc().querySelector('[role="dialog"]'));
    if(!overrides?.deferLoad) await wait(()=>!text().includes('Loading saved home bases'));
  };
  const results=[];
  try {
    await reload({deferLoad:true,teamCount:0});
    assert.ok(doc().querySelector('#home-address-0'),'Fields render before load, even with teamCount=0');
    assert.equal(button('Save home base').disabled,true);
    await wait(()=>qa().pendingLoads.length);
    qa().pendingLoads.shift()({data:[],error:null});
    await wait(()=>!text().includes('Loading saved home bases'));
    results.push('Fields remain visible during loading; zero-team input normalizes to one');

    await reload({failLoad:true});
    assert.ok(text().includes('Could not load saved home bases'));
    assert.equal(button('Save home base').disabled,true);
    assert.ok(doc().querySelector('fieldset').disabled);
    qa().failLoad=false; await click('Try again');
    await wait(()=>!text().includes('Could not load saved home bases'));
    assert.equal(doc().querySelector('#home-address-0').value,initialRow.address);
    results.push('Load errors are visible and block writes; retry restores saved values');

    await input('#home-address-0','200 Example Road, Sample City, OK');
    assert.equal(button('Save home base').disabled,true,'Address edit invalidates old coordinates');
    await click('Find');
    assert.equal(qa().geocodes[0].address,'200 Example Road, Sample City, OK');
    await input('#home-address-0','300 New Address, Sample City, OK');
    qa().geocodes[0].resolve({latitude:36,longitude:-98}); await delay(20);
    assert.equal(button('Save home base').disabled,true,'Stale lookup cannot enable save');
    await click('Find'); qa().geocodes[1].resolve({latitude:0,longitude:0}); await delay(20);
    assert.equal(button('Save home base').disabled,false,'Zero coordinates are valid');
    await click('Save home base');
    assert.equal(qa().writes.length,1); assert.equal(qa().saved,1);
    assert.equal(qa().writes[0].values.latitude,0);
    assert.equal(qa().writes[0].filters.account_id,'synthetic-account');
    results.push('Address lookup ignores stale results, accepts zero coordinates and saves with account scoping');

    await reload({rows:[]});
    await click('Use my current location');
    assert.equal(qa().writes.length,0);
    qa().gps[0].error({code:1}); await delay(20);
    assert.ok(text().includes('Location access is blocked'));
    assert.equal(button('Save home base').disabled,true);
    await click('Use my current location');
    qa().gps[1].success({coords:{latitude:35.5,longitude:-97.5}}); await delay(20);
    assert.ok(text().includes('Location ready: 35.50000, -97.50000'));
    await click('Cancel');
    assert.equal(qa().writes.length,0,'Cancel does not save GPS'); assert.equal(qa().closes,1);
    results.push('Location denied/retry works; GPS only changes drafts and Cancel performs zero writes');

    await reload({rows:[]});
    await click('Use my current location');
    await input('#home-address-0','400 Typed Address');
    qa().gps[0].success({coords:{latitude:40,longitude:-100}}); await delay(20);
    assert.equal(doc().querySelector('#home-address-0').value,'400 Typed Address');
    assert.equal(button('Save home base').disabled,true);
    results.push('Late GPS cannot replace a subsequently edited address');

    await reload({rows:[]});
    await click('2 Teams');
    assert.equal(doc().querySelectorAll('[id^="home-address-"]').length,2);
    await click('1 Team');
    await input('input[type="number"][min="-90"]','91');
    await input('input[type="number"][min="-180"]','-97');
    assert.equal(button('Save home base').disabled,true);
    await input('input[type="number"][min="-90"]','35');
    await click('2 Teams');
    assert.equal(button('Save home base').disabled,true,'Every active team needs a location');
    await click('1 Team');
    await click('Save home base');
    assert.equal(qa().writes[0].operation,'insert');
    assert.equal(qa().writes[0].values.team_number,1);
    results.push('Coordinate bounds and all-team validation; new home base inserts only on Save');

    await reload({failSave:true});
    await click('Save home base');
    assert.ok(text().includes('Synthetic save failure')); assert.equal(qa().saved,0);
    qa().failSave=false; await click('Save home base');
    assert.equal(qa().saved,1);
    results.push('Save errors keep dialog open; retry succeeds');

    await reload({zeroRows:true});
    await click('Save home base');
    assert.equal(qa().saved,0); assert.ok(text().includes('was not saved'));
    results.push('A zero-row write cannot report false success');

    await reload(); await click('Cancel');
    assert.equal(button('Home base settings').title,'Home base settings');
    await click('Home base settings');
    assert.ok(doc().querySelector('[role="dialog"]'));
    assert.equal(qa().writes.length,0);
    results.push('Visible home/edit shortcut opens settings without writes and exposes help text');
    console.log(JSON.stringify({passed:results.length,results},null,2));
  } finally { dom?.window.close(); }
}
