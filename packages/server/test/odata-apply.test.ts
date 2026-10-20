import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { APPLY_LIMIT } from '../src/odata.ts';
import { parseApply } from '../src/odata-apply.ts';

// OData $apply: groups and totals, as Power BI and Excel ask for them.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-apply-'));
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
const apply = (text: string, more = '') => get(`$apply=${encodeURIComponent(text)}${more}`);

test('parseApply reads filter, groupby and aggregate', () => {
  const props = [
    { name: 'State', field: 'State', type: 'text', queryable: true },
    { name: 'District', field: 'District', type: 'number', queryable: true },
    { name: 'Total', field: 'Total', type: 'number', queryable: false },
  ];
  const a = parseApply("filter(State eq 'a/b')/groupby((state),aggregate(District with sum as S,$count as N))", props);
  assert.deepEqual(a.filters, ["State eq 'a/b'"]);
  assert.deepEqual(a.groupBy.map((x) => x.name), ['State']);
  assert.deepEqual(a.aggregates.map((x) => [x.alias, x.method]), [['S', 'sum'], ['N', 'count']]);
  assert.throws(() => parseApply('aggregate(Total with sum as T)', props), /not stored/);
  assert.throws(() => parseApply('aggregate(State with sum as T)', props), /not a number/);
  assert.throws(() => parseApply('aggregate(District with median as T)', props), /not sum/);
  assert.throws(() => parseApply('aggregate(District with sum as T,$count as T)', props), /used twice/);
  assert.throws(() => parseApply('groupby(State)', props), /parentheses/);
  assert.throws(() => parseApply("filter(State eq 'x')", props), /end it with/);
  assert.throws(() => parseApply('groupby((State))/filter(State eq 1)', props), /only filter\(\) steps before/);
  assert.throws(() => parseApply('topcount(2,District)', props), /not supported/);
});

test('native integer fields accept sum and average', () => {
  const props = [{ name: 'N', field: 'N', type: 'integer', queryable: true }];
  const parsed = parseApply('aggregate(N with sum as NS,N with average as NA)', props);
  assert.deepEqual(parsed.aggregates.map((a) => [a.alias, a.method]), [['NS', 'sum'], ['NA', 'average']]);
});

