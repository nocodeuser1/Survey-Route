/**
 * Local component integration test. No real Supabase connection or user data.
 * npm ci
 * npm install --prefix /tmp/survey-route-test-tools playwright jsdom
 * PLAYWRIGHT_MODULE=/tmp/survey-route-test-tools/node_modules/playwright/index.mjs \
 *   node tests/siteVisitChecklist.integration.mjs
 * For DOM-only tests, set QA_DOM=1 and
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js
 * (PLAYWRIGHT_MODULE is then unnecessary).
 * Uses installed Chromium, or CHROMIUM_PATH. Screenshots go to QA_OUTPUT_DIR.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { build } from 'esbuild';
import { DEFAULT_SITE_VISIT_CHECKLIST } from '../src/utils/siteVisitChecklist.ts';

const root = resolve(import.meta.dirname, '..');
const output = process.env.QA_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'survey-checklist-qa-'));
await mkdir(output, { recursive: true });
const id = 'drain_valves_presence';
const legacyAt = '2026-10-01T14:00:00.000Z';
const records = {
  a: { id: 'a', name: 'Sample Facility A', site_visit_checklist_progress: { [id]: legacyAt } },
  b: { id: 'b', name: 'Sample Facility B', site_visit_checklist_progress: {} },
};
let template = DEFAULT_SITE_VISIT_CHECKLIST.map(item => ({ ...item }));
// Previously saved templates retain the old label and the same stable id.
template.find(item => item.id === id).label = 'Note presence or absence of drain valves on the berms';
let requestDelay = 0;
let failNext = false;
let saves = 0;
const mockClient = `
export const supabase = { from(table) {
  let values; let id;
  return {
    select() { return this; },
    update(next) { values = next; return this; },
    eq(key, value) { if (key === 'id') id = value; return this; },
    async maybeSingle() { return (await fetch('/api/template?id=' + id)).json(); },
    async single() {
      return (await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table, id, values }) })).json();
    },
    then(resolve, reject) { return this.single().then(resolve, reject); }
  };
}};`;
const app = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SiteVisitChecklist from './src/components/SiteVisitChecklist';
import SiteVisitChecklistSettings from './src/components/SiteVisitChecklistSettings';
const records = await (await fetch('/api/records')).json();
window.__qaAccount = 'account-a';
function App() {
  const [facilityId, setFacilityId] = useState('a');
  const [epoch, setEpoch] = useState(0);
  const [settings, setSettings] = useState(false);
  const [, refresh] = useState(0);
  window.qa = {
    select: setFacilityId,
    remount: () => setEpoch(v => v + 1),
    settings: setSettings,
    account: value => { window.__qaAccount = value; refresh(v => v + 1); },
    records,
  };
  return <main className="mx-auto max-w-xl p-3">
    <p className="mb-3 text-sm text-gray-500">{records[facilityId].name} · test data</p>
    {settings ? <SiteVisitChecklistSettings accountId={window.__qaAccount} />
      : <SiteVisitChecklist key={epoch} facility={records[facilityId]} defaultOpen />}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);`;
await build({
  stdin: { contents: app, loader: 'jsx', resolveDir: root, sourcefile: 'checklist-test.jsx' },
  outfile: join(output, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'mock-services', setup(plugin) {
    plugin.onResolve({ filter: /(?:lib\/supabase|contexts\/AccountContext)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({
      contents: args.path.endsWith('AccountContext')
        ? `export const useAccount = () => ({ currentAccount: window.__qaAccount ? { id: window.__qaAccount } : null });`
        : mockClient,
      loader: 'js',
    }));
  }}],
});
execFileSync(process.execPath, [join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', 'src/index.css', '-o', join(output, 'app.css'), '--minify'], { cwd: root, stdio: 'pipe' });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/records') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(records));
  } else if (url.pathname === '/api/template') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: { site_visit_checklist: url.searchParams.get('id') === 'account-b' ? [] : template }, error: null }));
  } else if (url.pathname === '/api/save') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { table, id: recordId, values } = JSON.parse(body);
    saves++;
    const shouldFail = failNext; failNext = false;
    await delay(requestDelay);
    response.setHeader('Content-Type', 'application/json');
    if (shouldFail) response.end(JSON.stringify({ data: null, error: { message: 'Mock save failure' } }));
    else {
      if (table === 'facilities') Object.assign(records[recordId], values);
      else template = values.site_visit_checklist;
      response.end(JSON.stringify({ data: { id: recordId }, error: null }));
    }
  } else if (url.pathname === '/app.js' || url.pathname === '/app.css') {
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
    response.end(await readFile(join(output, url.pathname.slice(1))));
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
if (process.env.QA_DOM === '1') {
  const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom');
  const base = `http://127.0.0.1:${server.address().port}`;
  let dom;
  let offline = false;
  const wait = async condition => {
    for (let attempts = 0; attempts < 300; attempts++) {
      if (condition()) return;
      await delay(10);
    }
    throw new Error('Timed out waiting for component state');
  };
  const doc = () => dom.window.document;
  const button = name => [...doc().querySelectorAll('button')].find(node => node.textContent.trim() === name);
  const text = () => doc().body.textContent;
  const idle = () => wait(() => !doc().querySelector('fieldset')?.disabled);
  const selected = name => assert.equal(button(name)?.getAttribute('aria-pressed'), 'true');
  const click = name => { assert.ok(button(name), `Missing ${name}`); button(name).click(); };
  const reload = async () => {
    dom?.window.close();
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: base, runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.fetch = (path, options) => offline ? Promise.reject(new Error('Offline test')) : fetch(new URL(path, base), options);
    await dom.window.eval('(async () => {' + await readFile(join(output, 'app.js'), 'utf8') + '})()');
    await wait(() => button('Yes'));
  };
  const results = [];
  try {
    await reload();
    assert.equal(button('Yes').getAttribute('aria-pressed'), 'false');
    assert.equal(button('No').getAttribute('aria-pressed'), 'false');
    assert.ok(text().includes('0 of 9 done'));
    assert.ok(text().includes('Previously checked; Yes/No was not recorded.'));
    results.push('Legacy timestamp remains unanswered and unselected');

    click('No'); await delay(30); await idle(); selected('No');
    assert.ok(text().includes('1 of 9 done'));
    assert.equal(JSON.parse(records.a.site_visit_checklist_progress['__answer:' + id]).answer, 'no');
    await reload(); selected('No');
    click('Yes'); await delay(30); await idle(); selected('Yes');
    dom.window.qa.remount(); await delay(30); await wait(() => button('Yes')); selected('Yes');
    results.push('Yes/No persist via Supabase-shaped calls and survive remount/reload');

    const beforeRepeated = saves;
    click('Yes'); await delay(20); assert.equal(saves, beforeRepeated);
    requestDelay = 150;
    click('No'); click('No');
    await wait(() => saves === beforeRepeated + 1); await idle(); selected('No');
    assert.equal(saves, beforeRepeated + 1);
    results.push('Repeat selection is a no-op; rapid duplicate taps make one request');

    failNext = true;
    click('Yes'); await wait(() => doc().querySelector('[role="alert"]')); await idle(); selected('No');
    offline = true;
    click('Yes'); await delay(40); await idle(); selected('No');
    assert.ok(doc().querySelector('[role="alert"]'));
    offline = false; requestDelay = 0;
    click('Yes'); await delay(30); await idle(); selected('Yes');
    results.push('Server and offline errors roll back to saved answer; reconnect retry works');

    requestDelay = 300;
    click('No'); await wait(() => doc().querySelector('fieldset').disabled);
    dom.window.qa.select('b'); await wait(() => text().includes('Sample Facility B'));
    assert.equal(button('Yes').getAttribute('aria-pressed'), 'false');
    dom.window.qa.select('a'); await wait(() => text().includes('Sample Facility A'));
    selected('No'); assert.equal(doc().querySelector('fieldset').disabled, true);
    const count = saves; click('Yes'); await delay(30); assert.equal(saves, count);
    await idle(); selected('No');
    results.push('A→B→A restores pending answer and prevents conflicting saves');

    failNext = true;
    click('Yes'); await wait(() => doc().querySelector('fieldset').disabled);
    dom.window.qa.select('b'); await wait(() => text().includes('Sample Facility B'));
    await delay(400);
    assert.equal(doc().querySelector('[role="alert"]'), null);
    assert.equal(button('Yes').getAttribute('aria-pressed'), 'false');
    results.push('A delayed failure cannot contaminate facility B');

    dom.window.qa.select('a'); await wait(() => text().includes('Sample Facility A')); selected('No');
    requestDelay = 0;
    click('Clear answer'); await delay(30); await idle();
    assert.equal(records.a.site_visit_checklist_progress[id], undefined);
    assert.equal(records.a.site_visit_checklist_progress['__answer:' + id], undefined);
    click('No'); await delay(30); await idle();
    [...doc().querySelectorAll('button')].find(node => node.textContent.includes('Take updated ground photos')).click();
    await delay(30); await idle();
    assert.equal(JSON.parse(records.a.site_visit_checklist_progress['__answer:' + id]).answer, 'no');
    click('Reset for next visit'); await delay(30); await idle();
    assert.deepEqual(records.a.site_visit_checklist_progress, {});
    results.push('Clear/reset removes both answer keys; other checkbox edits retain answers');

    dom.window.qa.account('account-b'); await wait(() => text().includes('Your account has no checklist items.'));
    assert.equal(button('Yes'), undefined);
    dom.window.qa.account('account-a'); await wait(() => button('Yes'));
    dom.window.qa.settings(true); await wait(() => text().includes('Yes / No'));
    const drainRow = [...doc().querySelectorAll('li')].find(node => node.textContent.includes('Yes / No'));
    drainRow.querySelector('[aria-label="Move up"]').click();
    await wait(() => text().includes('Checklist saved.')); assert.equal(template[2].id, id);
    click('Restore defaults'); await delay(30); await wait(() => text().includes('Checklist saved.'));
    dom.window.qa.settings(false); await wait(() => button('Yes'));
    assert.ok(text().includes('Are drain valves present on the berms?'));
    results.push('Account isolation and Settings badge/reorder/restore preserve response control');

    await writeFile(join(output, 'dom-results.json'), JSON.stringify({ passed: results, visualTesting: 'Not covered by DOM emulator' }, null, 2));
    globalThis.console.log(JSON.stringify({ passed: results, visualTesting: 'Not covered by DOM emulator' }, null, 2));
  } finally {
    dom?.window.close();
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
}

if (process.env.QA_PREVIEW === '1') {
  globalThis.console.log(`Checklist mock preview: http://127.0.0.1:${server.address().port}`);
  await new Promise(() => {});
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const selected = async name => assert.equal(await button(name).getAttribute('aria-pressed'), 'true');
const idle = () => page.waitForFunction(() => ![...document.querySelectorAll('fieldset')].some(node => node.disabled));
const open = async () => { await page.goto(`http://127.0.0.1:${server.address().port}`); await button('Yes').waitFor(); };
const results = [];
try {
  await open();
  assert.equal(await button('Yes').getAttribute('aria-pressed'), 'false');
  assert.equal(await button('No').getAttribute('aria-pressed'), 'false');
  await page.getByText('Previously checked; Yes/No was not recorded. Choose an answer.').waitFor();
  await page.getByText('0 of 9 done', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Photograph condition and position/ }).count(), 1);
  await page.screenshot({ path: join(output, 'mobile-unanswered.png'), fullPage: true });
  results.push('Legacy tick is unanswered; other eight items remain checkboxes');

  await button('No').click(); await idle(); await selected('No');
  assert.equal(JSON.parse(records.a.site_visit_checklist_progress['__answer:' + id]).answer, 'no');
  await page.getByText('1 of 9 done', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'mobile-no.png'), fullPage: true });
  await page.evaluate(() => window.qa.remount()); await button('No').waitFor(); await selected('No');
  await open(); await selected('No');
  await button('Yes').click(); await idle(); await selected('Yes');
  results.push('No and Yes save, count as completed, and survive remount and reload');

  const beforeRepeated = saves;
  await button('Yes').click(); assert.equal(saves, beforeRepeated);
  requestDelay = 400;
  await page.evaluate(() => {
    const no = [...document.querySelectorAll('button')].find(node => node.textContent === 'No');
    no.click(); no.click();
  });
  await idle(); await selected('No'); assert.equal(saves, beforeRepeated + 1);
  results.push('Repeated selected answer is a no-op; rapid duplicate taps create one save');

  requestDelay = 500; failNext = true;
  await button('Yes').click();
  await page.getByRole('alert').waitFor(); await selected('No');
  assert.equal(JSON.parse(records.a.site_visit_checklist_progress['__answer:' + id]).answer, 'no');
  await context.setOffline(true); await button('Yes').click();
  await page.getByRole('alert').waitFor(); await idle(); await selected('No');
  await context.setOffline(false);
  requestDelay = 0; await button('Yes').click(); await idle(); await selected('Yes');
  results.push('Server/network failures roll back to saved No and allow retry after reconnection');

  requestDelay = 700;
  await button('No').click();
  await page.evaluate(() => window.qa.select('b'));
  await page.getByText('Not answered', { exact: true }).waitFor();
  await page.evaluate(() => window.qa.select('a'));
  await selected('No'); assert.equal(await button('Yes').isDisabled(), true);
  await idle(); await selected('No');
  results.push('Switch A → B → A restores in-flight answer and blocks conflicting edits');

  failNext = true; requestDelay = 400;
  await button('Yes').click(); await page.evaluate(() => window.qa.select('b'));
  await page.getByText('Not answered', { exact: true }).waitFor();
  await delay(600);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await button('Yes').getAttribute('aria-pressed'), 'false');
  results.push('Delayed failure for facility A cannot replace facility B or show its error');

  requestDelay = 0;
  await page.evaluate(() => window.qa.select('a')); await selected('No');
  await button('Clear answer').click(); await idle();
  assert.equal(records.a.site_visit_checklist_progress[id], undefined);
  assert.equal(records.a.site_visit_checklist_progress['__answer:' + id], undefined);
  await button('No').click(); await idle();
  await page.getByRole('button', { name: /Take updated ground photos/ }).click(); await idle();
  assert.equal(JSON.parse(records.a.site_visit_checklist_progress['__answer:' + id]).answer, 'no');
  await button('Reset for next visit').click(); await idle();
  assert.deepEqual(records.a.site_visit_checklist_progress, {});
  results.push('Clear/reset removes answer metadata; ordinary checkbox edits preserve answers');

  await page.evaluate(() => window.qa.account('account-b'));
  await page.getByText('Your account has no checklist items.', { exact: false }).waitFor();
  assert.equal(await button('Yes').count(), 0);
  await page.evaluate(() => window.qa.account('account-a')); await button('Yes').waitFor();
  await page.evaluate(() => window.qa.settings(true));
  await page.getByText('Yes / No', { exact: true }).waitFor();
  const drainRow = page.locator('li').filter({ has: page.getByText('Yes / No', { exact: true }) });
  await drainRow.getByRole('button', { name: 'Move up', exact: true }).click();
  await page.getByText('Checklist saved.', { exact: true }).waitFor();
  assert.equal(template[2].id, id);
  await button('Restore defaults').click();
  await page.getByText('Checklist saved.', { exact: true }).waitFor();
  await page.evaluate(() => window.qa.settings(false)); await button('Yes').waitFor();
  await page.getByText('Are drain valves present on the berms?', { exact: true }).waitFor();
  results.push('Account switch respects empty template; Settings badge, reorder, and restore keep Yes/No');

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const box = await button('Yes').boundingBox(); assert.ok(box.height >= 44);
  }
  await button('No').click(); await idle();
  await page.screenshot({ path: join(output, 'desktop-no.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: join(output, 'mobile-dark-no.png'), fullPage: true });
  assert.deepEqual(errors, []);
  results.push('320/390/1280px layouts fit without horizontal overflow; targets ≥44px; dark mode; no uncaught errors');
  await writeFile(join(output, 'results.json'), JSON.stringify({ passed: results, screenshots: output }, null, 2));
  globalThis.console.log(JSON.stringify({ passed: results, screenshots: output }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
