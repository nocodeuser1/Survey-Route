import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const settingsTabs = await readFile(new URL('../src/components/SettingsTabs.tsx', import.meta.url), 'utf8');
const teamManagement = await readFile(new URL('../src/components/TeamManagement.tsx', import.meta.url), 'utf8');
const signatures = await readFile(new URL('../src/components/UserSignatureManagement.tsx', import.meta.url), 'utf8');
const agencySettings = await readFile(new URL('../src/components/AgencySettings.tsx', import.meta.url), 'utf8');

test('mobile settings use a native section list while desktop tabs remain available', () => {
  assert.match(settingsTabs, /aria-label="Settings sections"/);
  assert.match(settingsTabs, /setMobileSectionOpen\(true\)/);
  assert.match(settingsTabs, /Back to Settings/);
  assert.match(settingsTabs, /hidden border-b[\s\S]*?sm:block/);
});

test('team management has mobile cards and bounded mobile notices', () => {
  assert.match(teamManagement, /space-y-3 sm:hidden/);
  assert.match(teamManagement, /visibleTeamMembers\.map/);
  assert.match(teamManagement, /fixed inset-x-4 top-4 z-\[110\]/);
  assert.match(teamManagement, /break-all font-medium/);
});

test('agency settings use a full-screen mobile sheet and compact section picker', () => {
  assert.match(agencySettings, /h-full w-full overflow-y-auto/);
  assert.match(agencySettings, /Settings section/);
  assert.match(agencySettings, /sm:hidden/);
  assert.match(agencySettings, /flex flex-col gap-3 sm:flex-row/);
});

test('landscape signature pad recalibrates its backing store after rotation', () => {
  assert.match(signatures, /new ResizeObserver\(calibrate\)/);
  assert.match(signatures, /window\.devicePixelRatio/);
  assert.match(signatures, /canvas\.width = expectedWidth/);
  assert.match(signatures, /canvas\.height = expectedHeight/);
  assert.match(signatures, /signatureCanvasShell/);
});
