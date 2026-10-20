// Scoped API tokens: a revocable bearer credential for an integration, bound
// to an account, usable on the Data API and SQL without a password login.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-tokens-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest', 'fmxdbc', 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const layouts = (token: string, db = 'Charts') =>
  fetch(`${base}/fmi/data/vLatest/databases/${db}/layouts`, { headers: { authorization: `Bearer ${token}` } });
const patch = (token: string, id: number, fieldData: Record<string, string>) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/${id}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData }),
  });
const listedToken = (store: NonNullable<ReturnType<Host['get']>>, token: string) =>
  store.apiTokens().find((entry) => token.startsWith(`ohbt_${entry.id}.`))!;

for (const route of ['security', 'admin'] as const) {
  test(`${route}: an API token issued after a one-hour rollback lasts its real lifetime`, { skip }, async (t) => {
    const store = host.get('Charts')!;
    const admin = store.createApiToken('Admin');
    t.after(() => { for (const token of store.apiTokens()) store.revokeApiToken(token.id); });
    let wall = Date.now(), mono = performance.now();
    t.mock.method(Date, 'now', () => wall);
    t.mock.method(performance, 'now', () => mono);
    const clock = new ExpiryClock();
    t.mock.method(expiryClock, 'now', () => clock.now());
    // The console takes whole days (1 to 3650); the security API takes fractions of a day.
    const lifetime = route === 'security' ? 30 * 60_000 : 24 * 3600_000;
    wall -= 3600_000;
    const path = route === 'security' ? '/tabularius/security/v1/databases/Charts/tokens' : '/tabularius/admin/v1/mcp/tokens';
    const response = await fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(route === 'security' ? { authorization: `Bearer ${admin}` } : { 'x-tabularius-admin': '1' }) },
      body: JSON.stringify({ account: 'Ann', database: 'Charts', ...(route === 'security' ? { expiresDays: 1 / 48 } : { days: 1 }) }),
    });
    assert.equal(response.status, route === 'security' ? 200 : 201, await response.clone().text());
    const body = await response.json();
    const token = body.token;
    assert.ok(store.apiToken(token), 'a newly issued token must work immediately');
    wall += lifetime - 1; mono += lifetime - 1;
    assert.ok(store.apiToken(token), 'still valid just before its lifetime has elapsed');
    wall++; mono++;
    assert.equal(store.apiToken(token), undefined, 'expired when its lifetime has elapsed');
  });
}

test('a token works as a bearer credential, carries its account and can be revoked', { skip }, async () => {
  const store = host.get('Charts')!;
  const token = store.createApiToken('Ann', { label: 'reporting' });
  assert.match(token, /^ohbt_[0-9a-f]+\.[A-Za-z0-9_-]+$/);

  const r = await layouts(token);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).messages[0].code, '0');

  // Listed without the secret; the secret appears nowhere.
  const listed = store.apiTokens();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].account, 'Ann');
  assert.equal(listed[0].readOnly, false);
  assert.ok(listed[0].lastUsed, 'records last use');
  assert.ok(!JSON.stringify(listed).includes(token.split(".")[1]));

  // A write works for a full-access token.
  assert.equal((await patch(token, 1, { Name: 'via token' })).status, 200);

  // Revoked: no longer accepted.
  assert.equal(store.revokeApiToken(listed[0].id), true);
  assert.equal((await layouts(token)).status, 401);
  assert.equal(store.revokeApiToken(listed[0].id), false);
});

