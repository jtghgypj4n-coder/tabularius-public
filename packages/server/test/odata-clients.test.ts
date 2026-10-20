import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { filterSql, serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

// OData v4 request shapes that Excel and Power Query send, all answered 200 (no behaviour change: a guard).
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


const enc = encodeURIComponent;

test('Excel and Power Query request shapes', { skip }, async () => {
  const accept = { ...ann, accept: 'application/json;odata.metadata=minimal;q=1.0,application/json;odata=minimalmetadata;q=0.9', 'odata-maxversion': '4.0', 'odata-version': '4.0' };
  const seen: Record<string, number> = {};
  const probe = async (label: string, path: string, headers: Record<string, string> = accept) => {
    const r = await fetch(root + path, { headers });
    seen[label] = r.status;
    return r;
  };
  await probe('service', '/Charts/');
  await probe('metadata-trailing-slash', '/Charts/$metadata');
  await probe('format', '/Charts/Congress?$format=json&$top=2');
  await probe('select-star', '/Charts/Congress?$select=*&$top=2');
  await probe('multi-orderby', `/Charts/Congress?$orderby=${enc('State asc,District desc')}&$top=3`);
  await probe('top0', '/Charts/Congress?$top=0');
  await probe('ne-null', `/Charts/Congress?$filter=${enc('Name ne null')}&$top=2`);
  await probe('in', `/Charts/Congress?$filter=${enc('ROWID in (1,2,3)')}`);
  await probe('year', `/Charts/Congress?$filter=${enc('year(ROWMODID) gt 0')}&$top=1`);
  await probe('parens', `/Charts/Congress?$filter=${enc("(State eq 'Texas')")}&$top=1`);
  await probe('length', `/Charts/Congress?$filter=${enc('length(Name) gt 5')}&$top=1`);
  await probe('indexof', `/Charts/Congress?$filter=${enc("indexof(Name,'a') eq 1")}&$top=1`);
  await probe('substring', `/Charts/Congress?$filter=${enc("substring(Name,0,2) eq 'Jo'")}&$top=1`);
  await probe('endswith', `/Charts/Congress?$filter=${enc("endswith(Name,'er')")}&$top=1`);
  await probe('count-only', '/Charts/Congress?$count=true&$top=0');
  await probe('apply-groupby', `/Charts/Congress?$apply=${enc('groupby((State),aggregate($count as Total))')}`);
  await probe('apply-aggregate', `/Charts/Congress?$apply=${enc('aggregate(District with sum as Sum)')}`);
  await probe('apply-filter-groupby', `/Charts/Congress?$apply=${enc("filter(State eq 'Texas')/groupby((Party),aggregate($count as N))")}`);
  await probe('head-ish', '/Charts/Congress(1)?$select=Name');
  // $select on one record leaves the other properties out, as it does on a list.
  const one = (await get('/Charts/Congress(1)?$select=Name')).body;
  assert.equal(one.ROWID, 1);
  assert.ok('Name' in one);
  assert.deepEqual(Object.keys(one).filter((k) => !k.startsWith('@') && !['ROWID', 'ROWMODID', 'Name'].includes(k)), [], '$select=Name leaves every other property out');
  await probe('property', '/Charts/Congress(1)/Name');
  await probe('property-value', '/Charts/Congress(1)/Name/$value');
  await probe('metadata-none', '/Charts/Congress?$top=1', { ...ann, accept: 'application/json;odata.metadata=none' });
  await probe('metadata-full', '/Charts/Congress?$top=1', { ...ann, accept: 'application/json;odata.metadata=full' });
  await probe('xml-accept-service', '/Charts', { ...ann, accept: 'application/xml' });
  const bad = Object.entries(seen).filter(([, s]) => s !== 200);
  assert.deepEqual(bad, []);
});
