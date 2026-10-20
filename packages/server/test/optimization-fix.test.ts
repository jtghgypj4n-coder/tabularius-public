// The fixes the optimization report offers: each says exactly what it will do before it does it, is one change,
// and can be undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { optimizationReport } from '../src/optimization.ts';
import { applyFix, FixError, previewFix, undoFix } from '../src/optimization-fix.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { serve } from '../src/index.ts';
import { createMcpServer } from '../src/mcp.ts';

function made(): { store: Store; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fix-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Number', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createField', table: 'Orders', name: 'Doubled', kind: 'calculation', type: 'number', calculation: 'Total * 2', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'Today', kind: 'calculation', type: 'text', calculation: 'Get ( CurrentDate )', options: { unstored: true } },
    { op: 'createOccurrence', name: 'Orders old', table: 'Orders' },
    { op: 'createValueList', name: 'Colours', values: ['red', 'green'] },
    { op: 'createValueList', name: 'Sizes', values: ['S', 'M'] },
    { op: 'createScript', name: 'Sort by doubled', text: 'Sort Records [ Restore; Orders::Doubled; descending ; With dialog: Off ]' },
    { op: 'createScript', name: 'Run it', text: 'Perform Script [ "Sort by doubled" ]' },
    { op: 'createScript', name: 'Forgotten', text: '# nobody calls this' },
    { op: 'createScript', name: 'Old import', text: '# nor this' },
    { op: 'updateLayout', layout: 'Orders', design: { objects: [] } },
  ] as never);
  s.close();
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  const ins = sql.prepare('INSERT INTO Orders (Number, Total) VALUES (?, ?)');
  for (let i = 1; i <= 2_000; i++) ins.run(i, i);
  sql.exec('COMMIT');
  sql.close();
  const store = new Store(path, 'Shop');
  return { store, done: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

const design = (s: Store) => JSON.stringify({ schema: s.schema, designs: s.designs(), privileges: s.privilegeSets() });
const finding = (s: Store, id: string) => optimizationReport(s).findings.find((f) => f.id === id);

test('removing what nothing uses lists every name first, changes nothing until approved, and one undo puts it all back', () => {
  const { store, done } = made();
  try {
    const before = design(store);
    const token = store.writeToken();
    const report = optimizationReport(store);
    const scripts = report.findings.find((f) => f.id === 'unused-scripts')!;
    assert.deepEqual(scripts.actions!.map((a) => a.id), ['hide-scripts', 'remove-scripts'], 'hiding is offered first');
    assert.ok(scripts.actions!.every((a) => a.undoable && a.request!.path === '/tabularius/admin/v1/optimization/Shop/fix'));
    assert.deepEqual(scripts.actions![1].request!.body, { fix: 'remove-scripts', count: 3 });

    const peek = previewFix(store, 'remove-scripts');
    assert.equal(peek.count, 3);
    assert.deepEqual(peek.will.map((w) => w.match(/"([^"]+)"/)![1]), ['Run it', 'Forgotten', 'Old import']);
    assert.match(peek.will[1], /^Remove the script "Forgotten" \(1 step\)/);
    previewFix(store, 'remove-value-lists');
    previewFix(store, 'remove-table-occurrences');
    assert.equal(store.writeToken(), token, 'looking changes nothing');
    assert.equal(design(store), before);

    const done1 = applyFix(store, 'remove-scripts', { count: 3 });
    assert.equal(done1.done, 3);
    assert.deepEqual(store.schema.scripts.map((x) => x.name), ['Sort by doubled']);
    // The report now shows the change with its Undo.
    assert.deepEqual(optimizationReport(store).changes!.map((c) => [c.id, c.label, c.undone]), [[done1.undo, 'Remove 3 scripts', undefined]]);

    assert.deepEqual(undoFix(store), { undone: 'Remove 3 scripts' });
    assert.equal(design(store), before, 'every script is back, in its place');
    assert.throws(() => undoFix(store, done1.undo), (e: unknown) => e instanceof FixError && /already undone/.test(e.message));
  } finally {
    done();
  }
});

test('value lists and table occurrences go and come back the same way, each as one change', () => {
  const { store, done } = made();
  try {
    const before = design(store);
    assert.deepEqual(finding(store, 'unused-value-lists')!.where, ['Colours', 'Sizes']);
    applyFix(store, 'remove-value-lists');
    assert.deepEqual(store.schema.valueLists, []);
    applyFix(store, 'remove-table-occurrences', { items: ['Orders old'] });
    assert.ok(!store.schema.tableOccurrences.some((to) => to.name === 'Orders old'));
    assert.equal(finding(store, 'unused-value-lists'), undefined);
    assert.equal(finding(store, 'unused-table-occurrences'), undefined);

    // Latest first: the occurrence, then the value lists.
    assert.deepEqual(undoFix(store), { undone: 'Remove 1 table occurrence' });
    assert.deepEqual(undoFix(store), { undone: 'Remove 2 value lists' });
    assert.equal(design(store), before);
  } finally {
    done();
  }
});

test('hiding a script leaves it in the file, and undo shows it again', () => {
  const { store, done } = made();
  try {
    const before = design(store);
    applyFix(store, 'hide-scripts', { items: ['Forgotten'] });
    assert.ok(store.schema.scripts.some((x) => x.name === 'Forgotten'));
    assert.equal(store.schema.scriptOrder.find((o) => o.kind === 'item' && o.name === 'Forgotten')?.hidden, true);
    assert.equal(store.schema.scriptOrder.find((o) => o.kind === 'item' && o.name === 'Old import')?.hidden, undefined);
    // Hiding offers only what is still shown.
    const left = finding(store, 'unused-scripts')!.actions!.find((a) => a.id === 'hide-scripts')!;
    assert.equal(left.request!.body.count, 2);
    undoFix(store);
    assert.equal(store.schema.scriptOrder.find((o) => o.kind === 'item' && o.name === 'Forgotten')?.hidden, undefined);
    // The order is filled in when the first script is hidden, and stays so.
    assert.equal(JSON.stringify(store.schema.scripts), JSON.parse(before).schema && JSON.stringify(JSON.parse(before).schema.scripts));
  } finally {
    done();
  }
});

test('a calculation a sort depends on is stored, and undo makes it unstored again', () => {
  const { store, done } = made();
  try {
    const f = finding(store, 'unstored-key:Orders::Doubled')!;
    assert.deepEqual(f.actions!.map((a) => [a.id, a.label]), [['store-calculation', 'Make Orders::Doubled a stored calculation']]);
    assert.equal(finding(store, 'unstored-key:Orders::Today')?.actions, undefined, 'one that reads the clock can\'t be stored');

    const peek = previewFix(store, 'store-calculation', ['Orders::Doubled']);
    assert.match(peek.will[0], /^Store the calculation Orders::Doubled/);
    assert.throws(() => planFixOf(store, 'Orders::Today'), (e: unknown) => e instanceof FixError && e.status === 409);

    applyFix(store, 'store-calculation', { items: ['Orders::Doubled'], count: 1 });
    const stored = store.sql.prepare('SELECT "Doubled" AS v FROM Orders WHERE Number = 21').get() as { v: number };
    assert.equal(Number(stored.v), 42, 'its values are now kept in the file');
    assert.ok(!optimizationReport(store).findings.some((x) => x.id === 'unstored-key:Orders::Doubled'));

    undoFix(store);
    assert.equal(store.schema.tables[0].fields.find((x) => x.name === 'Doubled')!.options?.unstored, true);
    assert.ok(finding(store, 'unstored-key:Orders::Doubled'), 'the finding is back');
  } finally {
    done();
  }
});

function planFixOf(store: Store, item: string) {
  return previewFix(store, 'store-calculation', [item]);
}

test('a fix is refused when the file is not as the person was shown it', () => {
  const { store, done } = made();
  try {
    const before = design(store);
    assert.throws(() => applyFix(store, 'remove-scripts', { count: 5 }), (e: unknown) => e instanceof FixError && e.status === 409 && /You were shown 5 changes and the file has 3 now/.test(e.message));
    assert.throws(() => applyFix(store, 'remove-scripts', { items: ['Sort by doubled'] }), (e: unknown) => e instanceof FixError && /"Sort by doubled" is used now/.test(e.message));
    assert.throws(() => applyFix(store, 'store-calculation'), (e: unknown) => e instanceof FixError && e.status === 400);
    assert.throws(() => undoFix(store), (e: unknown) => e instanceof FixError && e.status === 404);
    assert.equal(design(store), before, 'nothing was changed');
  } finally {
    done();
  }
});

// --- the admin API and MCP ---------------------------------------------------------------------

test('the admin API and MCP preview first, change only when told to, and undo', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fix-serve-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const seed = new Store(path, 'Shop');
  seed.applyDesign([
    { op: 'createValueList', name: 'Colours', values: ['red'] },
    { op: 'createScript', name: 'Forgotten', text: '# nobody calls this' },
  ] as never);
  seed.close();
  const s = await serve({ dir, port: 0, log: () => {} });
  const mcp = createMcpServer(s.host, { admin: true });
  const client = new Client({ name: 'optimization-fix-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await mcp.close();
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true });
  });
  const store = s.host.get('Shop')!;
  const post = (verb: string, body: unknown) => fetch(`${s.url}/tabularius/admin/v1/optimization/Shop/${verb}`, {
    method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  // Preview lists the change and makes none.
  const peek = await post('fix', { fix: 'remove-value-lists', preview: true });
  assert.equal(peek.status, 200);
  assert.deepEqual((await peek.json() as { will: string[] }).will, ['Remove the value list "Colours".']);
  assert.equal(store.schema.valueLists.length, 1);
  assert.equal((await post('fix', { fix: 'nonsense' })).status, 400);
  assert.equal((await post('fix', { fix: 'remove-value-lists', count: 9 })).status, 409);
  assert.equal((await fetch(`${s.url}/tabularius/admin/v1/optimization/Shop/fix`, { headers: { 'x-tabularius-admin': '1' } })).status, 405);
  assert.equal(store.schema.valueLists.length, 1);

  const made = await post('fix', { fix: 'remove-value-lists', count: 1 });
  assert.equal(made.status, 200);
  assert.equal(store.schema.valueLists.length, 0);
  const report = await (await fetch(`${s.url}/tabularius/admin/v1/optimization/Shop`, { headers: { 'x-tabularius-admin': '1' } })).json() as { changes: { label: string }[] };
  assert.deepEqual(report.changes.map((c) => c.label), ['Remove 1 value list']);
  assert.equal((await post('undo', {})).status, 200);
  assert.equal(store.schema.valueLists.length, 1);
  assert.equal((await post('undo', {})).status, 404, 'nothing left to undo');

  // MCP: without confirm it only says what it would do.
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcp.connect(st);
  await client.connect(ct);
  const call = async (args: Record<string, unknown>) => {
    const r = await client.callTool({ name: 'optimization_fix', arguments: { database: 'Shop', ...args } });
    return { error: r.isError === true, body: ((r.content as { text: string }[])[0].text) };
  };
  const preview = await call({ fix: 'hide-scripts' });
  assert.match(preview.body, /Nothing was changed\. Send confirm: true/);
  assert.ok(!store.schema.scriptOrder.some((o) => o.kind === 'item' && o.hidden));
  assert.equal((await call({ fix: 'hide-scripts', confirm: true })).error, false);
  assert.ok(store.schema.scriptOrder.some((o) => o.kind === 'item' && o.hidden));
  assert.match((await call({ undo: true })).body, /Hide 1 script/);
  assert.ok(!store.schema.scriptOrder.some((o) => o.kind === 'item' && o.hidden));
  assert.equal((await call({ fix: 'remove-scripts', items: ['Nope'], confirm: true })).error, true);
  assert.equal((await call({})).error, true);
});