test('a read-only token reads but cannot write or run scripts', { skip }, async () => {
  const store = host.get('Charts')!;
  const token = store.createApiToken('Ann', { readOnly: true });
  try {
    // Reading is fine.
    assert.equal((await layouts(token)).status, 200);
    const find = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records?_limit=1`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(find.status, 200);

    // Writing is refused with FileMaker's privilege error.
    const w = await patch(token, 1, { Name: 'nope' });
    assert.equal(w.status, 403);
    assert.equal((await w.json()).messages[0].code, '9');

    const create = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Name: 'x' } }),
    });
    assert.equal(create.status, 403);

    // A script, even on a read request, is refused.
    const script = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records?_limit=1&script=Anything`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(script.status, 403);
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

test('an expired or forged token is rejected', { skip }, async () => {
  const store = host.get('Charts')!;
  const expired = store.createApiToken('Ann', { expires: new Date(Date.now() - 1000) });
  assert.equal((await layouts(expired)).status, 401);

  // A made-up token with a real-looking shape doesn't validate.
  assert.equal(store.apiToken('ohbt_deadbeef.notarealsecretvalue'), undefined);
  assert.equal((await layouts('ohbt_deadbeef.notarealsecretvalue')).status, 401);

  // A token is bound to its file: it doesn't open another database.
  assert.equal((await layouts(store.createApiToken("Ann"), "Nope")).status, 401);
  for (const t of store.apiTokens()) store.revokeApiToken(t.id);
});

test('SQL endpoint accepts an API token', { skip }, async () => {
  const store = host.get('Charts')!;
  const token = store.createApiToken('Ann', { readOnly: true });
  try {
    const r = await fetch(`${base}/tabularius/sql/v1/databases/Charts?q=${encodeURIComponent('SELECT 1 AS n')}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).rows[0][0], 1);
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

const sql = (token: string) =>
  fetch(`${base}/tabularius/sql/v1/databases/Charts?q=${encodeURIComponent('SELECT 1 AS n')}`, { headers: { authorization: `Bearer ${token}` } });
const odata = (token: string) =>
  fetch(`${base}/fmi/odata/v4/Charts`, { headers: { authorization: `Bearer ${token}` } });

test('a token scoped to one surface is refused on the others', { skip }, async () => {
  const store = host.get('Charts')!;
  const token = store.createApiToken('Ann', { surfaces: ['fmrest'] });
  try {
    assert.deepEqual(listedToken(store, token).surfaces, ['fmrest'], 'the scope is recorded');

    // The surface it was scoped to works.
    assert.equal((await layouts(token)).status, 200);

    // The others refuse it with FileMaker's privilege error, before any account check.
    const s = await sql(token);
    assert.equal(s.status, 403, 'SQL refuses an fmrest-only token');
    const o = await odata(token);
    assert.equal(o.status, 403, 'OData refuses an fmrest-only token');
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

test('an unscoped token still reaches every surface the account allows', { skip }, async () => {
  const store = host.get('Charts')!;
  const token = store.createApiToken('Ann');
  try {
    assert.equal(listedToken(store, token).surfaces, undefined, 'no scope is unrestricted');
    assert.equal((await layouts(token)).status, 200);
    assert.equal((await sql(token)).status, 200);
    assert.equal((await odata(token)).status, 200);
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

test('read-only and surface scope compose; an unknown surface is rejected at creation', { skip }, async () => {
  const store = host.get('Charts')!;
  // An unknown surface is refused when the token is minted.
  assert.throws(() => store.createApiToken('Ann', { surfaces: ['fmrest', 'nonsense'] }), /not a surface/);

  const token = store.createApiToken('Ann', { readOnly: true, surfaces: ['fmrest'] });
  try {
    // Reads on its surface work; a write on its surface is still refused (read-only).
    assert.equal((await layouts(token)).status, 200);
    assert.equal((await patch(token, 1, { Name: 'nope' })).status, 403);
    // A different surface refuses it outright (scope), even for a read.
    assert.equal((await sql(token)).status, 403);
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

const records = (token: string, layout: string) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/${encodeURIComponent(layout)}/records?_limit=1`, { headers: { authorization: `Bearer ${token}` } });
const meta = (token: string, layout: string) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/${encodeURIComponent(layout)}`, { headers: { authorization: `Bearer ${token}` } });

test('a layout-scoped token reaches only its layouts on the Data API', { skip }, async () => {
  const store = host.get('Charts')!;
  const token = store.createApiToken('Ann', { layouts: ['NW Customers'] });
  try {
    assert.deepEqual(listedToken(store, token).layouts, ['NW Customers'], 'the scope is recorded');

    // The scoped layout reads, and its metadata is reachable.
    assert.equal((await records(token, 'NW Customers')).status, 200);
    assert.equal((await meta(token, 'NW Customers')).status, 200);

    // A layout outside the scope is "missing" (FileMaker's 105, HTTP 500 — the
    // same as a genuinely absent layout), for both records and metadata, so the
    // token can't be used to browse the rest of the file.
    const outside = await records(token, 'Congress');
    assert.equal(outside.status, 500);
    assert.equal((await outside.json()).messages[0].code, '105');
    assert.equal((await meta(token, 'Congress')).status, 500);

    // The layout listing shows only the scoped layouts.
    const body = await (await layouts(token)).text();
    assert.ok(body.includes('NW Customers'), 'the scoped layout is listed');
    assert.ok(!body.includes('Congress'), 'a layout outside the scope is not listed');
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

test('a layout-scoped token is refused on OData and SQL', { skip }, async () => {
  const store = host.get('Charts')!;
  const token = store.createApiToken('Ann', { layouts: ['NW Customers'] });
  try {
    // The table-oriented surfaces go through no layout, so the scope can't be
    // honoured there and the token is refused rather than silently widened.
    const s = await sql(token);
    assert.equal(s.status, 403, 'SQL refuses a layout-scoped token');
    assert.equal((await s.json()).error.code, 9);
    const o = await odata(token);
    assert.equal(o.status, 403, 'OData refuses a layout-scoped token');
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

test('a layout scope is validated and canonicalised at creation', { skip }, () => {
  const store = host.get('Charts')!;
  // An unknown layout is refused when the token is minted.
  assert.throws(() => store.createApiToken('Ann', { layouts: ['No Such Layout'] }), /No layout/);
  // A layout scope needs the Data API surface if surfaces are also given.
  assert.throws(() => store.createApiToken('Ann', { surfaces: ['fmxdbc'], layouts: ['NW Customers'] }), /must allow the Data API/);

  // Names are canonicalised to the schema's casing and deduped.
  const token = store.createApiToken('Ann', { layouts: ['nw customers', 'NW Customers', 'NW Line Items'] });
  try {
    assert.deepEqual(listedToken(store, token).layouts, ['NW Customers', 'NW Line Items']);
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

test('a read-only or layout-limited token gets no formulas from Explain This Value', { skip }, async () => {
  const store = host.get('Charts')!;
  const id = store.findIds('Congress')[0];
  const explain = (token: string) => fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress/explain`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ recordId: String(id), field: 'State' }),
  });
  const meta = (token: string) => fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  try {
    const full = store.createApiToken('Ann', {});
    assert.equal((await explain(full)).status, 200);
    assert.equal((await meta(full)).canSeeDesign, true);
    for (const scoped of [store.createApiToken('Ann', { readOnly: true }), store.createApiToken('Ann', { layouts: ['Congress'] })]) {
      const r = await explain(scoped);
      assert.equal(r.status, 403);
      assert.equal((await r.json()).error.code, 9);
      assert.equal((await meta(scoped)).canSeeDesign, undefined);
    }
    // A portal row has to be a record id.
    const bad = await fetch(`${base}/tabularius/app/v1/databases/Charts/layouts/Congress/explain`, {
      method: 'POST', headers: { authorization: `Bearer ${full}`, 'content-type': 'application/json' }, body: JSON.stringify({ recordId: String(id), field: 'X::Y', row: 'abc' }),
    });
    assert.equal(bad.status, 400);
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});

test('saved finds, sorts and recent records are kept per account, not for limited tokens', { skip }, async () => {
  const store = host.get('Charts')!;
  const url = `${base}/tabularius/app/v1/databases/Charts/prefs`;
  const get = (token: string) => fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const put = (token: string, key: string, body: string) => fetch(`${url}/${key}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
  try {
    const ann = store.createApiToken('Ann', {});
    const admin = store.createApiToken('Admin', {});
    assert.deepEqual((await (await get(ann)).json()).prefs, {});
    const sorts = [{ name: 'By state', layout: 'Congress', sort: [{ fieldName: 'State', sortOrder: 'ascend' }] }];
    assert.equal((await put(ann, 'sorts', JSON.stringify({ value: sorts }))).status, 200);
    assert.deepEqual((await (await get(ann)).json()).prefs, { sorts });
    const finds = { saved: [{ name: 'Open', layout: 'Congress', requests: [] }], recent: [] };
    const recent = [{ layout: 'Congress', recordId: '1', title: 'Smith' }];
    assert.equal((await put(ann, 'finds', JSON.stringify({ value: finds }))).status, 200);
    assert.equal((await put(ann, 'recent', JSON.stringify({ value: recent }))).status, 200);
    const expectedPrefs = { finds, sorts, recent };
    const assertBadPrefBody = async (key: string, body: string) => {
      const response = await put(ann, key, body);
      assert.equal(response.status, 400, `${key} body ${body}`);
      assert.equal((await response.json()).error.code, 5, `${key} body ${body}`);
      assert.deepEqual((await (await get(ann)).json()).prefs, expectedPrefs, `${key} body ${body} must leave saved prefs unchanged`);
    };
    // The top level must be the { value } envelope; raw JSON values and a missing value cannot clear prefs.
    for (const body of ['null', '5', '"x"', '[]', '{}']) await assertBadPrefBody('finds', body);
    // Preference values must match the form the client reads. Empty arrays are valid for list prefs.
    for (const value of [5, 'x', [], {}]) await assertBadPrefBody('finds', JSON.stringify({ value }));
    for (const key of ['sorts', 'recent']) {
      for (const value of [5, 'x', {}]) await assertBadPrefBody(key, JSON.stringify({ value }));
    }
    // A valid PUT still replaces a saved preference.
    const updatedSorts = [{ name: 'By name', layout: 'Congress', sort: [] }];
    assert.equal((await put(ann, 'sorts', JSON.stringify({ value: updatedSorts }))).status, 200);
    assert.deepEqual((await (await get(ann)).json()).prefs, { ...expectedPrefs, sorts: updatedSorts });
    // Another account has its own.
    assert.deepEqual((await (await get(admin)).json()).prefs, {});
    // Only the known keys, as JSON, and not too big.
    assert.equal((await put(ann, 'other', '{"value":1}')).status, 400);
    assert.equal((await put(ann, 'finds', 'not json')).status, 400);
    // ...in the form the web client reads back.
    assert.equal((await put(ann, 'recent', '{"value":{"x":1}}')).status, 400);
    assert.equal((await put(ann, 'recent', '{"value":[{"layout":"Congress","recordId":"1"}]}')).status, 400);
    assert.equal((await put(ann, 'finds', '{"value":{"saved":[]}}')).status, 400);
    assert.equal((await put(ann, 'recent', JSON.stringify({ value: 'x'.repeat(70_000) }))).status, 413);
    // A read-only or layout-limited token sees none of them and changes none.
    for (const scoped of [store.createApiToken('Ann', { readOnly: true }), store.createApiToken('Ann', { layouts: ['Congress'] })]) {
      assert.equal((await get(scoped)).status, 403);
      assert.equal((await put(scoped, 'sorts', '{"value":[]}')).status, 403);
    }
    // Null clears it.
    assert.equal((await put(ann, 'sorts', '{"value":null}')).status, 200);
    assert.deepEqual((await (await get(ann)).json()).prefs, { finds, recent });
    // An account that may no longer use the client can't reach them.
    const set = store.schema.privilegeSets.find((x) => x.name === '[Data Entry Only]')!;
    const before = [...set.extendedPrivileges];
    set.extendedPrivileges.splice(0, set.extendedPrivileges.length);
    store.setPassword('Temp', 'pw', set.name);
    try {
      const temp = store.createApiToken('Temp', {});
      assert.equal((await get(temp)).status, 401);
      assert.equal((await put(temp, 'sorts', '{"value":[]}')).status, 401);
    } finally {
      set.extendedPrivileges.push(...before);
    }
    // A deleted account's go with it: a new account of the same name starts with none.
    assert.equal((await put(ann, 'recent', JSON.stringify({ value: [{ layout: 'Congress', recordId: '1', title: 'Smith' }] }))).status, 200);
    store.setUserPref('Temp', 'recent', '[]');
    assert.ok(store.deleteAccount('temp'));
    assert.deepEqual(store.userPrefs('Temp'), {});
  } finally {
    for (const t of store.apiTokens()) store.revokeApiToken(t.id);
  }
});
