/**
 * Real Leaflet mobile-browser QA with synthetic location fixes and local assets.
 * Tiles are replaced by a neutral image; no location or app data leave the test.
 *
 * npm install --prefix /tmp/survey-route-test-tools playwright
 * PLAYWRIGHT_MODULE=/tmp/survey-route-test-tools/node_modules/playwright/index.mjs \
 *   node tests/routeMapLocation.browser.mjs
 * QA_PREVIEW=1 serves 390px/320px interactive fixtures without launching Chromium.
 * CHROMIUM_PATH defaults to /usr/bin/chromium; QA_OUTPUT_DIR retains screenshots.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildLocationHarness } from './routeMapLocationHarness.mjs';

const root = resolve(import.meta.dirname, '..');
const output = process.env.QA_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'survey-location-browser-'));
await mkdir(output, { recursive: true });
await buildLocationHarness(output, { realLeaflet: true });
execFileSync(process.execPath, [join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', 'src/index.css', '-o', join(output, 'app.css'), '--minify'], { cwd: root, stdio: 'pipe' });
const leafletCss = await readFile(join(root, 'node_modules/leaflet/dist/leaflet.css'));
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/leaflet.css"><link rel="stylesheet" href="/app.css"><style>html,body,#root{height:100dvh;width:100%;margin:0;overflow:hidden}.leaflet-container{background:#e7edf0}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const previewInit = `<script>
window.__locationTest = { maps: [], requests: [], trackingChanges: [], targetClears: 0, exits: 0, routeUpdates: 0, views: [], alerts: [] };
window.alert = message => window.__locationTest.alerts.push(message);
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
  getCurrentPosition(success, error, options) { window.__locationTest.requests.push({ success, error, options }); },
  clearWatch() {},
} });
window.deliverGPS = () => window.__locationTest.requests.at(-1)?.success({ coords: { latitude: 40.25, longitude: -104.8, accuracy: 5, heading: null, speed: null }, timestamp: Date.now() });
window.denyGPS = () => window.__locationTest.requests.at(-1)?.error({ code: 1, message: 'Mock permission denied' });
window.zoomMap = zoom => window.__locationTest.maps[0].setView(zoom === 4 ? [39.8283, -98.5795] : [34.05, -118.24], zoom, { animate: false });
</script>`;
const previewToolbar = `<div style="position:fixed;bottom:8px;left:8px;right:8px;z-index:20000;font:11px system-ui;background:#fff;border:1px solid #bcc6d2;border-radius:6px;padding:6px;display:flex;gap:5px;flex-wrap:wrap"><span style="width:100%;color:#475569">Synthetic QA controls (no real location or network)</span><button onclick="zoomMap(4)" style="padding:5px;border:1px solid #999">World zoom 4</button><button onclick="zoomMap(18)" style="padding:5px;border:1px solid #999">Street zoom 18</button><button onclick="deliverGPS()" style="padding:5px;border:1px solid #999">Deliver mock GPS</button><button onclick="denyGPS()" style="padding:5px;border:1px solid #999">Deny location</button></div>`;
const previewHtml = html.replace('<script src="/app.js">', previewInit + '<script src="/app.js">').replace('</body>', previewToolbar + '</body>');
const frameHtml = '<!doctype html><html><body style="margin:20px;background:#dbe3ed;font:14px system-ui"><h1 style="font-size:18px">RouteMap synthetic mobile QA</h1><p>Each phone frame runs real Leaflet. Tap Find me, then Deliver mock GPS or Deny location below.</p><div style="display:flex;gap:24px"><div><p>390 × 844</p><iframe title="390px phone" src="/app" width="390" height="844" style="border:0"></iframe></div><div><p>320 × 844</p><iframe title="320px phone" src="/app" width="320" height="844" style="border:0"></iframe></div></div></body></html>';
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/app.js' || pathname === '/app.css') {
    response.setHeader('Content-Type', pathname.endsWith('js') ? 'text/javascript' : 'text/css');
    response.end(await readFile(join(output, pathname.slice(1))));
  } else if (pathname === '/leaflet.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(leafletCss);
  } else { response.setHeader('Content-Type', 'text/html'); response.end(process.env.QA_PREVIEW === '1' ? (pathname === '/app' ? previewHtml : frameHtml) : html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
if (process.env.QA_PREVIEW === '1') {
  console.log('Synthetic real-Leaflet preview: ' + base);
  console.log('Assets: ' + output);
  await new Promise(() => {});
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
const results = [];
const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
try {
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      if (route.request().url().startsWith(base)) await route.continue();
      else await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
    });
    await page.addInitScript(() => {
      window.__locationTest = { maps: [], requests: [], trackingChanges: [], targetClears: 0, exits: 0, routeUpdates: 0, views: [], alerts: [], withMapData: true, initialTarget: { latitude: 42.12, longitude: -101.34 } };
      window.alert = message => window.__locationTest.alerts.push(message);
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        getCurrentPosition(success, error, options) { window.__locationTest.requests.push({ success, error, options }); },
        clearWatch() {},
      } });
    });
    await page.goto(base); await page.getByRole('button', { name: 'Find my location', exact: true }).waitFor();
    await page.waitForFunction(() => window.__locationTest.maps.length === 1);
    const waitForFacility = async (latitude, longitude) => {
      await page.waitForFunction(({ latitude, longitude }) => {
        const map = window.__locationTest.maps.at(-1), center = map.getCenter();
        return Math.abs(center.lat - latitude) < 0.00001 && Math.abs(center.lng - longitude) < 0.00001 && map.getZoom() === 18;
      }, { latitude, longitude });
    };
    await waitForFacility(42.12, -101.34);
    for (const zoom of [4, 18]) {
      await page.evaluate(zoom => {
        const qa = window.__locationTest;
        qa.maps.at(-1).setView([34, -118], zoom, { animate: false });
        qa.setTarget({ latitude: 46.2, longitude: -104.3 });
      }, zoom);
      await waitForFacility(46.2, -104.3);
    }
    await page.evaluate(() => {
      const qa = window.__locationTest;
      qa.setTarget({ latitude: 32, longitude: -100 });
      qa.setTarget({ latitude: 41, longitude: -108 });
    });
    await waitForFacility(41, -108);
    await page.evaluate(() => window.__locationTest.rerender());
    await page.waitForTimeout(200);
    await waitForFacility(41, -108);
    await page.screenshot({ path: join(output, width + '-facility-focus.png') });
    results.push({ width, scenario: 'Facility mount, world/street zoom, repeated target, rapid switch and redraw', status: 'passed' });
    const layout = async state => {
      const measurements = await page.evaluate(() => {
        const labels = ['Update route settings', 'Exit fullscreen map', 'Turn on drive mode'];
        const primary = [...document.querySelectorAll('button')].find(button => /Find my location|Finding your location/.test(button.getAttribute('aria-label') || ''));
        const buttons = [...labels.map(label => document.querySelector(`[aria-label="${label}"]`)), primary].filter(Boolean);
        const rects = buttons.map(button => { const rect = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label'), text: button.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
        const span = document.querySelector('[aria-label="Update route settings"] span');
        return { rects, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, updateDisplay: getComputedStyle(span).display, alertRect: document.querySelector('[role="alert"]')?.getBoundingClientRect().toJSON() };
      });
      assert.equal(measurements.documentWidth, width, 'No horizontal overflow');
      assert.notEqual(measurements.updateDisplay, 'none', 'Update Route text is visible on mobile');
      for (const rect of measurements.rects) {
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, rect.label + ' fits horizontally');
        assert.ok(rect.y >= 0 && rect.y + rect.height <= 845, rect.label + ' fits vertically');
        assert.ok(rect.width >= 44 && rect.height >= 44, rect.label + ' has at least a 44px target');
      }
      for (let a = 0; a < measurements.rects.length; a++) for (let b = a + 1; b < measurements.rects.length; b++) {
        const first = measurements.rects[a]; const second = measurements.rects[b];
        const overlaps = first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
        assert.equal(overlaps, false, first.label + ' does not overlap ' + second.label);
      }
      if (measurements.alertRect) assert.ok(measurements.alertRect.x >= 0 && measurements.alertRect.right <= width + 1, 'Error panel fits mobile viewport');
      await page.screenshot({ path: join(output, `${width}-${state}.png`), fullPage: true });
      results.push({ width, state, measurements });
    };
    await layout('idle');
    for (const [zoom, start, target] of [
      [4, [39.8283, -98.5795], [40.25, -104.8]],
      [18, [40.25, -104.8], [34.05, -118.24]],
    ]) {
      await page.evaluate(({ zoom, start }) => window.__locationTest.maps[0].setView(start, zoom, { animate: false }), { zoom, start });
      await page.getByRole('button', { name: 'Find my location', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Finding your location', exact: true }).isDisabled(), true);
      await layout(`pending-from-zoom-${zoom}`);
      await page.evaluate(target => {
        const qa = window.__locationTest; const map = qa.maps[0]; qa.moveCount = 0;
        map.on('move', () => qa.moveCount++);
        qa.requests.at(-1).success({ coords: { latitude: target[0], longitude: target[1], accuracy: 5, heading: null, speed: null }, timestamp: Date.now() });
      }, target);
      await page.waitForFunction(target => {
        const map = window.__locationTest.maps[0]; const center = map.getCenter();
        return Math.abs(center.lat - target[0]) < 0.00001 && Math.abs(center.lng - target[1]) < 0.00001 && map.getZoom() === 18;
      }, target);
      const motion = await page.evaluate(() => ({ moveCount: window.__locationTest.moveCount, tracking: window.__locationTest.state.tracking, busy: !!document.querySelector('[aria-busy="true"]') }));
      assert.ok(motion.moveCount > 2, 'Real Leaflet animates multiple frames from zoom ' + zoom);
      assert.equal(motion.tracking, true); assert.equal(motion.busy, false);
      await layout(`success-from-zoom-${zoom}`);
    }
    await page.getByRole('button', { name: 'Find my location', exact: true }).click();
    await page.evaluate(() => window.__locationTest.requests.at(-1).error({ code: 1, message: 'Mock permission denied' }));
    await page.getByRole('alert').waitFor(); await layout('permission-error');
    assert.deepEqual(await page.evaluate(() => window.__locationTest.alerts), []);
    await context.close();
    console.log('PASS real Leaflet animated recenter, feedback, and controls at ' + width + 'px');
  }
  assert.deepEqual(errors, [], 'No browser exceptions');
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Browser screenshots and report: ' + output);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
