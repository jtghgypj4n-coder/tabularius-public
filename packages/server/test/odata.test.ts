import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { filterSql, serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { totpCode } from '../../store/src/index.ts';

// OData v4, as Excel, Power BI and other OData clients use it.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
let host: Host;
const ann = { authorization: 'Basic ' + btoa('Ann:pw') };

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  root = `${s.url}/fmi/odata/v4`;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  store.setPassword('Rex', 'pw', full.name);
  // Ann's privileges without OData, and a set that can't see one field.
  store.savePrivilegeSet({ ...full, id: undefined, name: 'No OData', extendedPrivileges: ['fmrest'] });
  store.setPassword('Bo', 'pw', 'No OData');
  store.savePrivilegeSet({
    name: 'Reports', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false }, tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { Party: 'none' } } },
  });
  store.setPassword('Cy', 'pw', 'Reports');
  store.applyDesign([
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Get ( ScriptParameter ) & "!" ]' },
    { op: 'createScript', name: 'Fetch', text: 'Insert from URL [ $r ; "http://127.0.0.1:9/" ]\nExit Script [ Get ( LastError ) ]' },
  ]);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string, headers: Record<string, string> = ann) => {
  const res = await fetch(root + path, { headers });
  return { res, body: res.headers.get('content-type')?.includes('json') ? await res.json() as Record<string, any> : await res.text() as any };
};

test('$filter becomes a parameterized condition on stored fields', () => {
  const props = [
    { name: 'Name', field: 'Name', type: 'text', edm: 'Edm.String', queryable: true, writable: true },
    { name: 'Age', field: 'Age', type: 'number', edm: 'Edm.Decimal', queryable: true, writable: true },
    { name: 'Total', field: 'Total', type: 'number', edm: 'Edm.Decimal', queryable: false, writable: false },
  ];
  const f = filterSql("Name eq 'x'' or 1=1 --' and (Age ge 18 or Age eq null)", props);
  assert.deepEqual(f.params, ["x' or 1=1 --", 18]);
  assert.match(f.where, /"Name"\) IS \(\?\)/);
  assert.deepEqual(f.fields.sort(), ['Age', 'Name']);
  assert.deepEqual(filterSql("contains(tolower(Name),'an') and not startswith(Name,'Z')", props).params, ['an', 'Z']);
  assert.throws(() => filterSql('Total gt 5', props), /not stored/);
  assert.throws(() => filterSql('Nope eq 1', props), /no property/);
  assert.throws(() => filterSql("Name eq 'a' )", props), /unexpected/);
  assert.throws(() => filterSql('Name eq', props), /ends too soon/);
});

test('service document, metadata and sign-in', { skip }, async () => {
  const files = await get('');
  assert.deepEqual(files.body.value, [{ name: 'Charts', kind: 'EntityContainer', url: 'Charts' }]);

  const none = await get('/Charts', {});
  assert.equal(none.res.status, 401);
  assert.match(none.res.headers.get('www-authenticate')!, /^Basic/);
  const bo = await get('/Charts', { authorization: 'Basic ' + btoa('Bo:pw') });
  assert.equal(bo.res.status, 403);
  assert.match(bo.body.error.message, /fmodata/);

  const sets = await get('/Charts');
  assert.equal(sets.res.headers.get('odata-version'), '4.0');
  assert.ok(sets.body.value.some((s: { name: string }) => s.name === 'Congress'));

  const meta = await get('/Charts/$metadata');
  assert.match(meta.res.headers.get('content-type')!, /^application\/xml/);
  assert.match(meta.body, /<EntitySet Name="Congress" EntityType="Charts\.Congress"\/>/);
  assert.match(meta.body, /<Key><PropertyRef Name="ROWID"\/><\/Key>/);
  assert.match(meta.body, /<Property Name="District" Type="Edm.Decimal" Scale="variable"\/>/);
  assert.match(meta.body, /<Property Name="Party" Type="Edm.String"\/>/);

  // A field the account can't see isn't there at all.
  const cy = { authorization: 'Basic ' + btoa('Cy:pw') };
  assert.doesNotMatch((await get('/Charts/$metadata', cy)).body, /Name="Party"/);
  const row = await get('/Charts/Congress(1)', cy);
  assert.equal(row.body.Name, 'Jo Bonner');
  assert.equal('Party' in row.body, false);
  assert.equal((await get("/Charts/Congress?$filter=Party eq 'R'", cy)).res.status, 400);
});

