import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const registerSource = await readFile(new URL('../src/lib/registerSW.ts', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

test('service worker reports its actual build version', () => {
  assert.match(workerSource, /GET_BUILD_VERSION/);
  assert.match(workerSource, /buildVersion: BUILD_VERSION/);
});

test('same-build worker catch-up never triggers the new-version banner', () => {
  assert.match(registerSource, /workerVersion === __BUILD_COMMIT__/);
  assert.match(registerSource, /waitingWorker = null/);
  assert.match(registerSource, /considerWaitingWorker\(reg\.waiting\)/);
});
