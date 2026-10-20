import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';

let dir: string;
let server: Server;
let base: string;
let auth: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-api-find-operators-'));
  createStore(join(dir, 'Find' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url + '/fmi/data/vLatest/databases/Find';
  const store = s.host.get('Find')!;
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Name' }, { name: 'Code' }, { name: 'Number', type: 'number' },
    { name: 'Day', type: 'date' }, { name: 'Time', type: 'time' }, { name: 'Stamp', type: 'timestamp' },
    { name: 'Photo', type: 'container' },
  ] }]);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  store.create('Items', { Name: 'café', Code: 'A3x', Day: day, Stamp: day + 'T23:59:59' });
  store.create('Items', { Name: 'café', Code: 'A30x', Day: 'not a date', Time: '12:60:00', Stamp: '2025-02-29T12:00:00' });
  store.create('Items', { Name: 'other', Code: 'Axx', Number: 0 });
  store.applyDesign([{ op: 'createTable', name: 'Limits', fields: [{ name: 'Text' }] }]);
  store.create('Limits', { Text: 'a'.repeat(100000) });
  store.setPassword('Admin', 'pw', '[Full Access]');
  const login = await fetch(base + '/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const body = await login.json();
  assert.equal(body.messages[0].code, '0');
  auth = 'Bearer ' + body.response.token;
});

after(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  if (dir) rmSync(dir, { recursive: true, force: true });
});

for (const [operator, query, count] of [
  ['!', [{ Name: '!' }, { Code: '==A30x', omit: 'true' }], 1],
  ['//', [{ Day: '//...//' }], 1],
  ['// timestamp', [{ Stamp: '//' }], 1],
  ['? date', [{ Day: '?' }], 1],
  ['? time', [{ Time: '?' }], 1],
  ['? timestamp', [{ Stamp: '?' }], 1],
  ['#', [{ Code: 'A#@' }], 1],
  ['~', [{ Name: '~cafe' }], 2],
] as const) {
  test(`Data API _find: ${operator}`, async () => {
    const res = await fetch(base + '/layouts/Items/_find', {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.messages[0].code, '0');
    assert.equal(body.response.dataInfo.foundCount, count);
  });
}

test('Data API _find: unsuitable fields and unsupported criteria never return HTTP 500, except a plain no-match (401, as FileMaker answers)', async () => {
  for (const [query, code] of [
    [[{ Number: '//' }], '401'], [[{ Number: '?' }], '401'], [[{ Day: '~abc' }], '401'],
    [[{ Name: '~' }], '400'], [[{ Photo: '!' }], '400'],
  ] as const) {
    const res = await fetch(base + '/layouts/Items/_find', {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const body = await res.json();
    if (code !== '401') assert.notEqual(res.status, 500, JSON.stringify(body));
    assert.equal(body.messages[0].code, code);
  }
});

for (const [name, query, count, code] of [
  ['omit only', [{ Name: '!', omit: 'true' }], 1, '0'],
  ['include after omit', [{ Name: '!', omit: 'true' }, { Name: '*' }], 3, '0'],
  ['oversized criterion', [{ Name: '#'.repeat(100000) }], undefined, '400'],
] as const) {
  test(`Data API _find regression: ${name}`, async () => {
    const res = await fetch(base + '/layouts/Items/_find', {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const body = await res.json();
    assert.notEqual(res.status, 500, JSON.stringify(body));
    assert.equal(body.messages[0].code, code);
    if (count !== undefined) assert.equal(body.response.dataInfo.foundCount, count);
  });
}


test('Data API _find: runtime matching budget returns error 400 without HTTP 500', async () => {
  const res = await fetch(base + '/layouts/Limits/_find', {
    method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ query: [{ Text: '@'.repeat(100) }] }),
  });
  const body = await res.json();
  assert.notEqual(res.status, 500, JSON.stringify(body));
  assert.equal(body.messages[0].code, '400');
});

for (const [name, query, code] of [
  ['1000 short requests', Array.from({ length: 1000 }, () => ({ Name: '==x' })), '400'],
  ['malformed numeric range', [{ Number: '1...2...3' }], '508'],
] as const) {
  test(`Data API _find: ${name} returns a controlled FileMaker error`, async () => {
    const res = await fetch(base + '/layouts/Items/_find', {
      method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const body = await res.json();
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(body.messages[0].code, code);
  });
}
