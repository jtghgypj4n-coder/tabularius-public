// File > Export Records in the web client offers FileMaker's other export types: a merge file (field names first,
// always), FileMaker XML (FMPXMLRESULT, dates as ISO text) and an HTML table.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
let token: string;
const ids: number[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-web-export-'));
  createStore(join(dir, 'E' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('E')!;
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Born', type: 'date' }] }] as DesignOp[]);
  ids.push(store.create('People', { Name: 'Ada "A" <L>', Born: '12/10/1815' }).recordId);
  ids.push(store.create('People', { Name: 'Grace' }).recordId);
  store.setPassword('Admin', 'pw', '[Full Access]');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/E/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}' });
  token = (await r.json()).response.token;
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const exported = async (format: string, extra: Record<string, unknown> = {}) => {
  const r = await fetch(`${base}/tabularius/app/v1/databases/E/layouts/People/export`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: ['Name', 'Born'], format, ids, name: 'people', ...extra }),
  });
  assert.equal(r.status, 200);
  return { name: decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? ''), type: r.headers.get('content-type'), text: await r.text() };
};

test('a merge file starts with the field names, whatever the checkbox says', async () => {
  const r = await exported('mer', { fieldNames: false });
  assert.equal(r.name, 'people.mer');
  assert.equal(r.text, '"Name","Born"\r\n"Ada ""A"" <L>","12/10/1815"\r\n"Grace",""\r\n');
});

test('FileMaker XML: FMPXMLRESULT with the field types and dates as ISO text', async () => {
  const r = await exported('xml');
  assert.equal(r.name, 'people.xml');
  assert.match(r.type ?? '', /xml/);
  assert.match(r.text, /<FIELD EMPTYOK="YES" MAXREPEAT="1" NAME="Born" TYPE="DATE"\/>/);
  assert.match(r.text, new RegExp(`<ROW MODID="0" RECORDID="${ids[0]}"><COL><DATA>Ada &quot;A&quot; &lt;L&gt;</DATA></COL><COL><DATA>1815-12-10</DATA></COL></ROW>`));
  assert.match(r.text, /<RESULTSET FOUND="2">/);
});

test('an HTML table with a header row, its text escaped', async () => {
  const r = await exported('html');
  assert.equal(r.name, 'people.html');
  assert.match(r.text, /<tr><th>Name<\/th><th>Born<\/th><\/tr>\n<tr><td>Ada &quot;A&quot; &lt;L&gt;<\/td><td>12\/10\/1815<\/td><\/tr>\n<tr><td>Grace<\/td><td><\/td><\/tr>/);
});
