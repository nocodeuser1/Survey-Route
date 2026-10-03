/**
 * Real RouteMap component integration tests with deterministic GPS and Leaflet.
 * No real GPS, network, Supabase, tiles, or user data are used.
 *
 * npm ci
 * npm install --prefix /tmp/survey-route-test-tools jsdom
 * JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js \
 *   node tests/routeMapLocation.integration.mjs
 *
 * QA_OUTPUT_DIR optionally retains the bundled harness. Fake time advances only
 * long timeouts and intervals, keeping the 12-second watchdog test instant.
 * These DOM tests verify responsive label classes; visual layout still needs a
 * real mobile browser pass.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildLocationHarness } from './routeMapLocationHarness.mjs';

const output = process.env.QA_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'survey-location-qa-'));
await mkdir(output, { recursive: true });
const { JSDOM, VirtualConsole } = await import(process.env.JSDOM_MODULE || 'jsdom');

await buildLocationHarness(output);
const bundled = await readFile(join(output, 'app.js'), 'utf8');
const results = [];
let failures = 0;

async function mount({ reducedMotion = false, unsupported = false, throws = false, withMapData = false, withHomeBase = false, initialTarget = null } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://location-test.invalid', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  });
  const window = dom.window;
  const qa = window.__locationTest = { maps: [], requests: [], trackingChanges: [], targetClears: 0, exits: 0, routeUpdates: 0, views: [], alerts: [], errors, withMapData, withHomeBase, initialTarget };
  window.alert = message => qa.alerts.push(message);
  window.fetch = () => { throw new Error('No network access is permitted in this test'); };
  window.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion') && reducedMotion, media: query, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window, 'innerWidth', { value: 390 });
  if (!unsupported) Object.defineProperty(window.navigator, 'geolocation', { value: {
    getCurrentPosition(success, error, options) {
      if (throws) throw new Error('Geolocation API failed synchronously');
      qa.requests.push({ success, error, options });
    },
    clearWatch() {},
  } });
  let time = 0;
  let nextId = 100000;
  const scheduled = new Map();
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (callback, ms = 0, ...args) => {
    if (ms < (withMapData ? 50 : 1000)) return nativeSetTimeout(callback, ms, ...args);
    const id = nextId++; scheduled.set(id, { at: time + ms, callback: () => callback(...args), interval: 0 }); return id;
  };
  window.clearTimeout = id => { scheduled.delete(id); nativeClearTimeout(id); };
  window.setInterval = (callback, ms) => { const id = nextId++; scheduled.set(id, { at: time + ms, callback, interval: ms }); return id; };
  window.clearInterval = id => scheduled.delete(id);
  const flush = () => delay(40);
  const wait = async (condition, message = 'component state') => {
    for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await delay(10); }
    throw new Error('Timed out waiting for ' + message + (errors.length ? ': ' + errors.map(e => e.message).join('; ') : ''));
  };
  const advance = async milliseconds => {
    const until = time + milliseconds;
    for (let count = 0; count < 200; count++) {
      const next = [...scheduled].filter(([, event]) => event.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) { time = until; await flush(); return; }
      const [id, event] = next; time = event.at;
      if (event.interval) event.at += event.interval; else scheduled.delete(id);
      event.callback(); await flush();
    }
    throw new Error('Fake clock exhausted its event limit');
  };
  const doc = window.document;
  const button = name => [...doc.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === name || node.textContent.trim() === name);
  const primary = () => button('Find my location') || [...doc.querySelectorAll('button')].find(node => /Finding you/.test(node.textContent));
  const click = async name => { const element = button(name); assert.ok(element, 'Missing button: ' + name); element.click(); await flush(); return element; };
  const position = (latitude = 40.25, longitude = -104.8) => ({ coords: { latitude, longitude, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
  const success = async (request, latitude, longitude) => { request.success(position(latitude, longitude)); await flush(); };
  const reject = async (request, code) => { request.error({ code, message: 'Mock GPS error', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); await flush(); };
  const map = () => qa.maps.at(-1);
  const movements = (target = map()) => target.calls.filter(call => ['setView', 'flyTo', 'panTo'].includes(call.method));
  const busy = () => { assert.ok(primary(), 'Location action remains present'); assert.equal(primary().disabled, true); assert.equal(primary().getAttribute('aria-busy'), 'true'); assert.match(primary().textContent, /Finding you/); };
  const idle = () => { assert.ok(button('Find my location'), 'Find my location action is available'); assert.equal(button('Find my location').disabled, false); };
  const noAlertDialogs = () => assert.deepEqual(qa.alerts, [], 'GPS failures must be inline rather than blocking alert dialogs');
  window.eval(bundled);
  await wait(() => qa.maps.length && doc.querySelector('button'), 'RouteMap mount');
  await flush();
  return { qa, dom, window, doc, button, primary, click, position, success, reject, map, movements, busy, idle, flush, wait, advance, noAlertDialogs,
    close: async () => { qa.destroy(); await flush(); window.close(); } };
}

async function test(name, callback, options) {
  let harness;
  try {
    harness = await mount(options); await callback(harness);
    assert.deepEqual(harness.qa.errors, [], 'No uncaught component errors');
    harness.noAlertDialogs();
    results.push({ name, status: 'passed' }); console.log('PASS ' + name);
  } catch (error) {
    failures++; results.push({ name, status: 'failed', error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
  } finally { await harness?.close(); }
}

await test('Facility target on initial mount wins over route bounds', async h => {
  assert.equal(h.map().getCenter().lat, 42.12);
  assert.equal(h.map().getCenter().lng, -101.34);
  assert.equal(h.map().getZoom(), 18);
}, { withMapData: true, initialTarget: { latitude: 42.12, longitude: -101.34 } });

await test('Rapid facility switches, repeat taps, redraws and clearing preserve the selected viewport', async h => {
  h.qa.setTarget({ latitude: 35, longitude: -111 });
  h.qa.setTarget({ latitude: 44, longitude: -102 });
  await h.flush();
  assert.equal(h.map().getCenter().lat, 44);
  h.map().setView([25, -90], 4);
  h.qa.setTarget({ latitude: 44, longitude: -102 }); await h.flush();
  assert.equal(h.map().getCenter().lat, 44); assert.equal(h.map().getZoom(), 18);
  assert.equal(h.map().markers.filter(marker => marker.options.title === 'Selected facility location').length, 1);
  h.qa.rerender(); await h.flush(); await h.advance(100);
  assert.equal(h.map().getCenter().lat, 44);
  h.qa.setTarget(null); h.qa.rerender(); await h.flush(); await h.advance(100);
  assert.equal(h.map().getCenter().lat, 44);
  assert.equal(h.map().markers.filter(marker => marker.options.title === 'Selected facility location').length, 0);
}, { withMapData: true });

await test('Facility focus survives missing route and home base', async h => {
  assert.ok(h.map().markers.some(marker => marker.options.title === 'Selected facility location' && marker.point.lat === 42.12));
  assert.equal(h.map().getCenter().lat, 42.12); assert.equal(h.map().getZoom(), 18);
}, { initialTarget: { latitude: 42.12, longitude: -101.34 } });

await test('Unmount cancels pending facility animation', async h => {
  h.qa.setTarget({ latitude: 50, longitude: -100 });
  h.qa.unmount(); await h.flush();
  const count = h.movements().length; await h.flush();
  assert.equal(h.movements().length, count); assert.equal(h.map().removed, true);
});

await test('Actual Navigate popup and shared App handoff deliver selected coordinates repeatedly', async h => {
  for (const latitude of [36.4, 47.2, 47.2]) {
    h.map().setView([25, -80], 4);
    h.qa.openNavigation({ latitude, longitude: -103.5 }); await h.flush();
    const show = [...h.doc.querySelectorAll('button')].find(node => node.textContent.includes('Show on App Map'));
    assert.ok(show); show.click(); await h.flush();
    assert.equal(h.qa.state.currentView, 'route-planning');
    assert.equal(h.qa.state.fullscreen, true);
    assert.equal(h.map().getCenter().lat, latitude);
    assert.equal(h.map().getCenter().lng, -103.5);
    assert.equal(h.map().getZoom(), 18);
    assert.ok(!h.doc.body.textContent.includes('Navigate to'));
  }
}, { withMapData: true });

await test('Interrupted mount retains the latest facility request on reopening', async h => {
  h.qa.setTarget({ latitude: 48.1, longitude: -107.2 });
  h.qa.unmount(); await h.flush();
  h.qa.mount(); await h.flush(); await h.flush();
  assert.equal(h.map().getCenter().lat, 48.1);
  assert.equal(h.map().getCenter().lng, -107.2);
  assert.equal(h.map().getZoom(), 18);
}, { withMapData: true });

await test('Show all facilities uses home base loaded after the map mounts', async h => {
  h.qa.withHomeBase = true; h.qa.rerender(); await h.flush();
  h.map().setView([30, -90], 18);
  h.doc.querySelector('[title="Show all facilities"]').click(); await h.flush();
  assert.equal(h.map().getCenter().lat, 39.7);
  assert.equal(h.map().getZoom(), 13);
});

await test('Fresh request, disabled duplicate taps, smooth first fix, and repeat recenter', async h => {
  h.idle(); assert.match(h.primary().textContent, /Find me/);
  assert.equal(h.qa.requests.length, 0, 'GPS is requested only after user action');
  const primary = h.primary(); primary.click(); primary.click(); await h.flush();
  h.busy(); assert.equal(h.qa.requests.length, 1, 'Rapid taps do not create overlapping requests');
  assert.equal(h.qa.requests[0].options.maximumAge, 0);
  assert.equal(h.qa.requests[0].options.enableHighAccuracy, true);
  assert.ok(h.qa.requests[0].options.timeout > 0 && h.qa.requests[0].options.timeout <= 12000);
  await h.success(h.qa.requests[0]); h.idle();
  assert.equal(h.qa.state.tracking, true);
  assert.ok(h.button('Stop following'), 'Stopping follow is a separate explicit action');
  const first = h.movements().at(-1); assert.equal(first.method, 'flyTo');
  assert.equal(first.point.lat, 40.25); assert.equal(first.point.lng, -104.8); assert.ok(first.zoom >= 16);
  assert.equal(h.map().markers.at(-1).point.lat, 40.25);
  const count = h.movements().length;
  await h.click('Find my location'); h.busy();
  assert.equal(h.qa.requests.length, 2); assert.equal(h.qa.state.tracking, true, 'Repeat primary tap does not toggle follow off');
  assert.equal(h.qa.requests[1].options.maximumAge, 0);
  await h.success(h.qa.requests[1]); h.idle();
  assert.equal(h.movements().length, count + 1, 'Same-coordinate repeat still recenters');
  await h.click('Stop following'); assert.equal(h.qa.state.tracking, false);
});

for (const [name, code, description] of [
  ['Permission denied', 1, /permission|allow|access/i],
  ['Position unavailable', 2, /unavailable|signal|services/i],
  ['Native timeout', 3, /timed out|timeout|too long/i],
]) await test(name + ' shows inline recovery and retry succeeds', async h => {
  await h.click('Find my location'); const before = h.movements().length;
  await h.reject(h.qa.requests[0], code); h.idle();
  assert.equal(h.qa.state.tracking, false);
  assert.match(h.doc.querySelector('[role="alert"]')?.textContent || '', description);
  assert.equal(h.movements().length, before, 'Failure does not move the map');
  await h.click('Retry location'); h.busy(); assert.equal(h.qa.requests.length, 2);
  await h.success(h.qa.requests[1]); h.idle();
  assert.equal(h.doc.querySelector('[role="alert"]'), null); assert.equal(h.qa.state.tracking, true);
});

await test('Silent provider is bounded by watchdog; late result cannot spoil retry', async h => {
  await h.click('Find my location'); const abandoned = h.qa.requests[0];
  await h.advance(11999); h.busy(); assert.equal(h.qa.requests.length, 1);
  await h.advance(1); h.idle(); assert.equal(h.qa.state.tracking, false);
  assert.match(h.doc.querySelector('[role="alert"]')?.textContent || '', /timed out|timeout|too long/i);
  await h.click('Retry location'); const newest = h.qa.requests.at(-1); h.busy();
  const count = h.movements().length;
  await h.success(abandoned, 1, 2); h.busy(); assert.equal(h.movements().length, count);
  await h.success(newest, 41, -105); h.idle(); assert.equal(h.movements().at(-1).point.lat, 41);
});

await test('Cancel locating invalidates both stale success and stale error callbacks', async h => {
  await h.click('Find my location'); const abandoned = h.qa.requests[0];
  await h.click('Cancel locating'); h.idle(); assert.equal(h.qa.state.tracking, false);
  await h.click('Find my location'); h.busy(); const newest = h.qa.requests.at(-1);
  const count = h.movements().length;
  await h.success(abandoned, 5, 5); await h.reject(abandoned, 1);
  h.busy(); assert.equal(h.doc.querySelector('[role="alert"]'), null); assert.equal(h.movements().length, count);
  await h.success(newest, 42, -106); h.idle(); assert.equal(h.movements().at(-1).point.lat, 42);
});

await test('Panning during initial request cancels follow and ignores late GPS', async h => {
  await h.click('Find my location'); const pending = h.qa.requests[0];
  h.map().fire('dragstart'); h.map().fire('dragend'); await h.flush();
  h.idle(); assert.equal(h.qa.state.tracking, false);
  const count = h.movements().length; await h.success(pending);
  assert.equal(h.movements().length, count); assert.equal(h.qa.state.tracking, false);
});

await test('Panning after success stops follow and cancels an in-flight poll', async h => {
  await h.click('Find my location'); await h.success(h.qa.requests[0]);
  await h.advance(3000); assert.equal(h.qa.requests.length, 2, 'Follow polling remains available'); const pending = h.qa.requests[1];
  h.map().fire('dragstart'); h.map().fire('dragend'); await h.flush();
  assert.equal(h.qa.state.tracking, false); const count = h.movements().length;
  await h.success(pending, 44, -106); assert.equal(h.movements().length, count);
  const requests = h.qa.requests.length; await h.advance(15000); assert.equal(h.qa.requests.length, requests);
});

await test('Manual facility target wins over pending GPS, and Find me clears target', async h => {
  await h.click('Find my location'); const pending = h.qa.requests[0];
  h.qa.setTarget({ latitude: 33, longitude: -117 }); await h.flush();
  assert.equal(h.qa.state.tracking, false); h.idle();
  assert.equal(h.movements().at(-1).point.lat, 33); const count = h.movements().length;
  await h.success(pending); assert.equal(h.movements().length, count);
  await h.click('Find my location'); assert.equal(h.qa.state.target, null); h.busy();
  await h.success(h.qa.requests.at(-1), 34, -118); h.idle(); assert.equal(h.movements().at(-1).point.lat, 34);
});

await test('New explicit recenter supersedes an older follow poll', async h => {
  await h.click('Find my location'); await h.success(h.qa.requests[0]);
  await h.advance(3000); const oldPoll = h.qa.requests[1]; assert.ok(oldPoll);
  await h.click('Find my location'); const fresh = h.qa.requests.at(-1);
  assert.notEqual(fresh, oldPoll); await h.success(fresh, 45, -110);
  const count = h.movements().length; await h.success(oldPoll, 39, -100);
  assert.equal(h.movements().length, count); assert.equal(h.map().markers.at(-1).point.lat, 45);
});

await test('Fullscreen exit stops tracking and ignores pending location', async h => {
  await h.click('Find my location'); const pending = h.qa.requests[0];
  await h.click('Exit fullscreen map'); assert.equal(h.qa.exits, 1); assert.equal(h.qa.state.tracking, false);
  const count = h.movements().length; await h.success(pending); assert.equal(h.movements().length, count);
  assert.equal(h.button('Find my location'), undefined);
});

await test('Parent fullscreen transition also invalidates pending location', async h => {
  await h.click('Find my location'); const pending = h.qa.requests[0];
  h.qa.setFullscreen(false); await h.flush(); assert.equal(h.qa.state.tracking, false);
  const count = h.movements().length; await h.success(pending); assert.equal(h.movements().length, count);
});

await test('Remount and unmount cannot leak GPS callbacks into the replacement map', async h => {
  await h.click('Find my location'); const abandoned = h.qa.requests[0]; const oldMap = h.map();
  h.qa.remount(); await h.flush(); assert.equal(oldMap.removed, true); assert.notEqual(h.map(), oldMap);
  await h.click('Find my location'); const fresh = h.qa.requests.at(-1); h.busy();
  const count = h.movements().length; await h.success(abandoned); await h.reject(abandoned, 1);
  h.busy(); assert.equal(h.movements().length, count); assert.equal(h.doc.querySelector('[role="alert"]'), null);
  await h.success(fresh, 46, -111); h.idle();
  await h.click('Find my location'); const pending = h.qa.requests.at(-1); const currentMap = h.map(); const currentCount = h.movements(currentMap).length;
  h.qa.unmount(); await h.flush(); await h.success(pending); await h.advance(15000);
  assert.equal(currentMap.removed, true); assert.equal(h.movements(currentMap).length, currentCount);
});

await test('Invalid coordinates fail inline without putting a marker on the map', async h => {
  await h.click('Find my location'); const count = h.movements().length;
  await h.success(h.qa.requests[0], NaN, 190); h.idle();
  assert.ok(h.doc.querySelector('[role="alert"]')); assert.equal(h.qa.state.tracking, false);
  assert.equal(h.movements().length, count); assert.equal(h.map().markers.length, 0);
});

await test('Unavailable geolocation API fails inline and leaves usable controls', async h => {
  await h.click('Find my location'); h.idle(); assert.equal(h.qa.state.tracking, false);
  assert.match(h.doc.querySelector('[role="alert"]')?.textContent || '', /support|available|browser/i);
}, { unsupported: true });

await test('Synchronous geolocation exception settles instead of leaving a spinner', async h => {
  await h.click('Find my location'); h.idle(); assert.equal(h.qa.state.tracking, false);
  assert.ok(h.doc.querySelector('[role="alert"]'));
}, { throws: true });

await test('Reduced motion uses direct non-animated centering', async h => {
  await h.click('Find my location'); await h.success(h.qa.requests[0]);
  const movement = h.movements().at(-1);
  assert.equal(movement.method, 'setView'); assert.equal(movement.options.animate, false);
}, { reducedMotion: true });

await test('Mobile Update Route has visible words and still opens route settings', async h => {
  const update = h.button('Update route settings'); assert.ok(update);
  const label = [...update.querySelectorAll('span')].find(node => /update route/i.test(node.textContent)); assert.ok(label);
  for (let node = label; node && node !== update.parentElement; node = node.parentElement) {
    assert.equal(node.classList.contains('hidden'), false, 'Update route text must not be hidden below sm');
    assert.equal(node.getAttribute('aria-hidden'), null);
  }
  await h.click('Find my location'); const pending = h.qa.requests[0];
  await h.click('Update route settings'); assert.equal(h.qa.routeUpdates, 1); assert.equal(h.qa.exits, 1); assert.equal(h.qa.state.tracking, false);
  const count = h.movements().length; await h.success(pending); assert.equal(h.movements().length, count);
});

await test('Fresh parent facilities props cannot restore an old map view after fast GPS success', async h => {
  assert.equal(h.map().markers.length, 1, 'Synthetic home marker renders');
  assert.ok(h.map().calls.some(call => call.method === 'fitBounds'), 'Initial route bounds are fitted');
  h.map().setView([30, -90], 4, { animate: false });
  h.qa.rerender(); await h.flush(); // Marker redraw schedules the old view restore.
  await h.click('Find my location');
  await h.success(h.qa.requests[0], 47, -112);
  const count = h.movements().length;
  await h.advance(50);
  assert.equal(h.movements().length, count, 'Delayed restore cannot overwrite accepted GPS');
  assert.equal(h.map().getCenter().lat, 47); assert.equal(h.map().getZoom(), 18);
  h.qa.rerender(); await h.flush(); await h.advance(50);
  assert.equal(h.map().getCenter().lat, 47, 'Fresh props while following preserve GPS viewport');
  assert.equal(h.movements().length, count, 'Fresh parent rerenders do not refit or restore');
}, { withMapData: true });

await test('No-route home base never steals manual viewport on GPS failure or Stop following', async h => {
  assert.equal(h.map().markers.length, 1, 'Synthetic home marker renders without a route');
  h.map().setView([30, -90], 8, { animate: false });
  await h.click('Find my location'); const beforeFailure = h.movements().length;
  await h.reject(h.qa.requests[0], 1); h.idle();
  assert.equal(h.movements().length, beforeFailure, 'Denied location does not recenter home');
  assert.equal(h.map().getCenter().lat, 30); assert.equal(h.map().getZoom(), 8);
  await h.click('Retry location'); await h.success(h.qa.requests.at(-1), 48, -113);
  const beforeStop = h.movements().length;
  await h.click('Stop following');
  assert.equal(h.movements().length, beforeStop, 'Stop following preserves the accepted viewport');
  assert.equal(h.map().getCenter().lat, 48); assert.equal(h.map().getZoom(), 18);
}, { withHomeBase: true });

await test('Silent follow polls are bounded, never stack, and recover without duplicate requests', async h => {
  await h.click('Find my location'); await h.success(h.qa.requests[0]);
  await h.advance(3000); assert.equal(h.qa.requests.length, 2);
  const stalled = h.qa.requests[1];
  await h.advance(11999); assert.equal(h.qa.requests.length, 2, 'No overlapping follow requests');
  await h.advance(1); assert.ok(h.doc.querySelector('[role="alert"]'), 'Polling watchdog reports the timeout');
  await h.advance(3000); assert.equal(h.qa.requests.length, 3, 'Polling resumes after its bounded timeout');
  await h.success(h.qa.requests[2], 49, -114);
  assert.equal(h.doc.querySelector('[role="alert"]'), null); assert.equal(h.qa.state.tracking, true);
  const count = h.movements().length; await h.success(stalled, 29, -99);
  assert.equal(h.movements().length, count, 'Late timed-out poll cannot move the map');
  assert.equal(h.map().markers.at(-1).point.lat, 49);
});

await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log('\n' + (results.length - failures) + '/' + results.length + ' location integration cases passed. Report: ' + join(output, 'results.json'));
if (failures) process.exitCode = 1;
