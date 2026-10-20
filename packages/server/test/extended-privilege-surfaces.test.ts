// The extended-privilege → surface map, in one place: a privilege set is
// refused on a surface whose keyword it lacks. FileMaker's keywords map onto
// our surfaces as:
//     fmrest             → Data API           (dataapi.ts, CLIENT_PRIVILEGES.rest)
//     fmapp/fmwebdirect  → web client         (dataapi.ts, CLIENT_PRIVILEGES.web; see webclient.test.ts)
//     fmodata            → OData              (odata.ts; see odata.test.ts)
//     fmxdbc             → SQL endpoint       (pgwire.ts; see pgwire.test.ts / sql.test.ts)
//     fmmcp              → MCP / AI (our own) (mcp.ts, assistant.ts; see mcp-privileges.test.ts)
// fmxml (FileMaker's Custom Web Publishing) has no corresponding surface in
// Tabularius, so there is nothing to gate on it. This file locks the three JSON
// HTTP surfaces together; the web client and SQL endpoint are covered by the
// suites named above.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-extsurf-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  // One set that can see the data but carries no surface keyword at all.
  store.savePrivilegeSet({
    name: 'NoKeys',
    records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('nokeys', 'pw', 'NoKeys');
  // ...and one that carries only fmodata, to prove the gate opens with the key.
  store.savePrivilegeSet({
    name: 'ODataOnly',
    records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmodata'],
  });
  store.setPassword('odata', 'pw', 'ODataOnly');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const basic = (who: string) => 'Basic ' + btoa(`${who}:pw`);

test('Data API refuses a set without fmrest', { skip }, async () => {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { authorization: basic('nokeys') }, body: '{}',
  });
  assert.equal(r.status, 401);
  assert.match((await r.json()).messages[0].message, /fmrest/);
});

test('OData refuses a set without fmodata, and serves one with it', { skip }, async () => {
  const no = await fetch(`${base}/fmi/odata/v4/Charts`, { headers: { authorization: basic('nokeys') } });
  assert.equal(no.status, 403);
  assert.match((await no.json()).error.message, /fmodata.*tabularius privileges <folder> Charts grant "[^"]+" fmodata/);

  const yes = await fetch(`${base}/fmi/odata/v4/Charts`, { headers: { authorization: basic('odata') } });
  assert.equal(yes.status, 200);
});

test('MCP refuses a set without fmmcp', { skip }, async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18', authorization: basic('nokeys'),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_database', arguments: { database: 'Charts' } } }),
  });
  const text = await res.text();
  assert.match(text, /fmmcp/);
});
