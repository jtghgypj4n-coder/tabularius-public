import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { compactComparison, compareSolutions, lineDiff } from '../src/compare.ts';
import { serve } from '../src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = ['Charts.fmp12', 'Flicks.fmp12'].every((f) => existsSync(join(fixtures, f))) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let host: Host;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-compare-'));
  copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'Charts.fmp12'));
  copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'Charts v2.fmp12'));
  copyFileSync(join(fixtures, 'Flicks.fmp12'), join(dir, 'Flicks.fmp12'));
  host = new Host(dir);
});
after(async () => {
  // Files closed (and background warming stopped) before the folder is removed, or macOS can refuse with ENOTEMPTY.
  await host?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('line diff keeps only what changed', () => {
  assert.deepEqual(lineDiff(['a', 'b', 'c', 'd'], ['a', 'c', 'x', 'd']), ['- b', '+ x']);
  assert.deepEqual(lineDiff(['a'], ['a']), []);
});

test('identical copies have no differences', { skip }, () => {
  const c = compareSolutions(host.get('Charts')!, host.get('Charts v2')!);
  assert.equal(c.matchedBy, 'id');
  assert.equal(c.summary, 'No differences in design or record counts.');
});

test('a new version: renames, changed formulas and scripts, removed layouts, new records', { skip }, () => {
  const v2 = host.get('Charts v2')!;
  const s = v2.schema;
  // Edit the second copy's design in memory the way a developer would in FileMaker.
  const congress = s.tables.find((t) => t.name === 'Congress')!;
  const calc = congress.fields.find((f) => f.kind === 'calculation' && f.calculation)!;
  const before = calc.calculation!;
  calc.calculation = before + ' & "!"';
  const renamedField = congress.fields.find((f) => f.name === 'State')!;
  renamedField.name = 'State Name';
  const script = s.scripts.find((x) => x.name === 'Show Senate')!;
  script.name = 'Show Senators';
  script.steps = script.steps.slice(0, -1);
  const removed = s.layouts.splice(s.layouts.findIndex((l) => l.name === 'Grades'), 1)[0];
  v2.create('Grades', {});

  const c = compareSolutions(host.get('Charts')!, v2);
  assert.equal(c.matchedBy, 'id');
  assert.deepEqual(c.fields.renamed.map((r) => [r.was, r.name]), [['Congress::State', 'Congress::State Name']]);
  const changed = c.fields.changed.find((f) => f.name === `Congress::${calc.name}`)!;
  assert.match(changed.details![0], /^formula: .* → .*& "!"/);
  const sc = c.scripts.renamed.find((r) => r.name === 'Show Senators')!;
  assert.equal(sc.was, 'Show Senate');
  assert.equal(sc.diff!.length, 1);
  assert.match(sc.diff![0], /^- /);
  assert.deepEqual(c.layouts.removed, [removed.name]);
  assert.deepEqual(c.records.find((r) => r.table === 'Grades')?.to, (c.records.find((r) => r.table === 'Grades')?.from ?? 0) + 1);
  assert.match(c.summary, /fields: 1 renamed, 1 changed; layouts: 1 removed; scripts: 1 renamed/);
  const compact = compactComparison(c);
  assert.ok(!('valueLists' in compact));
  assert.ok('scripts' in compact);
});

test('unrelated files are matched by name; MCP tool', { skip }, async () => {
  const c = compareSolutions(host.get('Charts')!, host.get('Flicks')!);
  assert.equal(c.matchedBy, 'name');
  assert.ok(c.tables.added.includes('MOVIE'));
  assert.ok(c.tables.removed.includes('Congress'));

  const { server, url, host: served } = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  try {
    const call = async (args: unknown) => (await (await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compare_solutions', arguments: args } }),
    })).json()).result;
    const out = await call({ from: 'Charts', to: 'Flicks' });
    assert.equal(JSON.parse(out.content[0].text).matchedBy, 'name');
    assert.ok((await call({ from: 'Charts', to: 'Nope' })).isError);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
    await served.close();
  }
});
