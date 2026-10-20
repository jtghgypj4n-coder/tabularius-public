// OData: HEAD answers what GET would (status and headers, no body) on every read address, a method an address
// doesn't take is 405 with Allow, and the `return` preference (OData 4.0 section 8.2.8.7) shapes POST and PATCH.
// The Claris OData guide lists return=representation and return=minimal as supported Prefer values but says
// neither what they do nor anything about HEAD, so the standard decides.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
const ann = { authorization: 'Basic ' + btoa('Ann:pw') };
const json = { ...ann, 'content-type': 'application/json' };

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-head-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  root = `${s.url}/fmi/odata/v4`;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('HEAD answers like GET without the body, on the root, $metadata, an entity set, $count, an entity and a field', { skip }, async () => {
  for (const path of ['', '/Charts', '/Charts/$metadata', '/Charts/Congress?$top=2', '/Charts/Congress/$count', '/Charts/Congress(1)', '/Charts/Congress(1)/Name', '/Charts/Congress(1)/Name/$value']) {
    const get = await fetch(root + path, { headers: ann });
    const body = await get.text();
    const head = await fetch(root + path, { method: 'HEAD', headers: ann });
    assert.equal(head.status, get.status, `HEAD ${path}`);
    assert.equal(get.status, 200, `GET ${path}`);
    assert.equal((await head.text()), '', `HEAD ${path} has no body`);
    assert.equal(head.headers.get('content-type'), get.headers.get('content-type'), `HEAD ${path}`);
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(body)), `HEAD ${path}`);
    assert.equal(head.headers.get('odata-version'), get.headers.get('odata-version'), `HEAD ${path}`);
  }
  const entity = await fetch(`${root}/Charts/Congress(1)`, { method: 'HEAD', headers: ann });
  assert.match(entity.headers.get('etag') ?? '', /^W\/"\d+"$/);
  const missing = await fetch(`${root}/Charts/Congress(999999)`, { method: 'HEAD', headers: ann });
  assert.equal(missing.status, 404);
  assert.equal((await fetch(`${root}/Charts/Congress`, { method: 'HEAD' })).status, 401);
});

test('a method an address does not take is 405 with Allow', { skip }, async () => {
  const cases: Array<[string, string, string]> = [
    ['DELETE', '', 'GET, HEAD'],
    ['POST', '/Charts', 'GET, HEAD'],
    ['PUT', '/Charts/$metadata', 'GET, HEAD'],
    ['DELETE', '/Charts/Congress', 'GET, HEAD, POST'],
    ['POST', '/Charts/Congress/$count', 'GET, HEAD'],
    ['POST', '/Charts/Congress(1)', 'GET, HEAD, PATCH, PUT, DELETE'],
    ['GET', '/Charts/Script.Echo', 'POST'],
    ['GET', '/Charts/$batch', 'POST'],
  ];
  for (const [method, path, allow] of cases) {
    const r = await fetch(root + path, { method, headers: json, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    assert.equal(r.status, 405, `${method} ${path}`);
    assert.equal(r.headers.get('allow'), allow, `${method} ${path}`);
    await r.arrayBuffer();
  }
});

test('Prefer return=minimal on POST answers 204 with OData-EntityId; return=representation echoes the record on PATCH', { skip }, async () => {
  const made = (prefer?: string) => fetch(`${root}/Charts/Congress`, { method: 'POST', headers: { ...json, ...(prefer ? { prefer } : {}) }, body: JSON.stringify({ Name: 'Prefer Person' }) });

  const plain = await made();
  assert.equal(plain.status, 201);
  assert.equal(plain.headers.get('preference-applied'), null);
  await plain.arrayBuffer();

  const rep = await made('return=representation');
  assert.equal(rep.status, 201);
  assert.equal(rep.headers.get('preference-applied'), 'return=representation');
  assert.equal((await rep.json() as { Name: string }).Name, 'Prefer Person');

  const min = await made('odata.maxpagesize=5, return=minimal');
  assert.equal(min.status, 204);
  assert.equal(await min.text(), '');
  assert.equal(min.headers.get('preference-applied'), 'return=minimal');
  const where = min.headers.get('odata-entityid')!;
  assert.match(where, /\/Congress\(\d+\)$/);
  assert.equal(min.headers.get('location'), where);
  assert.ok(min.headers.get('etag'));
  const read = await fetch(where, { headers: ann });
  assert.equal(read.status, 200);
  assert.equal((await read.json() as { Name: string }).Name, 'Prefer Person');

  const patch = (prefer?: string) => fetch(where, { method: 'PATCH', headers: { ...json, ...(prefer ? { prefer } : {}) }, body: JSON.stringify({ State: 'Nowhere' }) });
  const quiet = await patch();
  assert.equal(quiet.status, 204);
  assert.equal(quiet.headers.get('preference-applied'), null);
  const minimal = await patch('return=minimal');
  assert.equal(minimal.status, 204);
  assert.equal(minimal.headers.get('preference-applied'), 'return=minimal');
  const echoed = await patch('return=representation');
  assert.equal(echoed.status, 200);
  assert.equal(echoed.headers.get('preference-applied'), 'return=representation');
  assert.equal((await echoed.json() as { State: string }).State, 'Nowhere');
});

test('a HEAD in a $batch answers with GET\'s headers and no body', { skip }, async () => {
  const res = await fetch(`${root}/Charts/$batch`, {
    method: 'POST', headers: json,
    body: JSON.stringify({ requests: [{ id: '1', method: 'HEAD', url: 'Congress(1)' }, { id: '2', method: 'GET', url: 'Congress(1)' }] }),
  });
  assert.equal(res.status, 200);
  const { responses } = await res.json() as { responses: Array<{ id: string; status: number; headers: Record<string, string>; body?: unknown }> };
  assert.equal(responses[0].status, 200);
  assert.ok(responses[0].body === undefined || responses[0].body === null || responses[0].body === '');
  assert.equal(responses[1].status, 200);
  assert.ok(Number(responses[1].headers['content-length']) > 0);
  assert.equal(responses[0].headers['content-length'], responses[1].headers['content-length']);
});