test('querying: $filter, $select, $orderby, $top, $skip, $count and paging', { skip }, async () => {
  const q = await get(`/Charts/Congress?$filter=${encodeURIComponent("State eq 'Texas' and District le 3")}&$select=Name,District&$orderby=District desc&$count=true`);
  assert.equal(q.res.status, 200);
  assert.equal(q.body['@odata.count'], 3);
  assert.deepEqual(q.body.value.map((r: { District: number }) => r.District), [3, 2, 1]);
  assert.deepEqual(Object.keys(q.body.value[0]), ['@odata.etag', 'ROWID', 'ROWMODID', 'Name', 'District']);
  assert.match(q.body['@odata.context'], /\$metadata#Congress\(ROWID,ROWMODID,Name,District\)$/);

  const page = await get('/Charts/Congress?$orderby=Name&$skip=10&$top=5&$select=Name');
  const names = page.body.value.map((r: { Name: string }) => r.Name);
  assert.equal(names.length, 5);
  assert.deepEqual(names, [...names].sort((a: string, b: string) => a.localeCompare(b)));

  assert.equal((await get('/Charts/Congress/$count')).body, '540');
  assert.equal((await get(`/Charts/Congress/$count?$filter=${encodeURIComponent("contains(Name,'an')")}`)).body,
    String((await get(`/Charts/Congress?$filter=${encodeURIComponent("contains(Name,'an')")}&$select=Name&$count=true`)).body['@odata.count']));

  // Following nextLink reads everything once.
  let next: string | undefined = `${root}/Charts/Congress?$select=Name`;
  const seen = new Set<number>();
  let pages = 0;
  while (next) {
    const res: Response = await fetch(next, { headers: { ...ann, prefer: 'odata.maxpagesize=200' } });
    assert.equal(res.headers.get('preference-applied'), 'odata.maxpagesize=200');
    const body = await res.json() as { value: { ROWID: number }[]; '@odata.nextLink'?: string };
    for (const r of body.value) seen.add(r.ROWID);
    next = body['@odata.nextLink'];
    pages++;
  }
  assert.equal(pages, 3);
  assert.equal(seen.size, 540);

  assert.equal((await get('/Charts/Congress?$expand=x')).res.status, 400, 'no navigation property x');
  assert.equal((await get('/Charts/Congress?$compute=x')).res.status, 400, 'no expression and name');
  assert.equal((await get('/Charts/Congress?$levels=2')).res.status, 501);
  assert.equal((await get('/Charts/Congress?$bogus=1')).res.status, 400);
  assert.equal((await get('/Charts/Nope')).res.status, 404);
});

test('records: create, read with an ETag, change with If-Match, delete', { skip }, async () => {
  const json = { ...ann, 'content-type': 'application/json' };
  const made = await fetch(`${root}/Charts/Congress`, { method: 'POST', headers: json, body: JSON.stringify({ Name: 'Test Person', 'Name@odata.type': '#String', District: 7 }) });
  assert.equal(made.status, 201);
  const entity = await made.json() as { ROWID: number; Name: string; District: number };
  assert.equal(entity.Name, 'Test Person');
  assert.equal(entity.District, 7);
  const url = made.headers.get('location')!;
  assert.equal(url, `${root}/Charts/Congress(${entity.ROWID})`);

  const read = await fetch(url, { headers: ann });
  const tag = read.headers.get('etag')!;
  assert.equal(tag, 'W/"0"');

  const patch = (body: unknown, ifMatch?: string) => fetch(url, { method: 'PATCH', headers: { ...json, ...(ifMatch ? { 'if-match': ifMatch } : {}) }, body: JSON.stringify(body) });
  const changed = await patch({ State: 'Nowhere' }, tag);
  assert.equal(changed.status, 204);
  assert.equal(changed.headers.get('etag'), 'W/"1"');
  const stale = await patch({ State: 'Elsewhere' }, tag);
  assert.equal(stale.status, 412);
  assert.equal(((await stale.json()) as { error: { code: string } }).error.code, '306');
  assert.equal((await patch({ ROWMODID: 9, Nope: 1 })).status, 400);
  assert.equal(await (await fetch(`${url}/State/$value`, { headers: ann })).text(), 'Nowhere');

  // Someone else changed it: deleting with the old ETag is refused.
  assert.equal((await fetch(url, { method: 'DELETE', headers: { ...ann, 'if-match': tag } })).status, 412);
  assert.equal((await fetch(url, { method: 'DELETE', headers: ann })).status, 204);
  assert.equal((await fetch(url, { headers: ann })).status, 404);

  // A read-only API token reads but doesn't write.
  const token = host.get('Charts')!.createApiToken('Ann', { readOnly: true });
  const bearer = { authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${root}/Charts/Congress(1)`, { headers: bearer })).status, 200);
  assert.equal((await fetch(`${root}/Charts/Congress`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{"Name":"x"}' })).status, 403);
  // Neither does an account whose records are view-only.
  const cy = { authorization: 'Basic ' + btoa('Cy:pw'), 'content-type': 'application/json' };
  assert.equal((await fetch(`${root}/Charts/Congress(1)`, { method: 'PATCH', headers: cy, body: '{"Name":"x"}' })).status, 403);
});

test('scripts run with a parameter, and offline', { skip }, async () => {
  const run = async (name: string, body: unknown, who = ann) => {
    const res = await fetch(`${root}/Charts/Script.${encodeURIComponent(name)}`, { method: 'POST', headers: { ...who, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as { scriptResult?: { code: number; resultParameter: string }; error?: { code: string } } };
  };
  assert.deepEqual((await run('Echo', { scriptParameterValue: 'hi' })).body, { scriptResult: { code: 0, resultParameter: 'hi!' } });
  assert.equal((await run('Echo', { scriptParameterValue: { a: 1 } })).body.scriptResult!.resultParameter, '{"a":1}!');
  // The server doesn't allow scripts the network, so Insert from URL fails.
  const fetched = await run('Fetch', {});
  assert.ok(Number(fetched.body.scriptResult!.resultParameter) > 0, fetched.body.scriptResult!.resultParameter);
  assert.equal((await run('Nope', {})).status, 404);
  assert.equal((await run('Echo', {}, { authorization: 'Basic ' + btoa('Cy:pw') })).status, 403);
  // By id (the Claris form Script.FMSID:<id>), so renaming a script breaks no integration; the same privileges apply.
  const echoId = host.get('Charts')!.schema.scripts.find((x) => x.name === 'Echo')!.id;
  assert.deepEqual((await run(`FMSID:${echoId}`, { scriptParameterValue: 'hi' })).body, { scriptResult: { code: 0, resultParameter: 'hi!' } });
  assert.equal((await run(`fmsid:${echoId}`, { scriptParameterValue: 'hi' })).status, 200);
  assert.equal((await run(`FMSID:${echoId}`, {}, { authorization: 'Basic ' + btoa('Cy:pw') })).status, 403);
  assert.equal((await run('FMSID:999999', {})).status, 404);
});

test('write bodies and query options that make no sense are refused, not stored or ignored', { skip }, async () => {
  const json = { ...ann, 'content-type': 'application/json' };
  const post = (body: string) => fetch(`${root}/Charts/Congress`, { method: 'POST', headers: json, body });
  // A body that is not an object.
  for (const body of ['null', '[1]', '"text"', '7']) {
    const r = await post(body);
    assert.equal(r.status, 400, body);
  }
  // Text for a number field: refused like a number for a text field is, not stored as nothing.
  const before = (await get('/Charts/Congress?$count=true&$top=0')).body['@odata.count'] as number;
  const bad = await post(JSON.stringify({ Name: 'Nobody', District: 'abc' }));
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /District/);
  assert.equal((await get('/Charts/Congress?$count=true&$top=0')).body['@odata.count'], before);
  // A number written as text is still a number.
  const ok = await post(JSON.stringify({ Name: 'Numeric Text', District: '12' }));
  assert.equal(ok.status, 201);
  assert.equal(((await ok.json()) as { District: number }).District, 12);
  await fetch(ok.headers.get('location')!, { method: 'DELETE', headers: ann });
  // $count is true or false.
  const maybe = await get('/Charts/Congress?$count=maybe&$top=1');
  assert.equal(maybe.res.status, 400);
  assert.equal((await get('/Charts/Congress?$count=false&$top=1')).res.status, 200);
});

test('HTTP Basic enforces TOTP and owed password changes; accounts without TOTP still work', { skip }, async () => {
  const store = host.get('Charts')!;
  store.setPassword('TwoFactorOData', 'pw', '[Full Access]');
  const { secret } = store.enrollTotp('TwoFactorOData');
  store.confirmTotp('TwoFactorOData', totpCode(secret));
  const request = (headers: Record<string, string>) => fetch(`${root}/Charts/`, { headers });
  const denied = await request({ authorization: 'Basic ' + btoa('TwoFactorOData:pw') });
  assert.equal(denied.status, 401);
  assert.match(await denied.text(), /one-time code/i);
  const accepted = await request({ authorization: 'Basic ' + btoa('TwoFactorOData:pw'), 'x-tabularius-otp': totpCode(secret) });
  assert.equal(accepted.status, 200);
  assert.equal((await request(ann)).status, 200);
  store.setMustChangePassword('Ann', true);
  const forced = await request(ann);
  assert.equal(forced.status, 403);
  assert.match(await forced.text(), /must change.*password/i);
});
