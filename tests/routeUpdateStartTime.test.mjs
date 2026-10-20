import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const routeResults = await readFile(
  new URL('../src/components/RouteResults.tsx', import.meta.url),
  'utf8',
);

test('both Update route settings surfaces expose the all-days start time', () => {
  assert.equal(
    routeResults.match(/Start Time for All Days/g)?.length,
    2,
    'the compact settings panel and full route dialog should both expose the field',
  );
  assert.equal(
    routeResults.match(/value=\{tempSettings\.start_time \|\| '08:00'\}/g)?.length,
    2,
    'both fields should be bound to the editable settings value',
  );
});

test('both update actions persist the edited start time', () => {
  assert.equal(
    routeResults.match(/start_time: tempSettings\.start_time \|\| '08:00'/g)?.length,
    2,
    'refresh-only and re-optimize should save the selected start time',
  );
  const updateHandlers = routeResults.slice(
    routeResults.indexOf('const handleRefreshWithSettings'),
    routeResults.indexOf('const handleRestoreExcluded'),
  );
  assert.doesNotMatch(
    updateHandlers,
    /start_time: settings\??\.start_time \|\| '08:00'/,
    'update actions must not overwrite the edit with the old settings value',
  );
});
