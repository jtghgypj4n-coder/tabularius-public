// With the file lists off (the default), asking about a file that isn't hosted gets the same answer as asking about one
// that is, for the same kind of credential: a guessed file name is not confirmed by the status or the message.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir = '';
let s: Awaited<ReturnType<typeof serve>>;
let open: Awaited<ReturnType<typeof serve>>;
let dir2 = '';

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-oracle-'));
  dir2 = mkdtempSync(join(tmpdir(), 'tabularius-oracle-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir2, 'Charts.fmp12'));
  s = await serve({ dir, port: 0, watch: false, log: () => {} });
  open = await serve({ dir: dir2, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
});
after(async () => {
  for (const x of [s, open]) await new Promise<void>((r) => (x ? x.server.close(() => r()) : r()));
  for (const d of [dir, dir2]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

const basic = (pw: string) => ({ authorization: 'Basic ' + btoa('Nobody:' + pw) });
const json = { 'content-type': 'application/json' };

/** Status and body of a call, with the file's name written out so the two answers can be compared. */
async function ask(base: string, db: string, how: { path: (db: string) => string; method?: string; headers?: Record<string, string>; body?: unknown }) {
  const r = await fetch(base + how.path(db), { method: how.method ?? 'GET', headers: how.headers, body: how.body === undefined ? undefined : JSON.stringify(how.body) });
  return { status: r.status, body: (await r.text()).split(db).join('<file>').replace(/"challenge":"[^"]*"/, '"challenge":"<c>"')
    // Each file makes up its own credential ids, so only the length of an id can match.
    .replace(/"allowCredentials":\[([^\]]*)\]/, (_, ids: string) => `"allowCredentials":${ids.split(",")[0].length}`) };
}

const calls: Record<string, Parameters<typeof ask>[2]> = {
  'sessions, no credentials': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions`, method: 'POST', headers: json, body: {} },
  'sessions, wrong password': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions`, method: 'POST', headers: { ...json, ...basic('x') }, body: {} },
  'data call, API token': { path: (db) => `/fmi/data/vLatest/databases/${db}/layouts`, headers: { authorization: 'Bearer ohbt_nope' } },
  'passkey start': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions/passkey`, method: 'POST', headers: json, body: {} },
  'passkey start, named account': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions/passkey`, method: 'POST', headers: json, body: { account: 'Nobody' } },
  'passkey assertion': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions/passkey`, method: 'POST', headers: json,
    body: { response: { credentialId: 'a', clientDataJSON: 'a', authenticatorData: 'a', signature: 'a', challenge: 'a' } } },
  'recovery code': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions/recovery`, method: 'POST', headers: json, body: { account: 'Nobody', code: 'abcd-efgh' } },
  'passkey as second factor': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions/passkey-2fa`, method: 'POST', headers: { ...json, ...basic('x') }, body: {} },
  'passkey assertion, malformed': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions/passkey`, method: 'POST', headers: json, body: { response: {} } },
  'sessions, no account named': { path: (db) => `/fmi/data/vLatest/databases/${db}/sessions`, method: 'POST', headers: { ...json, authorization: 'Basic ' + btoa(':x') }, body: {} },
  'account import, no token': { path: (db) => `/tabularius/security/v1/databases/${db}/accounts/import/preview`, method: 'POST', headers: json, body: {} },
  'account import, API token': { path: (db) => `/tabularius/security/v1/databases/${db}/accounts/import/preview`, method: 'POST', headers: { ...json, authorization: 'Bearer ohbt_x' }, body: {} },
  'OData, no credentials': { path: (db) => `/fmi/odata/v4/${db}` },
  'OData, wrong password': { path: (db) => `/fmi/odata/v4/${db}`, headers: basic('x') },
  'SQL, wrong password': { path: (db) => `/tabularius/sql/v1/databases/${db}`, method: 'POST', headers: { ...json, ...basic('x') }, body: { sql: 'SELECT 1' } },
};

for (const [name, how] of Object.entries(calls)) {
  test(`a file that isn't hosted answers like one that is: ${name}`, { skip }, async () => {
    const hosted = await ask(s.url, 'Charts', how);
    const missing = await ask(s.url, 'Nope', how);
    assert.deepEqual(missing, hosted);
  });
}

test('the OIDC sign-in start does not say whether the file is hosted', { skip }, async () => {
  const a = await fetch(`${s.url}/fmi/data/vLatest/databases/Nope/sessions/oidc`, { redirect: 'manual' });
  const b = await fetch(`${s.url}/fmi/data/vLatest/databases/Charts/sessions/oidc`, { redirect: 'manual' });
  assert.equal(a.status, b.status);
});

test('with --list-files-publicly a missing file is still said to be missing', { skip }, async () => {
  const r = await fetch(`${open.url}/fmi/data/vLatest/databases/Nope/sessions`, { method: 'POST', headers: { ...json, ...basic('x') }, body: '{}' });
  assert.equal(r.status, 404);
});
