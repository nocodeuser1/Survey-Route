import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routeMapSource = await readFile(
  new URL('../src/components/RouteMap.tsx', import.meta.url),
  'utf8',
);

test('full-screen navigation menu escapes map stacking contexts', () => {
  assert.match(routeMapSource, /showMenu && createPortal\(/);
  assert.match(routeMapSource, /z-\[2147483000\]/);
  assert.match(routeMapSource, /document\.body/);
  assert.match(routeMapSource, /aria-label="Close navigation menu"/);
  assert.match(routeMapSource, /ref=\{fullscreenMenuRef\}[\s\S]*?id="fullscreen-navigation-panel"/);
});
