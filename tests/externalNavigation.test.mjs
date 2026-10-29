import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  appleMapsUrl,
  googleEarthUrl,
  googleMapsUrl,
  launchExternalNavigation,
} from '../src/utils/externalNavigation.ts';

const navigationPopupSource = await readFile(
  new URL('../src/components/NavigationPopup.tsx', import.meta.url),
  'utf8',
);

test('map URLs use universal HTTPS handoffs with encoded coordinates', () => {
  assert.equal(
    googleMapsUrl(35.4676, -97.5164),
    'https://www.google.com/maps/search/?api=1&query=35.4676%2C-97.5164',
  );
  assert.equal(
    appleMapsUrl(35.4676, -97.5164),
    'https://maps.apple.com/?daddr=35.4676%2C-97.5164',
  );
  assert.equal(
    googleEarthUrl(35.4676, -97.5164),
    'https://earth.google.com/web/search/35.4676%2C-97.5164',
  );
});

test('external navigation closes the app overlay before using the current window', () => {
  const calls = [];
  launchExternalNavigation(
    'https://example.test/maps',
    () => calls.push('close'),
    (url) => calls.push(`navigate:${url}`),
  );
  assert.deepEqual(calls, ['close', 'navigate:https://example.test/maps']);
  assert.doesNotMatch(navigationPopupSource, /window\.open/);
  assert.match(navigationPopupSource, /launchExternalNavigation/);
});
