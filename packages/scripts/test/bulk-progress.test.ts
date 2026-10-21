import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import * as trace from '../../store/src/trace.ts';
import { runScript } from '../src/index.ts';

const ROWS = 1024;
let dir: string;
let store: Store;
let ids: number[];

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-bulk-progress-'));
  const path = join(dir, 'Bulk.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_COUNT_SQL = '1';
  store = new Store(path, 'Bulk');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  store.sql.exec('BEGIN');
  const insert = store.sql.prepare('INSERT INTO Items (Name) VALUES (?)');
  for (let i = 0; i < ROWS; i++) insert.run('old');
  store.sql.exec('COMMIT');
  ids = store.findIds('Items');
  assert.equal(ids.length, ROWS);
});

after(() => {
  store?.close();
  delete process.env.TABULARIUS_COUNT_SQL;
  rmSync(dir, { recursive: true, force: true });
});

const changed = (value: string) => Number((store.sql.prepare('SELECT count(*) AS n FROM Items WHERE Name = ?').get(value) as { n: number }).n);
const reset = () => store.sql.prepare('UPDATE Items SET Name = ?').run('old');

async function stopAt256(source: string, operation: string) {
  const userStop = new EventTarget();
  const events: { operation: string; completed: number; total: number }[] = [];
  const statements = trace.statements, written = trace.rowsWritten, rss = process.memoryUsage().rss;
  const script: Script = { id: 9999, name: 'bulk test', steps: parseScriptText(source, store.schema).map((s) => ({
    stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params,
  })) };
  const result = await runScript(store, script, { layout: 'Items', foundSet: ids, userStop, onProgress: (event) => {
    events.push(event);
    if (event.operation === operation && event.completed === 256) userStop.dispatchEvent(new Event('stop'));
  } });
  assert.ok(result.actions.some((a) => a.step === 'Halt Script' && (a as { reason?: string }).reason === 'canceled by the user'));
  assert.deepEqual(events.filter((e) => e.operation === operation).map((e) => e.completed), [0, 256]);
  const used = { statements: trace.statements - statements, rowsWritten: trace.rowsWritten - written, rss: Math.max(0, process.memoryUsage().rss - rss) };
  assert.ok(used.statements < 50_000, JSON.stringify(used));
  assert.ok(used.rowsWritten < 10_000, JSON.stringify(used));
  assert.ok(used.rss < 192 * 1024 * 1024, JSON.stringify(used));
  return used;
}

test('Replace Field Contents reports progress and a stopped run leaves whole committed records', async (t) => {
  reset();
  const used = await stopAt256('Replace Field Contents [ With dialog: Off ; Items::Name ; "new" ]', 'Replace Field Contents');
  assert.equal(changed('new'), 256);
  t.diagnostic(JSON.stringify(used));
});

test('Replace All yields so Stop can interrupt it after committed records', async (t) => {
  reset();
  const used = await stopAt256('Perform Find/Replace [ With dialog: Off ; "old" ; "new" ; Replace All ; Within: All fields ]', 'Replace All');
  assert.equal(changed('new'), 256);
  t.diagnostic(JSON.stringify(used));
});

test('Delete All Records reports partial, committed deletion on Stop', async (t) => {
  reset();
  const used = await stopAt256('Delete All Records [ With dialog: Off ]', 'Delete All Records');
  assert.equal(changed('old'), ROWS - 256);
  t.diagnostic(JSON.stringify(used));
});

test('XML export and text import report progress while processing generated rows', async () => {
  const steps = (source: string): Script => ({ id: 9998, name: 'bulk files', steps: parseScriptText(source, store.schema).map((s) => ({
    stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params,
  })) });
  const exportProgress: number[] = [];
  const foundSet = store.findIds('Items');
  const exported = await runScript(store, steps('Export Records [ With dialog: Off ; "out.xml" ; Fields: Items::Name ]'), {
    layout: 'Items', foundSet, documents: dir,
    onProgress: (event) => { if (event.operation === 'Export Records') exportProgress.push(event.completed); },
  });
  assert.equal(exported.error, 0);
  assert.deepEqual(exportProgress, [0, 256, 512, foundSet.length]);

  writeFileSync(join(dir, 'rows.csv'), Array.from({ length: 1024 }, (_, i) => `Generated ${i}\r\n`).join(''));
  const stop = new EventTarget();
  const importedProgress: number[] = [];
  const countBefore = store.findIds('Items').length;
  const imported = await runScript(store, steps('Import Records [ With dialog: Off ; Table: Items ; Source: "rows.csv" ; Add ; Fields: Items::Name ]'), {
    layout: 'Items', foundSet, documents: dir, userStop: stop,
    onProgress: (event) => {
      if (event.operation !== 'Import Records') return;
      importedProgress.push(event.completed);
      if (event.completed === 256) stop.dispatchEvent(new Event('stop'));
    },
  });
  assert.ok(imported.actions.some((a) => a.step === 'Halt Script' && (a as { reason?: string }).reason === 'canceled by the user'));
  assert.deepEqual(importedProgress, [0, 256]);
  assert.equal(store.findIds('Items').length, countBefore + 256);
});

test('Stop during stored and calculated sorting leaves the prior found-set order intact', async () => {
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Computed', type: 'text', kind: 'calculation', calculation: 'Upper ( Name )', options: { unstored: true } }]);
  const foundSet = store.findIds('Items').reverse();
  for (const field of ['Name', 'Computed']) {
    const step = parseScriptText(`Sort Records [ Restore ; Items::${field} ; ascending ; With dialog: Off ]`, store.schema)[0];
    const script: Script = { id: 9997, name: 'sort progress', steps: [{ stepId: step.stepId!, name: scriptStepName(step.stepId!), enabled: true, params: step.params }] };
    const userStop = new EventTarget();
    const progress: number[] = [];
    const result = await runScript(store, script, { layout: 'Items', foundSet, userStop, onProgress: (event) => {
      if (event.operation !== 'Sort Records') return;
      progress.push(event.completed);
      if (event.completed === 256) {
        if (field === 'Name') store.create('Items', { Name: 'while sorting' });
        userStop.dispatchEvent(new Event('stop'));
      }
    } });
    assert.ok(result.actions.some((a) => a.step === 'Halt Script' && (a as { reason?: string }).reason === 'canceled by the user'), field);
    assert.deepEqual(progress, [0, 256], field);
    assert.deepEqual(result.foundSet, foundSet, field);
  }
});
