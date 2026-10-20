import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { totpCode } from '../../store/src/index.ts';

// Reports and BI tools reading a hosted file with SQL, as over ODBC/JDBC.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const sets = store.privilegeSets();
  const full = sets.find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc', 'fmrest'] });
  store.setPassword('Ann', 'pw', full.name);
  // Can use SQL, but can't see one field: SQL would reveal it, so it's refused.
  store.savePrivilegeSet({
    name: 'Reports', records: { view: true, edit: false, create: false, delete: false, fields: { [store.schema.tables[0].fields[0].name]: 'none' } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'],
  });
  store.setPassword('Rae', 'pw', 'Reports');
  // Full view, but no fmxdbc.
  store.savePrivilegeSet({ name: 'Viewers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('Val', 'pw', 'Viewers');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const basic = (account: string) => ({ authorization: 'Basic ' + btoa(`${account}:pw`) });
const sqlUrl = () => `${base}/tabularius/sql/v1/databases/Charts`;
const post = (headers: Record<string, string>, body: unknown) =>
  fetch(sqlUrl(), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('tables lists occurrences with their stored columns', { skip }, async () => {
  const r = await fetch(`${sqlUrl()}/tables`, { headers: basic('Ann') });
  assert.equal(r.status, 200);
  const { tables } = await r.json();
  const congress = tables.find((t: { name: string }) => t.name === 'Congress');
  assert.ok(congress, JSON.stringify(tables.map((t: { name: string }) => t.name)));
  assert.ok(congress.columns.length > 0);
});

test('FileMaker SQL over table occurrences, as JSON and CSV', { skip }, async () => {
  const total = host.get('Charts')!.find('Congress', { limit: 0 }).totalCount;
  const r = await post(basic('Ann'), { sql: 'SELECT COUNT(*) AS n FROM Congress' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.columns.map((c: { name: string }) => c.name), ['n']);
  assert.deepEqual(j.rows, [[total]]);

  // Parameters, FETCH FIRST, a limit that truncates.
  const p = await (await post(basic('Ann'), { sql: 'SELECT * FROM Congress WHERE ROWID > ? FETCH FIRST 5 ROWS ONLY', params: [0], limit: 3 })).json();
  assert.equal(p.rowCount, 3);
  assert.equal(p.truncated, true);

  const csv = await fetch(`${sqlUrl()}?format=csv&q=${encodeURIComponent('SELECT 1 AS a, \'x,"y"\' AS b')}`, { headers: basic('Ann') });
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(await csv.text(), 'a,b\r\n1,"x,""y"""\r\n');

  // A Data API session works too.
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: basic('Ann') });
  const token = (await login.json()).response.token;
  assert.equal((await post({ authorization: `Bearer ${token}` }, { sql: 'SELECT 1' })).status, 200);
});

test('only reads: no writes, ATTACH or VACUUM INTO', { skip }, async () => {
  for (const sql of ['DELETE FROM Congress', `ATTACH '${join(dir, 'x.db')}' AS x`, `VACUUM INTO '${join(dir, 'copy.db')}'`, '/* hi */ PRAGMA writable_schema = 1', 'WITH a AS (SELECT 1) DELETE FROM Congress']) {
    const r = await post(basic('Ann'), { sql });
    assert.equal(r.status, 400, sql);
  }
  assert.ok(!existsSync(join(dir, 'copy.db')));
  assert.ok(host.get('Charts')!.find('Congress', { limit: 0 }).totalCount > 0);
});

test('needs fmxdbc and access to every field; wrong passwords are refused', { skip }, async () => {
  const rae = await post(basic('Rae'), { sql: 'SELECT 1' });
  assert.equal(rae.status, 401);
  assert.match((await rae.json()).error.message, /can't view every record and field/);
  const val = await post(basic('Val'), { sql: 'SELECT 1' });
  assert.equal(val.status, 403);
  assert.match((await val.json()).error.message, /fmxdbc.*grant "[^"]+" fmxdbc/);
  const bad = await post({ authorization: 'Basic ' + btoa('Ann:nope') }, { sql: 'SELECT 1' });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('www-authenticate'), 'Basic realm="tabularius SQL", charset="UTF-8"');
  assert.equal((await post({}, { sql: 'SELECT 1' })).status, 401);
});

test('replies carry nosniff, and a fault before sign-in says nothing of its cause', { skip }, async () => {
  const bad = await fetch(`${base}/tabularius/sql/v1/databases/%E0%A4%A`, { headers: basic('Ann') });
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(await bad.text(), /URI malformed/);
  const ok = await post(basic('Ann'), { sql: 'SELECT 1' });
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
});

test('HTTP Basic enforces TOTP and owed password changes; accounts without TOTP still work', { skip }, async () => {
  const store = host.get('Charts')!;
  store.setPassword('TwoFactorSQL', 'pw', '[Full Access]');
  const { secret } = store.enrollTotp('TwoFactorSQL');
  store.confirmTotp('TwoFactorSQL', totpCode(secret));
  const query = { sql: 'SELECT 1 AS ok' };
  const denied = await post(basic('TwoFactorSQL'), query);
  assert.equal(denied.status, 401);
  assert.match((await denied.json()).error.message, /one-time code/i);
  const accepted = await post({ ...basic('TwoFactorSQL'), 'x-tabularius-otp': totpCode(secret) }, query);
  assert.equal(accepted.status, 200);
  // A code works once and is checked on every request: a replayed code is refused, with the way forward in the message.
  const replay = await post({ ...basic('TwoFactorSQL'), 'x-tabularius-otp': totpCode(secret) }, query);
  assert.equal(replay.status, 401);
  assert.match((await replay.json()).error.message, /Bearer token/);
  // The password alone never rides on an earlier code's check.
  assert.equal((await post(basic('TwoFactorSQL'), query)).status, 401);
  assert.equal((await post(basic('Ann'), query)).status, 200);
  store.setMustChangePassword('Ann', true);
  const forced = await post(basic('Ann'), query);
  assert.equal(forced.status, 403);
  assert.match((await forced.json()).error.message, /must change.*password/i);
});
