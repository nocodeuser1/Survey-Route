// Execute the deployed handler sources with in-memory auth/data and a fake
// Google transport. No Deno server, credentials, network or database needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function handler(name, { authorized = true } = {}) {
  let serve;
  const requests = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'fixture', email: 'owner@example.test' } } }) },
    from(table) {
      const values = {
        users: authorized ? { id: 'fixture', email: 'owner@example.test', is_agency_owner: true } : null,
        accounts: { agencies: { owner_email: 'owner@example.test' } },
        facilities: { account_id: 'account' },
      };
      assert.ok(Object.hasOwn(values, table), `Unexpected table ${table}`);
      return { select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: values[table] }),
        order: async () => ({ data: [] }),
      };
    },
  };
  const code = ts.transpileModule(readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports: {}, Request, Response, TextEncoder, ReadableStream,
    console: { log() {}, error() {} },
    Deno: { env: { get: () => 'fixture' }, serve: fn => { serve = fn; } },
    require: id => {
      if (id === 'jsr:@supabase/functions-js/edge-runtime.d.ts') return {};
      assert.equal(id, 'npm:@supabase/supabase-js@2.49.1');
      return { createClient: () => client };
    },
    fetch: async (url, init) => {
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
      requests.push({ url, body: JSON.parse(init.body) });
      const content = name === 'ai-assistant' ? 'Fixture reply' : JSON.stringify({ stops: [{ number: 1, label: 'Start', x: .1, y: .1 }, { number: 2, label: 'Combustor', x: .9, y: .9 }], waypoints: [], legend: {} });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] }) };
    },
  });
  const body = name === 'ai-assistant' ? { accountId: 'account', messages: [{ role: 'user', content: 'Fixture question' }] } : { facilityId: 'facility', imageBase64: 'Zml4dHVyZQ==' };
  return { requests, call: async (extra = {}) => serve(new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({ ...body, ...extra }) })) };
}

for (const [selection, model, level] of [
  ['gemini-3.1-pro', 'gemini-3.1-pro-preview', 'high'],
  ['gemini-3.1-flash', 'gemini-3.5-flash', 'minimal'],
  ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite', 'minimal'],
]) test(`assistant ${selection} uses default sampling and preserves tier`, async () => {
  const h = handler('ai-assistant');
  const result = await h.call({ model: selection });
  assert.equal(result.status, 200);
  assert.match(await result.text(), /Fixture reply/);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].url.endsWith(`/${model}:generateContent`));
  assert.deepEqual(h.requests[0].body.generationConfig, { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: level } });
});

test('LDAR uses default sampling while preserving JSON schema and reasoning', async () => {
  const h = handler('ldar-observation-path');
  const response = await h.call();
  assert.equal(response.status, 200);
  const { body, url } = h.requests[0];
  assert.ok(url.endsWith('/gemini-3.1-pro-preview:generateContent'));
  const config = body.generationConfig;
  for (const key of ['temperature', 'topP', 'topK']) assert.equal(Object.hasOwn(config, key), false);
  assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'medium' });
  assert.equal(config.maxOutputTokens, 8192);
  assert.equal(config.responseMimeType, 'application/json');
  assert.ok(config.responseSchema.properties.stops);
  assert.equal(body.contents[0].parts[0].inlineData.data, 'Zml4dHVyZQ==');
});

for (const name of ['ai-assistant', 'ldar-observation-path']) test(`${name} still denies outsiders before Google`, async () => {
  const h = handler(name, { authorized: false });
  assert.equal((await h.call()).status, 403);
  assert.equal(h.requests.length, 0);
});
