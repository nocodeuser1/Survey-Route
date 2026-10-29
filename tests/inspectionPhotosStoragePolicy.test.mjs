import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationName = '20261029190000_inspection_photos_storage_account_scope.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const sql = await readFile(new URL(migrationName, migrationsDir), 'utf8');
const policies = sql.split(/(?=CREATE POLICY)/).slice(1);

test('inspection-photos storage policies replace the bucket-only ones', async () => {
  const earlier = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql') && f <= '20261029162000_inspection_identity.sql');
  assert.ok(earlier.every(f => f < migrationName), 'runs after the migrations that existed when it was written');
  for (const name of ['Users can view their inspection photos', 'Users can upload inspection photos', 'Users can delete their inspection photos']) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS "${name}" ON storage\\.objects;`));
  }
  assert.deepEqual(policies.map(p => p.match(/FOR (\w+)/)[1]), ['SELECT', 'INSERT', 'DELETE']);
});

test('each policy requires access to the account of the inspection named by the path', () => {
  for (const policy of policies) {
    assert.match(policy, /bucket_id = 'inspection-photos'/);
    assert.match(policy, /FROM public\.inspections i/);
    assert.match(policy, /public\.user_has_account_access\(i\.account_id\)/);
    // The uuid cast only happens after the format check, so bad paths fail closed.
    assert.match(policy, /CASE\s+WHEN \(storage\.foldername\(objects\.name\)\)\[1\] ~\* '\^\[0-9a-f\]\{8\}-[^']+\$'\s+THEN \(\(storage\.foldername\(objects\.name\)\)\[1\]\)::uuid\s+END/);
  }
});

test('every app upload path starts with the inspection id', async () => {
  const sources = {
    'InspectionForm.tsx': /`\$\{existingInspection\.id\}\/\$\{questionId\}\//,
    'InspectionViewer.tsx': /`\$\{inspection\.id\}\/\$\{questionId\}\//,
    'DataBackup.tsx': /`\$\{newInspectionId\}\/\$\{photo\.question_id\}\//,
  };
  for (const [file, pattern] of Object.entries(sources)) {
    const source = await readFile(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert.match(source, pattern, file);
  }
});
