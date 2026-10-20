import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { COMPUTE_SIZE } from '../src/odata.ts';

// OData $compute: a property worked out for each record, shown by $select and usable in $filter.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
const ann = { authorization: 'Basic ' + btoa('Ann:pw') };
const cy = { authorization: 'Basic ' + btoa('Cy:pw') };
type Row = { State: string | null; Party: string | null; District: number | null };
let all: Row[];

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-compute-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4/Charts`;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  // Sees Congress without its Party field, and only the Texas records.
  store.savePrivilegeSet({
    name: 'Reports', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false },
    tables: { Congress: { view: 'State = "Texas"', edit: false, create: false, delete: false, fields: { Party: 'none' } } },
  });
  store.setPassword('Cy', 'pw', 'Reports');
  const res = await fetch(`${root}/Congress?$select=State,Party,District`, { headers: { ...ann, prefer: 'odata.maxpagesize=10000' } });
  all = ((await res.json()) as { value: Row[] }).value;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const get = async (query: string, headers: Record<string, string> = ann) => {
  const res = await fetch(`${root}/Congress?${query}`, { headers });
  return { res, body: (await res.json()) as Record<string, any> };
};

const q = (text: string) => encodeURIComponent(text);
const rows = (b: Record<string, any>) => b.value as Record<string, any>[];

test('$compute shows a property worked out for each record, where $select names it', { skip }, async () => {
  const r = await get(`$compute=${q('District mul 2 as Double')}&$select=State,District,Double&$top=20`);
  assert.equal(r.res.status, 200);
  assert.match(r.body['@odata.context'], /#Congress\(ROWID,ROWMODID,State,District,Double\)$/);
  assert.ok(rows(r.body).length > 0);
  for (const x of rows(r.body)) {
    assert.equal(x.Double, x.District === null ? 0 : x.District * 2);
    assert.equal(x.Party, undefined);
  }
});

test('a computed property named alone leaves the stored ones out; unnamed, it is not shown', { skip }, async () => {
  const only = await get(`$compute=${q('District add 1 as Next')}&$select=Next&$top=3`);
  assert.deepEqual(Object.keys(rows(only.body)[0]!).sort(), ['@odata.etag', 'Next', 'ROWID', 'ROWMODID']);
  const hidden = await get(`$compute=${q('District add 1 as Next')}&$select=State&$top=3`);
  assert.equal(rows(hidden.body)[0]!.Next, undefined);
  const star = await get(`$compute=${q('District add 1 as Next')}&$top=3`);
  assert.equal(rows(star.body)[0]!.Next, undefined);
});

test('a computed property can be filtered on, alone or with stored ones', { skip }, async () => {
  const want = all.filter((x) => (x.District ?? 0) + 1 > 5);
  const r = await get(`$compute=${q('District add 1 as Next')}&$filter=${q('Next gt 5')}&$count=true&$top=1`, ann);
  assert.equal(r.body['@odata.count'], want.length);
  const both = await get(`$compute=${q('District add 1 as Next')}&$filter=${q("Next gt 5 and State eq 'Texas'")}&$count=true&$top=1`);
  assert.equal(both.body['@odata.count'], want.filter((x) => x.State === 'Texas').length);
});

test('a yes/no expression is true or false, and text stays text', { skip }, async () => {
  const r = await get(`$compute=${q('District gt 5 as Big,toupper(State) as Loud')}&$select=State,District,Big,Loud&$top=20`);
  assert.equal(r.res.status, 200);
  for (const x of rows(r.body)) {
    assert.equal(x.Big, (x.District ?? 0) > 5);
    assert.equal(x.Loud, x.State === null ? null : x.State.toUpperCase());
  }
  const alone = await get(`$compute=${q('District gt 5 as Big')}&$filter=Big&$count=true&$top=1`);
  assert.equal(alone.body['@odata.count'], all.filter((x) => (x.District ?? 0) > 5).length);
});

test('$compute is refused where it would be wrong, with a message that says what to change', { skip }, async () => {
  const bad = async (compute: string, more = '') => get(`$compute=${q(compute)}${more}`);
  for (const [compute, pattern] of [
    ['State as State', /already a property/],
    ['District add 1 as ROWID', /already a property/],
    ['District add 1', /not an expression and "as" and a name/],
    ['Nope add 1 as X', /\$compute: there is no property "Nope"/],
    ['District add 1 as A,District add 2 as a', /already a property/],
    ["'x as Y", /string is not closed/],
  ] as const) {
    const r = await bad(compute);
    assert.equal(r.res.status, 400, compute);
    assert.match(r.body.error.message, pattern, compute);
    assert.doesNotMatch(r.body.error.message, /\$filter/, compute);
  }
  const sorted = await bad('District add 1 as Next', '&$orderby=Next');
  assert.equal(sorted.res.status, 501);
  assert.match(sorted.body.error.message, /can't be sorted on yet/);
  const applied = await bad('District add 1 as Next', `&$apply=${q('aggregate($count as N)')}`);
  assert.equal(applied.res.status, 400);
  assert.equal((await get('$levels=2')).res.status, 501);
  const many = await bad(Array.from({ length: 51 }, (_, n) => `District add ${n} as P${n}`).join(','));
  assert.equal(many.res.status, 400);
});

test('an account sees computed values only from the records and fields it may view', { skip }, async () => {
  const r = await get(`$compute=${q('District mul 2 as Double')}&$select=State,Double&$count=true`, cy);
  assert.equal(r.res.status, 200);
  assert.ok(rows(r.body).length > 0);
  assert.ok(rows(r.body).every((x) => x.State === 'Texas'));
  assert.equal(r.body['@odata.count'], all.filter((x) => x.State === 'Texas').length);
  const hidden = await get(`$compute=${q("concat(Party, 'x') as P")}&$select=P`, cy);
  assert.equal(hidden.res.status, 400);
  assert.match(hidden.body.error.message, /no property "Party"/);
});

test('a $compute too big for one page is refused as too complex, not a server error', { skip }, async () => {
  const was = COMPUTE_SIZE.params;
  COMPUTE_SIZE.params = 5;
  try {
    const r = await get(`$compute=${q("State in ('a','b','c','d','e','f') as Big")}&$select=Big&$top=1`);
    assert.equal(r.res.status, 400);
    assert.match(r.body.error.message, /too complex/);
    assert.equal((await get(`$compute=${q("State in ('a','b') as Big")}&$select=Big&$top=1`)).res.status, 200);
  } finally {
    COMPUTE_SIZE.params = was;
  }
});