test('groupby with aggregates matches the records', { skip }, async () => {
  const r = await apply('groupby((Party),aggregate(District with sum as Districts,District with max as Top,$count as Members,State with countdistinct as States))');
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.match(r.body['@odata.context'], /#Congress\(Party,Districts,Top,Members,States\)$/);
  const parties = [...new Set(all.map((x) => x.Party))];
  assert.equal(r.body.value.length, parties.length);
  for (const party of parties) {
    const mine = all.filter((x) => x.Party === party);
    const row = r.body.value.find((x: any) => x.Party === party);
    assert.ok(row, `a row for ${party}`);
    assert.equal(row['@odata.id'], null);
    assert.equal(row.Members, mine.length);
    const known = mine.filter((x) => x.District !== null);
    // A sum of no values is empty, as in SQL.
    assert.equal(row.Districts, known.length ? known.reduce((n, x) => n + x.District!, 0) : null);
    assert.equal(row.Top, known.length ? Math.max(...known.map((x) => x.District!)) : null);
    assert.equal(row.States, new Set(mine.map((x) => x.State?.toLowerCase()).filter(Boolean)).size);
  }
});

test('aggregate alone, filter() first, and the query options after it', { skip }, async () => {
  const total = await apply('aggregate($count as N,District with average as Mean)');
  assert.deepEqual(total.body.value.map((x: any) => x.N), [all.length]);
  const districts = all.map((x) => x.District).filter((x): x is number => x !== null);
  assert.ok(Math.abs(total.body.value[0].Mean - districts.reduce((a, b) => a + b, 0) / districts.length) < 1e-9);

  const texas = all.filter((x) => x.State === 'Texas');
  const t = await apply("filter(State eq 'Texas')/groupby((State),aggregate($count as N))");
  assert.deepEqual(t.body.value, [{ '@odata.id': null, State: 'Texas', N: texas.length }]);

  // $filter, $orderby, $top, $skip and $count work on the rows $apply gives.
  const counts = new Map<string, number>();
  for (const x of all) if (x.State) counts.set(x.State, (counts.get(x.State) ?? 0) + 1);
  const big = [...counts].filter(([, n]) => n > 10).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const page = await apply('groupby((State),aggregate($count as N))', `&$filter=${encodeURIComponent('N gt 10')}&$orderby=${encodeURIComponent('N desc,State')}&$top=3&$skip=1&$count=true`);
  assert.equal(page.res.status, 200, JSON.stringify(page.body));
  assert.equal(page.body['@odata.count'], big.length);
  assert.deepEqual(page.body.value.map((x: any) => [x.State, x.N]), big.slice(1, 4));

  // Ordered by a count alone, ties keep one order from page to page.
  const byCount = await get(`$apply=${encodeURIComponent('groupby((State),aggregate($count as N))')}&$orderby=N`, { ...ann, prefer: 'odata.maxpagesize=7' });
  const seen = [...byCount.body.value];
  let link: string | undefined = byCount.body['@odata.nextLink'];
  while (link) {
    const pageN = await fetch(link, { headers: { ...ann, prefer: 'odata.maxpagesize=7' } }).then((x) => x.json()) as any;
    seen.push(...pageN.value);
    link = pageN['@odata.nextLink'];
  }
  assert.equal(new Set(seen.map((x: any) => x.State)).size, seen.length);

  // Pages follow @odata.nextLink.
  const first = await get(`$apply=${encodeURIComponent('groupby((State))')}&$orderby=State`, { ...ann, prefer: 'odata.maxpagesize=20' });
  assert.equal(first.body.value.length, 20);
  const rest = await fetch(first.body['@odata.nextLink'], { headers: { ...ann, prefer: 'odata.maxpagesize=1000' } }).then((x) => x.json()) as any;
  assert.equal(20 + rest.value.length, counts.size + (all.some((x) => !x.State) ? 1 : 0));
  assert.equal(rest['@odata.nextLink'], undefined);
});

test('$apply counts only what the account can see', { skip }, async () => {
  const r = await get(`$apply=${encodeURIComponent('aggregate($count as N)')}`, cy);
  assert.equal(r.res.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.value.map((x: any) => x.N), [all.filter((x) => x.State === 'Texas').length]);
  const hidden = await get(`$apply=${encodeURIComponent('groupby((Party))')}`, cy);
  assert.equal(hidden.res.status, 400);
  assert.match(hidden.body.error.message, /no property "Party"/);
});

test('text groups without regard to case, all of Unicode', { skip }, async () => {
  const made: number[] = [];
  for (const name of ['Émile Zola', 'émile zola', 'ÉMILE ZOLA']) {
    const r = await fetch(`${root}/Congress`, { method: 'POST', headers: { ...ann, 'content-type': 'application/json' }, body: JSON.stringify({ Name: name, State: 'Nowhere' }) });
    made.push(((await r.json()) as { ROWID: number }).ROWID);
  }
  try {
    const r = await apply("filter(State eq 'Nowhere')/groupby((Name),aggregate($count as N,Name with countdistinct as Spellings))");
    assert.equal(r.body.value.length, 1, JSON.stringify(r.body));
    assert.equal(r.body.value[0].N, 3);
    assert.equal(r.body.value[0].Spellings, 1);
  } finally {
    for (const id of made) await fetch(`${root}/Congress(${id})`, { method: 'DELETE', headers: ann });
  }
});

test('$apply refuses what it can\'t do, and says why', { skip }, async () => {
  for (const [q, status, why] of [
    [`$apply=${encodeURIComponent('groupby((State))')}&$select=State`, 400, /\$select can't be used with \$apply/],
    [`$apply=${encodeURIComponent('groupby((State))')}&$search=Texas`, 400, /\$search can't be used with \$apply/],
    [`$apply=${encodeURIComponent('groupby((State))')}&$filter=ROWID eq 1`, 400, /no ROWID/],
    [`$apply=${encodeURIComponent('groupby((State))/groupby((State))')}`, 501, /only filter/],
    [`$apply=${encodeURIComponent('groupby((Nope))')}`, 400, /no property "Nope"/],
    [`$apply=${encodeURIComponent('groupby((State))')}&$skip=99999999999999999999999`, 400, /whole number/],
  ] as const) {
    const r = await get(q);
    assert.equal(r.res.status, status, q);
    assert.match(r.body.error.message, why);
  }
  const was = APPLY_LIMIT.records;
  APPLY_LIMIT.records = 10;
  try {
    const r = await apply('aggregate($count as N)');
    assert.equal(r.res.status, 400);
    assert.match(r.body.error.message, /at most 10 records.*filter/);
    assert.equal((await apply("filter(State eq 'Alaska')/aggregate($count as N)")).res.status, 200);
    // Several filter() steps must all hold.
    const both = await apply("filter(State eq 'Alaska')/filter(State eq 'Texas')/aggregate($count as N)");
    assert.equal(both.res.status, 200);
    assert.equal(both.body.value[0].N, 0);
  } finally {
    APPLY_LIMIT.records = was;
  }
});

test('a $filter in $apply past SQLite\'s limits is a 400, before or after the groups', { skip }, async () => {
  const deep = Array.from({ length: 1_500 }, (_, i) => `District eq ${i}`).join(' or ');
  const res = await fetch(`${root}/$batch`, {
    method: 'POST', headers: { ...ann, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [
      { id: '1', method: 'GET', url: `Congress?$apply=${encodeURIComponent(`filter(${deep})/aggregate($count as N)`)}` },
      { id: '2', method: 'GET', url: `Congress?$apply=${encodeURIComponent('groupby((State),aggregate($count as N))')}&$filter=${encodeURIComponent(Array.from({ length: 1_500 }, (_, i) => `N eq ${i}`).join(' or '))}` },
    ] }),
  });
  for (const answer of ((await res.json()) as { responses: { status: number; body: any }[] }).responses) {
    assert.equal(answer.status, 400, JSON.stringify(answer.body));
    assert.match(JSON.stringify(answer.body), /too complex/);
  }
});
