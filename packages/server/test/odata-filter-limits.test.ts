import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { filterSql, serve } from '../src/index.ts';
import { FILTER_LIMIT } from '../src/odata.ts';

// A long or deep $filter (a $batch can carry one far past a URL's length) is a quick 400, never minutes of work or a 500.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
const ann = { authorization: 'Basic ' + btoa('Ann:pw') };

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-filter-limits-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4/Charts`;
  const store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const props = [
  { name: 'Name', field: 'Name', type: 'text', edm: 'Edm.String', queryable: true, writable: true },
  { name: 'Age', field: 'Age', type: 'number', edm: 'Edm.Decimal', queryable: true, writable: true },
];

test('filterSql refuses a $filter too long or too deep, and says which', () => {
  const chain = (n: number) => Array.from({ length: n }, (_, i) => `Name eq 'n${i}'`).join(' or ');
  assert.equal(filterSql(chain(400), props).params.length, 400);
  assert.throws(() => filterSql(chain(2_600), props), /too long: at most 10,000/);
  assert.throws(() => filterSql('x'.repeat(1_000_001), props), /too long: at most 1,000,000 characters/);
  assert.throws(() => filterSql('('.repeat(40) + 'Age eq 1' + ')'.repeat(40), props), /more than 32 deep/);
  assert.throws(() => filterSql('not '.repeat(40) + 'Age eq 1', props), /more than 32 deep/);
  assert.throws(() => filterSql('- '.repeat(40) + 'Age eq 1', props), /more than 32 deep/);
  assert.throws(() => filterSql('tolower('.repeat(40) + 'Name' + ')'.repeat(40) + " eq 'a'", props), /more than 32 deep/);
  // Functions, not and the and/or test name their argument once, so nesting them to the depth limit stays small.
  const deep = (open: string, close: string) => filterSql(open.repeat(30) + 'Name' + close.repeat(30), props);
  for (const [open, close] of [['floor(', ')'], ['ceiling(', ')'], ['not ', ''], ['endswith(Name,', ')'], ['startswith(Name,', ')']]) {
    const f = deep(open, close);
    assert.ok(f.where.length < 10_000, `${open}: ${f.where.length} characters of SQL`);
    assert.ok(f.params.length <= 1);
  }
  assert.equal(FILTER_LIMIT.depth, 32);
});

test('the longest $filter allowed runs, and a longer one in a $batch is a quick 400', { skip }, async () => {
  const batched = async (q: string) => {
    const res = await fetch(`${root}/$batch`, {
      method: 'POST', headers: { ...ann, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ id: '1', method: 'GET', url: `Congress/$count?$filter=${encodeURIComponent(q)}` }] }),
    });
    return ((await res.json()) as { responses: { status: number; body: any }[] }).responses[0];
  };
  const at = (q: string) => fetch(`${root}/Congress/$count?$filter=${encodeURIComponent(q)}`, { headers: ann });
  // Under the limit: 499 comparisons joined by and/or still fit SQLite's expression depth.
  const longest = Array.from({ length: 499 }, (_, i) => `District eq ${i}`).join(' or ');
  const ok = await at(longest);
  assert.equal(ok.status, 200, await ok.clone().text());
  const values = Array.from({ length: 990 }, (_, i) => i).join(',');
  assert.equal((await at(`District in (${values})`)).status, 200);
  // Under the token limit but past SQLite's expression depth: still the client's to shorten.
  const deeper = await batched(Array.from({ length: 1_500 }, (_, i) => `District eq ${i}`).join(' or '));
  assert.equal(deeper.status, 400);
  assert.match(JSON.stringify(deeper.body), /too complex/);
  // Nested functions around a field run as SQL of about the same size as the text.
  const nestedOk = await at('endswith('.repeat(14) + 'State' + ",'a')".repeat(14) + ' eq false');
  assert.equal(nestedOk.status, 200, await nestedOk.clone().text());

  const huge = Array.from({ length: 50_000 }, (_, i) => `District eq ${i}`).join(' and ');
  const started = performance.now();
  const answer = await batched(huge);
  assert.equal(answer.status, 400);
  assert.match(JSON.stringify(answer.body), /too long/);
  assert.ok(performance.now() - started < 3000);
});
