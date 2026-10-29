import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const form = await readFile(new URL('../src/components/InspectionForm.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('inspection form finds the signature by profile id, not the auth id it is handed', () => {
  // Callers pass the auth user id; user_signatures.user_id references users.id.
  assert.match(app, /<FacilitiesManager[\s\S]*?userId=\{user\?\.authUserId/);
  assert.match(form, /const profileId = user\?\.id/);
  assert.match(form, /from\('user_signatures'\)[\s\S]*?\.eq\('user_id', profileId\)/);
  assert.match(form, /from\('users'\)\s*\.select\('full_name, inspection_email'\)\s*\.eq\('id', profileId\)/);
  assert.doesNotMatch(form, /\.eq\('user_id', userId\)/);
});
