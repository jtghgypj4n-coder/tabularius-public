// Rules from the data: validations, value lists, serials and defaults a table's records already follow, each
// with the design change that adds it, accepted one at a time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { DesignOp, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { suggestRules } from '../src/rule-suggestions.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-rule-suggestions-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.setPassword('Admin', 'Admin-pw-123456');
  // One record spells the chamber in lower case.
  const id = store.findIds('Congress', { query: [{ Chamber: '==Senate' }] })[0];
  store.update('Congress', id, { Chamber: 'senate' });
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('a handful of values becomes a value list to check against, case variants named; accepting adds both', { skip }, () => {
  const { suggestions } = suggestRules(store, { table: 'Congress' });
  const party = suggestions.find((s) => s.field === 'Party' && s.kind === 'valueList')!;
  assert.match(party.title, /Congress::Party only ever holds one of 4 values \(R, D, I, ID\): make a value list "Party Values"/);
  const chamber = suggestions.find((s) => s.field === 'Chamber' && s.kind === 'valueList')!;
  assert.match(chamber.title, /one of 2 values \((House, Senate|Senate, House)\)/);
  assert.match(chamber.evidence, /Also spelled "senate"/);
  // Name fields that are always filled in are suggested as required; the numbers aren't one by one.
  assert.ok(suggestions.some((s) => s.field === 'Name' && s.kind === 'notEmpty'));
  assert.ok(!suggestions.some((s) => s.field === 'Liberal_Economic' && s.kind === 'notEmpty'));
  store.applyDesign(party.changes as DesignOp[]);
  const vl = store.schema.valueLists.find((v) => v.name === 'Party Values')!;
  const field = store.schema.tables.find((t) => t.name === 'Congress')!.fields.find((f) => f.name === 'Party')!;
  assert.equal(field.options?.validation?.valueList, vl.id);
  // Accepted: not suggested again.
  assert.ok(!suggestRules(store, { table: 'Congress' }).suggestions.some((s) => s.field === 'Party' && s.kind === 'valueList'));
});

test('no serial for a year every ten or a running total; unknown tables are refused', { skip }, () => {
  const { suggestions } = suggestRules(store, { table: 'US Population' });
  assert.ok(!suggestions.some((s) => s.kind === 'serial'), JSON.stringify(suggestions.map((s) => s.title)));
  assert.throws(() => suggestRules(store, { table: 'Nope' }), /No table named "Nope"/);
});

test('as an MCP tool for [Full Access]', { skip }, async () => {
  const res = await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: 'Basic ' + btoa('Admin:Admin-pw-123456'),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'suggest_rules', arguments: { database: 'Charts', table: 'US Coasters' } } }),
  })).json();
  const r = JSON.parse(res.result.content[0].text);
  assert.ok(r.suggestions.some((s: { field: string }) => s.field === 'Design'));
});
