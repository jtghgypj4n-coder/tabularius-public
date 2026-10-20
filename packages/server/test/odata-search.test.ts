import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { SEARCH_LIMIT, searchSql } from '../src/odata-search.ts';

// OData $search: free text over the text fields the account can see.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
const ann = { authorization: 'Basic ' + btoa('Ann:pw') };
const cy = { authorization: 'Basic ' + btoa('Cy:pw') };
let all: Record<string, unknown>[];
let text: string[];

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-search-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4/Charts`;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  store.savePrivilegeSet({
    name: 'Reports', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false }, tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { Party: 'none' } } },
  });
  store.setPassword('Cy', 'pw', 'Reports');
  const res = await fetch(`${root}/Congress`, { headers: { ...ann, prefer: 'odata.maxpagesize=10000' } });
  all = ((await res.json()) as { value: Record<string, unknown>[] }).value;
  const meta = await (await fetch(`${root}/$metadata`, { headers: ann })).text();
  const type = /<EntityType Name="Congress">([\s\S]*?)<\/EntityType>/.exec(meta)![1];
  text = [...type.matchAll(/<Property Name="([^"]+)" Type="Edm\.String"/g)].map((m) => m[1]);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const ids = async (search: string, headers: Record<string, string> = ann, more = '') => {
  const res = await fetch(`${root}/Congress?$search=${encodeURIComponent(search)}&$select=Name${more}`, { headers: { ...headers, prefer: 'odata.maxpagesize=10000' } });
  const body = await res.json() as Record<string, any>;
  return { res, body, ids: res.ok ? (body.value as { ROWID: number }[]).map((x) => x.ROWID).sort((a, b) => a - b) : [] };
};
const has = (r: Record<string, unknown>, word: string, fields = text) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(word.toLowerCase()));
const expect = (pick: (r: Record<string, unknown>) => boolean) => all.filter(pick).map((r) => r.ROWID as number).sort((a, b) => a - b);

test('searchSql reads words, phrases, AND, OR, NOT and parentheses', () => {
  const props = [{ name: 'A', field: 'A', type: 'text', queryable: true }, { name: 'N', field: 'N', type: 'number', queryable: true }];
  const s = searchSql('blue "big whale" OR NOT (red AND green)', props);
  assert.deepEqual(s.params, ['blue', 'big whale', 'red', 'green']);
  assert.match(s.where, /^\(\(.+ AND .+\) OR NOT \(.+ AND .+\)\)$/);
  assert.deepEqual(s.fields, ['A']);
  assert.deepEqual(searchSql('"say \\"hi\\""', props).params, ['say "hi"']);
  assert.throws(() => searchSql('"open', props), /phrase is not closed/);
  assert.throws(() => searchSql('(a', props), /not closed/);
  assert.throws(() => searchSql('a OR', props), /ends too soon/);
  assert.throws(() => searchSql('a )', props), /out of place/);
  assert.throws(() => searchSql('   ', props), /empty/);
  assert.throws(() => searchSql('x', [props[1]]), /no text fields/);
  // Escapes are only \" and \\.
  assert.deepEqual(searchSql('"a\\\\x"', props).params, ['a\\x']);
  assert.throws(() => searchSql('"a\\b"', props), /only escape/);
  // Long searches are refused before they cost anything, and the parameters stay in step with the SQL.
  const many = Array.from({ length: SEARCH_LIMIT.terms }, (_, i) => `w${i}`);
  const s100 = searchSql(many.join(' OR '), props);
  assert.deepEqual(s100.params, many);
  assert.equal((s100.where.match(/\?/g) ?? []).length, many.length);
  assert.throws(() => searchSql([...many, 'one more'].join(' '), props), /at most 100/);
  assert.throws(() => searchSql('('.repeat(40) + 'x' + ')'.repeat(40), props), /more than 32 deep/);
  assert.throws(() => searchSql('NOT '.repeat(40) + 'x', props), /more than 32 deep/);
  const wide = Array.from({ length: 400 }, (_, i) => ({ name: `T${i}`, field: `T${i}`, type: 'text', queryable: true }));
  assert.throws(() => searchSql(many.join(' '), wide), /too many/);
});

test('$search finds records by any text field, as the spec combines terms', { skip }, async () => {
  const one = await ids('texas');
  assert.equal(one.res.status, 200, JSON.stringify(one.body));
  assert.ok(one.ids.length > 0);
  assert.deepEqual(one.ids, expect((r) => has(r, 'texas')));

  assert.deepEqual((await ids('TEXAS john')).ids, expect((r) => has(r, 'texas') && has(r, 'john')));
  assert.deepEqual((await ids('texas OR ohio')).ids, expect((r) => has(r, 'texas') || has(r, 'ohio')));
  assert.deepEqual((await ids('texas NOT john')).ids, expect((r) => has(r, 'texas') && !has(r, 'john')));
  assert.deepEqual((await ids('(texas OR ohio) AND NOT john')).ids, expect((r) => (has(r, 'texas') || has(r, 'ohio')) && !has(r, 'john')));
  // A phrase is one term: "new york" is not "new" anywhere and "york" anywhere.
  assert.deepEqual((await ids('"new york"')).ids, expect((r) => has(r, 'new york')));

  // With $filter, $count and $orderby, and on /$count.
  const both = await ids('texas', ann, `&$filter=${encodeURIComponent('District le 3')}&$count=true`);
  assert.deepEqual(both.ids, expect((r) => has(r, 'texas') && r.District !== null && Number(r.District) <= 3));
  assert.equal(both.body['@odata.count'], both.ids.length);
  const count = await fetch(`${root}/Congress/$count?$search=texas`, { headers: ann });
  assert.equal(await count.text(), String(one.ids.length));
});

test('$search only searches fields the account can see', { skip }, async () => {
  const party = String(all.find((r) => r.Party)!.Party);
  const seen = text.filter((f) => f !== 'Party');
  const r = await ids(party, cy);
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.ids, expect((x) => has(x, party, seen)));
  assert.notDeepEqual((await ids(party)).ids, r.ids, 'Ann, who sees Party, finds more');
});

test('a $search that can\'t be read is a 400 that says why', { skip }, async () => {
  const r = await ids('"open');
  assert.equal(r.res.status, 400);
  assert.match(r.body.error.message, /\$search: a phrase is not closed/);
  // Too long a search, even inside a $batch where the URL can be long, is a quick 400.
  const long = Array.from({ length: 5000 }, (_, i) => `w${i}`).join(' OR ');
  const started = performance.now();
  const res = await fetch(`${root}/$batch`, {
    method: 'POST', headers: { ...ann, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [{ id: '1', method: 'GET', url: `Congress?$search=${encodeURIComponent(long)}` }] }),
  });
  const answer = ((await res.json()) as { responses: { status: number; body: any }[] }).responses[0];
  assert.equal(answer.status, 400);
  assert.match(JSON.stringify(answer.body), /at most 100/);
  assert.ok(performance.now() - started < 2000);
});
