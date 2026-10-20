// Memory on large files: a script past the memory limit is stopped (test-scripts
// counts it as stalled instead of the process running out of memory), and
// summaries read only the column they summarize.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store, summaryColumns } from '@tabularius/store';
import { runScript, testScripts } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-memory-'));
  createStore(join(dir, 'M.sqlite'));
  store = new Store(join(dir, 'M.sqlite'), 'M');
  const table = 'Orders';
  store.applyDesign([{ op: 'createTable', name: table, fields: [{ name: 'Amount', type: 'number' }, { name: 'Notes', type: 'text' }] }]);
  store.applyDesign([
    { op: 'createField', table, name: 'Double', type: 'number', kind: 'calculation', options: { unstored: true }, calculation: 'Amount * 2' },
    { op: 'createField', table, name: 'Total', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
    { op: 'createField', table, name: 'Total Double', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Double' } },
    { op: 'createScript', name: 'Spin', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nExit Loop If [ $i > 5000 ]\nEnd Loop' },
    // Stands in for an upload script that calls a cloud service: it must never run when skipped, however it is reached.
    { op: 'createScript', name: 'Upload to Amazon Orders', text: 'Set Field [ Orders::Notes ; "uploaded" ]\nExit Script [ Text Result: "ran" ]' },
  ]);
  store.applyDesign([
    { op: 'createScript', name: 'Convert', text: 'Perform Script [ “Upload to Amazon Orders” ]\nExit Script [ Text Result: Get ( LastError ) & "/" & Get ( ScriptResult ) ]' },
    { op: 'createScript', name: 'Convert on server', text: 'Perform Script on Server [ “Upload to Amazon Orders” ]\nExit Script [ Text Result: Get ( LastError ) & "/" & Get ( ScriptResult ) ]' },
    { op: 'createScript', name: 'Convert with callback', text: 'Perform Script on Server with Callback [ “Spin” ; Callback script: “Upload to Amazon Orders” ; State: Continue ]' },
  ]);
  for (let i = 1; i <= 50; i++) store.create(table, { Amount: String(i), Notes: 'x'.repeat(1000) });
  store.applyDesign([{ op: 'createTable', name: 'Lines', fields: [{ name: 'N', type: 'number' }, { name: 'Label', type: 'text' }] }]);
  for (let i = 1; i <= 2500; i++) store.create('Lines', { N: String(i), Label: `line ${i}` });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const script = (text: string) => ({
  id: 9999, name: 'test',
  steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script);

test('a script past the memory limit is stopped', async () => {
  const r = await runScript(store, 'Spin', { memoryLimit: 1 });
  assert.ok(r.actions.some((a) => a.step === 'Halt Script' && /memory limit reached/.test(String((a as { reason?: string }).reason))));
  assert.ok(r.steps < 200, `ran ${r.steps} steps`);
  // Without a limit it runs to the end.
  assert.ok((await runScript(store, 'Spin')).steps > 15_000);
});

test('test-scripts counts a script stopped for memory as stalled, and says why', async () => {
  const [r] = await testScripts(store, { scripts: ['Spin'], memoryLimit: 1 });
  assert.equal(r.outcome, 'stalled');
  assert.match(r.message ?? '', /memory limit reached/);
  const [ok] = await testScripts(store, { scripts: ['Spin'] });
  assert.equal(ok.outcome, 'ok');
});

test('summaries read only the summarized column when it is stored', async () => {
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const field = (name: string) => table.fields.find((f) => f.name === name)!;
  assert.deepEqual(summaryColumns(table, [field('Total')]), ['Amount']);
  // A summary of an unstored calculation needs the whole record.
  assert.equal(summaryColumns(table, [field('Total'), field('Total Double')]), undefined);
  const ids = store.findIds('Orders');
  const r = await runScript(store, script('Exit Script [ Text Result: Orders::Total & "/" & Orders::Total Double ]'), { layout: 'Orders', foundSet: ids });
  assert.equal(r.result, '1275/2550');
  // The store's own summaries (a record as the Data API reads it) agree.
  assert.equal(store.get('Orders', ids[0]).fieldData.Total, 1275);
  assert.equal(store.get('Orders', ids[0]).fieldData['Total Double'], 2550);
});

test('a skipped script is skipped wherever it is called from: Perform Script, on the server, a callback', async () => {
  const notes = () => store.findIds('Orders').map((id) => store.get('Orders', id, 'iso', undefined, undefined, { fields: ['Notes'] }).fieldData.Notes);
  const before = notes();
  const results = await testScripts(store, { scripts: ['Convert', 'Convert on server', 'Convert with callback', 'Upload to Amazon Orders'], skip: ['upload to amazon*'] });
  assert.deepEqual(results.map((r) => r.script), ['Convert', 'Convert on server', 'Convert with callback']);
  for (const r of results) assert.deepEqual(r.skipped, ['Upload to Amazon Orders'], JSON.stringify(r));
  const direct = await runScript(store, 'Convert', { layout: 'Orders', skip: (n) => n.startsWith('Upload') });
  assert.equal(direct.result, '3/');
  const server = await runScript(store, 'Convert on server', { layout: 'Orders', skip: (n) => n.startsWith('Upload') });
  assert.equal(server.result, '3/');
  assert.deepEqual(notes(), before);
  // Without --skip it does run (and its change is undone by test-scripts).
  const [ran] = await testScripts(store, { scripts: ['Convert'] });
  assert.equal(ran.skipped, undefined);
});

test('a step reading more records than the read cache keeps still gives every value (export, sort)', async () => {
  const documents = mkdtempSync(join(tmpdir(), 'tabularius-memory-docs-'));
  try {
    const ids = store.findIds('Lines');
    const r = await runScript(store, script('Sort Records [ Restore ; With dialog: Off ; Lines::Label ; descending ]\nExport Records [ With dialog: Off ; "out.csv" ; Unicode (UTF-8) ]\nExit Script [ Text Result: Get ( LastError ) ]'),
      { layout: 'Lines', foundSet: ids, documents });
    assert.equal(r.result, '0');
    const lines = readFileSync(join(documents, 'out.csv'), 'utf8').trimEnd().split('\r\n');
    assert.equal(lines.length, 2500);
    assert.equal(lines[0], '"999","line 999"');
    assert.equal(lines[2499], '"1","line 1"');
  } finally {
    rmSync(documents, { recursive: true, force: true });
  }
});

test('a script stopped at the step limit says which record it was on, to tell a long batch from a stuck loop', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Walk', text: 'Go to Layout [ “Orders” ]\nLoop\nGo to Record/Request/Page [ Next ; Exit after last: On ]\nEnd Loop' }]);
  const [r] = await testScripts(store, { scripts: ['Walk'], maxSteps: 60 });
  assert.equal(r.outcome, 'stalled');
  assert.match(r.message ?? '', /^step limit reached \(on record (\d+) of 50 on layout "Orders"\) in the loop at line 2, \d+ times round; still moving through the records, about 2 steps each, so the (\d+) left need about \d+ more steps: a long batch, not a loop going nowhere after 61 steps$/);
  const at = Number(/record (\d+)/.exec(r.message!)![1]);
  assert.ok(at > 20);
  assert.equal(Number(/the (\d+) left/.exec(r.message!)![1]), 50 - at);
  // A loop that stays on one record says nothing about pace.
  store.applyDesign([{ op: 'createScript', name: 'Stay', text: 'Go to Layout [ “Orders” ]\nLoop\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' }]);
  const [stuck] = await testScripts(store, { scripts: ['Stay'], maxSteps: 60 });
  assert.doesNotMatch(stuck.message ?? '', /still moving|long batch/);
});
