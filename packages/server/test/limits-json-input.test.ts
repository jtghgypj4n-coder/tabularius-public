import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { MAX_JSON_DEPTH, MAX_JSON_QUERY_BYTES, parseRequestJson } from '../src/request-json.ts';

let dir: string;
let server: Server;
let base: string;
let headers: Record<string, string>;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-json-input-'));
  createStore(join(dir, 'Limits' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Limits')!;
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  store.create('Items', { Name: 'one' });
  store.setPassword('Admin', 'pw', '[Full Access]');
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Limits/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') },
  });
  assert.equal(login.status, 200);
  headers = { authorization: `Bearer ${(await login.json()).response.token}`, 'content-type': 'application/json' };
});
after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const nested = (depth: number) => '['.repeat(depth) + '0' + ']'.repeat(depth);

test('agent bodies reject excessive depth and malformed JSON before running a valid plan', async () => {
  const plan = { summary: 'Find items', layout: 'Items', steps: [{ kind: 'find', query: [{ Name: '*' }] }] };
  const valid = JSON.stringify({ plan });
  for (const [body, status] of [
    [valid.slice(0, -1) + ',"extra":' + nested(MAX_JSON_DEPTH) + '}', 400],
    ['{"plan":', 400],
    [valid + ' '.repeat(1_000_000), 413],
    [valid, 200],
  ] as const) {
    const response = await fetch(`${base}/tabularius/agent/v1/databases/Limits/dry-run`, { method: 'POST', headers, body });
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json));
    if (status !== 200) assert.equal(json.error.code, 960);
  }
});

for (const param of ['_sort', 'portal']) {
  test(`Data API ${param} bounds JSON depth and bytes and rejects malformed arrays`, async () => {
    const valid = param === '_sort' ? '[{"fieldName":"Name","sortOrder":"ascend"}]' : '["Contact","History"]';
    const tooDeep = param === '_sort' ? '[{"fieldName":"Name","extra":' + nested(MAX_JSON_DEPTH) + '}]' : nested(MAX_JSON_DEPTH + 1);
    const tooLarge = param === '_sort' ? JSON.stringify([{ fieldName: 'Name', extra: 'x'.repeat(MAX_JSON_QUERY_BYTES) }]) : JSON.stringify(['x'.repeat(MAX_JSON_QUERY_BYTES)]);
    for (const [value, status] of [
      [tooDeep, 400],
      // portal stays as lenient as main: a list that isn't JSON is read as names.
      ['["unfinished"', param === 'portal' ? 200 : 400],
      [tooLarge, 400],
      [valid, 200],
      ...(param === 'portal' ? [['Contact,History', 200], ['[Contact,History]', 200], ['[1,"Contact",null]', 200], ['{"Contact":1}', 200]] as const : []),
    ] as const) {
      const response = await fetch(`${base}/fmi/data/vLatest/databases/Limits/layouts/Items/records?${new URLSearchParams({ [param]: value })}`, { headers });
      const json = await response.json();
      assert.equal(response.status, status, JSON.stringify(json));
      assert.equal(json.messages[0].code, status === 400 ? '960' : '0');
    }
  });
}

test('bounded JSON counts UTF-8 bytes and accepts the exact depth and size limits', () => {
  assert.deepEqual(parseRequestJson(nested(MAX_JSON_DEPTH)), JSON.parse(nested(MAX_JSON_DEPTH)));
  assert.equal(parseRequestJson('"é"', 4), 'é');
  assert.throws(() => parseRequestJson('"é"', 3), /exceeds 3 bytes/);
  assert.equal(parseRequestJson('"' + 'x'.repeat(MAX_JSON_QUERY_BYTES - 2) + '"', MAX_JSON_QUERY_BYTES).length, MAX_JSON_QUERY_BYTES - 2);
});
