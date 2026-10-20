// A fault inside the OData service tells the client only "Unknown error" (the cause goes to the log): SQLite and
// file-system messages name tables, columns and paths. A malformed %-escape in the address is the client's, a 400.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-leaks-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  base = `${s.url}/fmi/odata/v4`;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

test('an unexpected fault gives a plain 500 without its cause', { skip }, async () => {
  const names = host.names;
  const logged: unknown[] = [];
  const error = console.error;
  host.names = () => {
    if (!new Error().stack!.includes('odata.ts')) return names.call(host); // only the OData service's call fails
    throw new Error('SQLITE_CANTOPEN: unable to open /var/lib/secret/Charts.fmp12: no such table: T123');
  };
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const r = await fetch(base);
    const text = await r.text();
    assert.equal(r.status, 500);
    assert.doesNotMatch(text, /SQLITE|secret|T123/);
    assert.equal(JSON.parse(text).error.message, 'Unknown error');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(String(logged[0]), /secret/); // the log keeps the cause
  } finally {
    host.names = names;
    console.error = error;
  }
});

test('a malformed %-escape is a 400, not a fault', { skip }, async () => {
  const r = await fetch(`${base}/Charts/%E0%A4%A`);
  assert.equal(r.status, 400);
  assert.doesNotMatch(await r.text(), /URI malformed/);
});

test('a malformed address inside a $batch is that request\'s 400, and replies carry nosniff', { skip }, async () => {
  const r = await fetch(`${base}/Charts/$batch`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa('Ann:pw'), 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [{ id: '1', method: 'GET', url: 'http://[' }] }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const { responses } = (await r.json()) as { responses: { status: number; body: { error: { message: string } } }[] };
  assert.equal(responses[0].status, 400);
  assert.doesNotMatch(responses[0].body.error.message, /Invalid URL/);
  const meta = await fetch(`${base}/Charts/$metadata`, { headers: { authorization: 'Basic ' + btoa('Ann:pw') } });
  assert.equal(meta.status, 200);
  assert.equal(meta.headers.get('x-content-type-options'), 'nosniff');
});
