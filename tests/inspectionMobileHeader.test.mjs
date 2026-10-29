import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/InspectionForm.tsx', import.meta.url), 'utf8');

test('mobile inspection Back control shares the branded logo row', () => {
  const brandingStart = source.indexOf('{accountBranding.logo_url && (');
  const brandingEnd = source.indexOf('        )}', brandingStart);
  assert.ok(brandingStart >= 0 && brandingEnd > brandingStart);

  const branding = source.slice(brandingStart, brandingEnd);
  assert.match(branding, /data-testid="inspection-mobile-back-in-brand"/);
  assert.match(branding, /absolute left-2 top-1\/2/);
  assert.match(branding, /sm:hidden/);
  assert.match(source, /accountBranding\.logo_url \? 'hidden sm:flex' : 'flex'/);
});
