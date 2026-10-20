// The address a link or a passkey is built from: --public-url when given, else the request, with X-Forwarded-Host and
// X-Forwarded-Proto believed only from a proxy on this computer (anyone else can write them).
import { test } from 'node:test';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { requestOrigin, onForwardedWithoutPublicUrl } from '../src/public-origin.ts';
import { webauthnEnv } from '../src/dataapi.ts';
import { serve } from '../src/index.ts';

const req = (remoteAddress: string, headers: Record<string, string | string[]>, encrypted = false) =>
  ({ socket: { remoteAddress, encrypted }, headers }) as unknown as IncomingMessage;
const forged = { host: 'files.example.com', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' };

test('a client on another computer cannot choose the host or scheme links are built from', () => {
  assert.deepEqual(requestOrigin(req('203.0.113.9', forged)), { proto: 'http', host: 'files.example.com' });
  assert.deepEqual(requestOrigin(req('203.0.113.9', forged, true)), { proto: 'https', host: 'files.example.com' });
  assert.deepEqual(webauthnEnv(req('198.51.100.7', forged)), { rpId: 'files.example.com', origin: 'http://files.example.com' });
});

test('a reverse proxy on this computer is believed', () => {
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.deepEqual(requestOrigin(req(peer, forged)), { proto: 'https', host: 'evil.example' }, peer);
  }
  assert.deepEqual(webauthnEnv(req('127.0.0.1', { host: '127.0.0.1:8080', 'x-forwarded-host': 'files.example.com:8443', 'x-forwarded-proto': 'https, http' })), {
    rpId: 'files.example.com', origin: 'https://files.example.com:8443',
  });
  assert.deepEqual(requestOrigin(req('127.0.0.1', { host: 'localhost:8080' })), { proto: 'http', host: 'localhost:8080' });
});

test('--public-url wins over every header, from anyone', () => {
  const url = 'https://files.example.com:8443/';
  for (const peer of ['127.0.0.1', '203.0.113.9']) {
    assert.deepEqual(requestOrigin(req(peer, forged), url), { proto: 'https', host: 'files.example.com:8443' }, peer);
  }
  assert.deepEqual(webauthnEnv(req('203.0.113.9', forged), url), { rpId: 'files.example.com', origin: 'https://files.example.com:8443' });
  // An unusable value must never fall back to request headers.
  assert.throws(() => requestOrigin(req('203.0.113.9', forged), 'not a url'), TypeError);
});

test('forwarded headers believed from this computer with no --public-url are warned about once; nothing else warns', () => {
  const said: string[] = [];
  onForwardedWithoutPublicUrl((m) => said.push(m));
  try {
    requestOrigin(req('203.0.113.9', forged)); // not from this computer: not believed, nothing to say
    requestOrigin(req('127.0.0.1', { host: 'localhost:8080' })); // no forwarded headers
    requestOrigin(req('127.0.0.1', forged), 'https://files.example.com'); // --public-url set
    assert.equal(said.length, 0);
    requestOrigin(req('127.0.0.1', forged));
    requestOrigin(req('127.0.0.1', forged));
    assert.equal(said.length, 1, 'once');
    assert.match(said[0], /--public-url/);
  } finally {
    onForwardedWithoutPublicUrl(undefined);
  }
});

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('OData links use the public URL even when a local proxy sends other headers', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-public-origin-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, publicUrl: 'https://data.example.com' });
  try {
    const store = s.host.get('Charts')!;
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
    store.setPassword('Ann', 'pw', full.name);
    const res = await fetch(`${s.url}/fmi/odata/v4/Charts`, { headers: { authorization: 'Basic ' + btoa('Ann:pw'), 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body['@odata.context'], /^https:\/\/data\.example\.com\//);
    assert.doesNotMatch(JSON.stringify(body), /evil\.example/);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('a cluster worker given only its own listen address still builds links from the request', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-public-origin-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  // What a cluster's front process hands each worker when no --public-url was given.
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, publicUrl: 'http://127.0.0.1:1', publicUrlIsDefault: true });
  try {
    const store = s.host.get('Charts')!;
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
    store.setPassword('Ann', 'pw', full.name);
    const res = await fetch(`${s.url}/fmi/odata/v4/Charts`, { headers: { authorization: 'Basic ' + btoa('Ann:pw'), 'x-forwarded-host': 'db.example.com', 'x-forwarded-proto': 'https' } });
    assert.match((await res.json())['@odata.context'], /^https:\/\/db\.example\.com\//);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
