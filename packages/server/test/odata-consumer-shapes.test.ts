// OData requests that BI and spreadsheet products send (packages/server/test/data/odata-consumer-requests.json), driven
// against a synthetic file: status, headers, JSON shape, paging by @odata.nextLink, and what an account sees.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

interface Case {
  id: string; product: string; source: string; verified: boolean;
  request: { path: string; headers?: Record<string, string> };
  expect: {
    status?: number; statusIn?: number[]; contentType?: string; headers?: Record<string, string>; rows?: number; names?: string[];
    onlyKeys?: string[]; hasKeys?: string[]; odataCount?: number; nextLink?: boolean; text?: string; textMatches?: string;
  };
}
const data = JSON.parse(readFileSync(join(import.meta.dirname, 'data', 'odata-consumer-requests.json'), 'utf8')) as { cases: Case[]; notVerified: string[] };

let dir: string;
let server: Server;
let root: string;
const basic = (account: string) => ({ authorization: 'Basic ' + btoa(`${account}:pw`) });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-consumers-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  root = `${s.url}/fmi/odata/v4`;
  const store = s.host.get('Shop')!;
  store.setAiPolicy(false);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Qty', type: 'number' }, { name: 'Born', type: 'date' }] }] as never);
  for (let i = 1; i <= 25; i++) store.create('Items', { Name: `Item ${String(i).padStart(2, '0')}`, Qty: String(i), Born: `1/${(i % 28) + 1}/2024` });
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  store.savePrivilegeSet({
    name: 'Reports', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: "Qty > 5", edit: false, create: false, delete: false, fields: { Born: 'none' } },
  } as never);
  store.setPassword('Cy', 'pw', 'Reports');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

for (const c of data.cases) {
  test(`${c.product}: ${c.id}`, async () => {
    const r = await fetch(root + c.request.path, { headers: { ...basic('Ann'), ...c.request.headers } });
    const text = await r.text();
    const e = c.expect;
    if (e.status !== undefined) assert.equal(r.status, e.status, text);
    if (e.statusIn) assert.ok(e.statusIn.includes(r.status), `${r.status}: ${text}`);
    assert.ok(r.status < 500, text);
    if (e.contentType) assert.match(r.headers.get('content-type') ?? '', new RegExp(e.contentType));
    for (const [h, re] of Object.entries(e.headers ?? {})) assert.match(r.headers.get(h) ?? '', new RegExp(re), h);
    if (e.text !== undefined) assert.equal(text.trim(), e.text);
    if (e.textMatches) assert.match(text, new RegExp(e.textMatches));
    if (r.status !== 200 || !(r.headers.get('content-type') ?? '').includes('json')) return;
    const body = JSON.parse(text) as { value: Record<string, unknown>[]; '@odata.count'?: number; '@odata.nextLink'?: string };
    if (e.rows !== undefined) assert.equal(body.value.length, e.rows);
    if (e.names) assert.deepEqual(body.value.map((v) => v.Name), e.names);
    if (e.odataCount !== undefined) assert.equal(body['@odata.count'], e.odataCount);
    if (e.nextLink !== undefined) assert.equal(typeof body['@odata.nextLink'] === 'string', e.nextLink);
    for (const row of body.value) {
      if (e.onlyKeys) assert.deepEqual(Object.keys(row).filter((k) => !k.startsWith('@')), e.onlyKeys);
      for (const k of e.hasKeys ?? []) assert.ok(k in row, `${k} is in each row`);
    }
  });
}

test('a client that follows @odata.nextLink reads every record once, in order (Tableau-style extract, Power Query paging)', async () => {
  const names: string[] = [];
  let url: string | undefined = `${root}/Shop/Items?%24orderby=Qty`;
  let pages = 0;
  while (url) {
    const r: Response = await fetch(url, { headers: { ...basic('Ann'), prefer: 'odata.maxpagesize=10' } });
    assert.equal(r.status, 200);
    const body = await r.json() as { value: { Name: string }[]; '@odata.nextLink'?: string };
    names.push(...body.value.map((v) => v.Name));
    url = body['@odata.nextLink'];
    assert.ok(++pages <= 3, 'ten per page ends after three pages');
  }
  assert.equal(pages, 3);
  assert.deepEqual(names, Array.from({ length: 25 }, (_, i) => `Item ${String(i + 1).padStart(2, '0')}`));
});

test('an account sees only its records and fields through every shape, and the count agrees', async () => {
  const cy = basic('Cy');
  const list = await (await fetch(`${root}/Shop/Items?%24count=true&%24orderby=Qty`, { headers: cy })).json() as { value: Record<string, unknown>[]; '@odata.count': number };
  assert.equal(list['@odata.count'], 20, 'the count is of what Cy may view');
  assert.equal(list.value.length, 20);
  assert.equal(list.value[0].Name, 'Item 06');
  for (const row of list.value) assert.ok(!('Born' in row), 'a field Cy may not see is not in the row');
  assert.equal((await (await fetch(`${root}/Shop/Items/$count`, { headers: cy })).text()).trim(), '20');
  const metadata = await (await fetch(`${root}/Shop/$metadata`, { headers: cy })).text();
  assert.doesNotMatch(metadata, /Name="Born"/);
  for (const path of ['/Shop/Items?%24select=Born', '/Shop/Items?%24filter=Born%20eq%202024-01-02', '/Shop/Items?%24orderby=Born']) {
    const r = await fetch(root + path, { headers: cy });
    assert.equal(r.status, 400, path);
    assert.doesNotMatch(await r.text(), /2024/);
  }
  const grouped = await (await fetch(`${root}/Shop/Items?%24apply=${encodeURIComponent('aggregate($count as N)')}`, { headers: cy })).json() as { value: { N: number }[] };
  assert.equal(grouped.value[0].N, 20);
  assert.equal((await fetch(`${root}/Shop/Items`)).status, 401);
  const wrong = await fetch(`${root}/Shop/Items`, { headers: { authorization: 'Basic ' + btoa('Ann:nope') } });
  assert.equal(wrong.status, 401);
  assert.match(wrong.headers.get('www-authenticate') ?? '', /^Basic realm=/);
});

test('every case names its source and the list of what is not verified is kept', () => {
  for (const c of data.cases) assert.ok(c.source && typeof c.verified === 'boolean', c.id);
  assert.ok(data.notVerified.length >= 3);
});
