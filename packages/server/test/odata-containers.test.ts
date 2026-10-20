// OData container writes: a file PATCHed to a container field (the body, with its
// Content-Type), base64 in a record's JSON with ContentType and Filename
// annotations, and DELETE (or null) to empty it, following field access.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { inlineSafe } from '../src/containers.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
let host: Host;
let doc: number;
const auth = (who: string) => ({ authorization: 'Basic ' + btoa(`${who}:pw`) });
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-containers-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4/Charts`;
  host = s.host;
  const store = host.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Name', type: 'text' }, { name: 'File', type: 'container' }] }] as never);
  doc = store.create('Docs', { Name: 'First' }).recordId;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  // Edits records, but may only look at the files.
  store.savePrivilegeSet({
    name: 'Files view only', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: true, create: true, delete: false }, tables: { Docs: { view: true, edit: true, create: true, delete: false, fields: { File: 'viewOnly' } } },
  } as never);
  store.setPassword('Cy', 'pw', 'Files view only');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const file = async (id: number, who = 'Ann') => {
  const res = await fetch(`${root}/Docs(${id})/File/$value`, { headers: auth(who) });
  return { status: res.status, type: res.headers.get('content-type'), data: Buffer.from(await res.arrayBuffer()) };
};

test('a file PATCHed to a container field is stored with its type and name, and DELETE empties it', { skip }, async () => {
  const put = await fetch(`${root}/Docs(${doc})/File`, {
    method: 'PATCH', headers: { ...auth('Ann'), 'content-type': 'image/png', 'content-disposition': 'attachment; filename="../logo.png"' }, body: png,
  });
  assert.equal(put.status, 204, await put.text());
  assert.equal(put.headers.get('etag'), 'W/"1"');
  const got = await file(doc);
  assert.equal(got.status, 200);
  assert.equal(got.type, 'image/png');
  assert.deepEqual(got.data, png);
  const store = host.get('Charts')!;
  assert.equal(store.container(store.containerId('Docs', doc, 'File')!)!.filename, 'logo.png');

  // A stale ETag changes nothing; $value names the same field.
  const stale = await fetch(`${root}/Docs(${doc})/File/$value`, { method: 'PUT', headers: { ...auth('Ann'), 'content-type': 'text/plain', 'if-match': 'W/"0"' }, body: 'x' });
  assert.equal(stale.status, 412);
  assert.equal((await fetch(`${root}/Docs(${doc})/File`, { method: 'DELETE', headers: auth('Ann') })).status, 204);
  assert.equal((await file(doc)).status, 204);
});

test('base64 in a record\'s JSON fills a container field, with ContentType and Filename annotations; null empties it', { skip }, async () => {
  const json = { ...auth('Ann'), 'content-type': 'application/json' };
  const made = await fetch(`${root}/Docs`, {
    method: 'POST', headers: json,
    body: JSON.stringify({ Name: 'With file', File: png.toString('base64'), 'File@com.filemaker.odata.ContentType': 'image/png', 'File@com.filemaker.odata.Filename': 'logo.png' }),
  });
  assert.equal(made.status, 201, await made.clone().text());
  const id = (await made.json() as { ROWID: number }).ROWID;
  assert.deepEqual((await file(id)).data, png);
  assert.equal((await file(id)).type, 'image/png');

  const cleared = await fetch(`${root}/Docs(${id})`, { method: 'PATCH', headers: json, body: JSON.stringify({ Name: 'No file', File: null }) });
  assert.equal(cleared.status, 204);
  assert.equal((await file(id)).status, 204);

  // A content type is stored as type/subtype only: a list or header text can't make it served as something else.
  for (const type of ['text/plain;,text/html', 'image/png\r\nx-evil: 1', 'text/html, text/plain']) {
    const sneaky = await fetch(`${root}/Docs(${id})`, { method: 'PATCH', headers: json, body: JSON.stringify({ File: Buffer.from('<script>1</script>').toString('base64'), 'File@com.filemaker.odata.ContentType': type }) });
    assert.equal(sneaky.status, 204);
    const served = await file(id);
    assert.equal(served.status, 200);
    assert.notEqual(served.type, 'text/html');
    assert.doesNotMatch(served.type ?? '', /html|,/);
  }

  // Not base64: refused before anything is written.
  const bad = await fetch(`${root}/Docs(${id})`, { method: 'PATCH', headers: json, body: JSON.stringify({ Name: 'Changed', File: 'not base64!' }) });
  assert.equal(bad.status, 400);
  const row = await (await fetch(`${root}/Docs(${id})`, { headers: auth('Ann') })).json() as { Name: string };
  assert.equal(row.Name, 'No file');
});

test('container writes follow field access and the token\'s rights', { skip }, async () => {
  const cy = await fetch(`${root}/Docs(${doc})/File`, { method: 'PATCH', headers: { ...auth('Cy'), 'content-type': 'image/png' }, body: png });
  assert.equal(cy.status, 405);
  assert.match(await cy.text(), /cannot be modified/);
  const inJson = await fetch(`${root}/Docs(${doc})`, { method: 'PATCH', headers: { ...auth('Cy'), 'content-type': 'application/json' }, body: JSON.stringify({ File: png.toString('base64') }) });
  assert.equal(inJson.status, 400);
  const token = host.get('Charts')!.createApiToken('Ann', { readOnly: true });
  assert.equal((await fetch(`${root}/Docs(${doc})/File`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: png })).status, 403);
  // Only container fields take a body at the property's address.
  assert.equal((await fetch(`${root}/Docs(${doc})/Name`, { method: 'PATCH', headers: { ...auth('Ann'), 'content-type': 'text/plain' }, body: 'x' })).status, 405);
  assert.equal((await fetch(`${root}/Docs(${doc})/File`, { method: 'PATCH', headers: { ...auth('Ann'), 'content-type': 'image/png' } })).status, 400);
});

test('a change set that creates a record with a file and then fails keeps neither', { skip }, async () => {
  const before = host.get('Charts')!.findIds('Docs').length;
  const res = await fetch(`${root}/$batch`, {
    method: 'POST', headers: { ...auth('Ann'), 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [
      { id: '1', method: 'POST', url: 'Docs', atomicityGroup: 'g', body: { Name: 'Batch file', File: png.toString('base64') } },
      { id: '2', method: 'PATCH', url: '$1', atomicityGroup: 'g', body: { Nope: 1 } },
    ] }),
  });
  const body = await res.json() as { responses: { status: number }[] };
  assert.deepEqual(body.responses.map((r) => r.status), [424, 400]);
  assert.equal(host.get('Charts')!.findIds('Docs').length, before);
});

test('a stored type that lists several, or holds control characters, is never shown inline', () => {
  assert.equal(inlineSafe('text/plain'), true);
  assert.equal(inlineSafe('text/plain;,text/html'), false);
  assert.equal(inlineSafe('image/png\r\nx: y'), false);
});
