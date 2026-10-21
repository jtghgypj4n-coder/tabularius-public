import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import * as trace from '../../store/src/trace.ts';
import { applyImport, applyImportAddStream, importMappedRows, undoImport } from '../src/import-mapping.ts';

test('mapped import yields after 500 rows, reports progress and keeps a consistent partial result on Stop', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-bulk-import-'));
  const path = join(dir, 'Import.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_COUNT_SQL = '1';
  const store = new Store(path, 'Import');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    const controller = new AbortController();
    let parsed = 0;
    function* rows() {
      for (let i = 0; i < 1500; i++) { parsed++; yield [`Synthetic ${i}`]; }
    }
    const before = { statements: trace.statements, rows: trace.rowsWritten, rss: process.memoryUsage().rss };
    const progress: number[] = [];
    const result = await importMappedRows(store, 'Items', rows(), ['Name'], { signal: controller.signal, onProgress: (n) => {
      progress.push(n);
      if (n === 500) controller.abort();
    } });
    assert.equal(result.stopped, true);
    assert.equal(result.imported, 500);
    assert.equal(result.skipped, 0);
    assert.equal(result.foundSet.length, 500);
    assert.deepEqual(progress, [500]);
    assert.equal(parsed, 500, 'the parser did not consume the rest after Stop');
    assert.equal((store.sql.prepare('SELECT count(*) AS n FROM Items').get() as { n: number }).n, 500);
    const used = { statements: trace.statements - before.statements, rowsWritten: trace.rowsWritten - before.rows,
      rss: Math.max(0, process.memoryUsage().rss - before.rss) };
    assert.ok(used.statements < 30_000, JSON.stringify(used));
    assert.ok(used.rowsWritten < 10_000, JSON.stringify(used));
    assert.ok(used.rss < 192 * 1024 * 1024, JSON.stringify(used));
    t.diagnostic(JSON.stringify(used));
  } finally {
    store.close();
    delete process.env.TABULARIUS_COUNT_SQL;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('20,000 generated rows import within measured RSS, SQL and WAL budgets', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-bulk-import-scale-'));
  const path = join(dir, 'Scale.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_COUNT_SQL = '1';
  const store = new Store(path, 'Scale');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    store.checkpoint();
    const wal = () => existsSync(path + '-wal') ? statSync(path + '-wal').size : 0;
    const before = { statements: trace.statements, rows: trace.rowsWritten, rss: process.memoryUsage().rss, wal: wal() };
    let progress = 0;
    function* rows() { for (let i = 0; i < 20_000; i++) yield [`Synthetic ${i}`]; }
    const result = await importMappedRows(store, 'Items', rows(), ['Name'], { onProgress: (n) => { progress = n; } });
    assert.equal(result.imported, 20_000);
    assert.equal(result.skipped, 0);
    assert.equal(progress, 20_000);
    assert.equal((store.sql.prepare('SELECT count(*) AS n FROM Items').get() as { n: number }).n, 20_000);
    const used = { statements: trace.statements - before.statements, rowsWritten: trace.rowsWritten - before.rows,
      rss: Math.max(0, process.memoryUsage().rss - before.rss), walGrowth: Math.max(0, wal() - before.wal) };
    assert.ok(used.statements < 300_000, JSON.stringify(used));
    assert.ok(used.rowsWritten < 150_000, JSON.stringify(used));
    assert.ok(used.rss < 256 * 1024 * 1024, JSON.stringify(used));
    assert.ok(used.walGrowth < 32 * 1024 * 1024, JSON.stringify(used));
    t.diagnostic(JSON.stringify(used));
  } finally {
    store.close();
    delete process.env.TABULARIUS_COUNT_SQL;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streamed planned Add keeps transforms, duplicate decisions and Undo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-bulk-plan-'));
  const path = join(dir, 'Plan.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Plan');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Old', fields: [{ name: 'Name' }, { name: 'Score', type: 'number' }] },
      { op: 'createTable', name: 'New', fields: [{ name: 'Name' }, { name: 'Score', type: 'number' }] },
    ]);
    const rows = [['Name', 'Score'], [' Ada ', '1'], ['Ada', '2'], [' Bob ', '3']];
    const plan = { headerRow: true, columns: [{ column: 0, field: 'Name', transforms: ['trim'] }, { column: 1, field: 'Score', transforms: ['number'] }], keys: ['Name'] };
    const old = applyImport(store, 'Old', rows, plan, { skipDuplicates: true });
    const streamed = await applyImportAddStream(store, 'New', rows, plan, { skipDuplicates: true });
    assert.equal(streamed.imported, old.imported);
    assert.deepEqual(streamed.skipped, old.skipped);
    assert.deepEqual((store.sql.prepare('SELECT Name, Score FROM New ORDER BY _fm_record_id').all() as { Name: string; Score: number }[])
      .map((r) => [r.Name, r.Score]), [['Ada', 1], ['Bob', 3]]);
    assert.equal(undoImport(store, streamed.id, {}).deleted, 2);
    assert.equal((store.sql.prepare('SELECT count(*) AS n FROM New').get() as { n: number }).n, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stopped planned Add journals exactly the committed prefix for Undo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-bulk-plan-stop-'));
  const path = join(dir, 'Plan.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Plan');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    const controller = new AbortController();
    let parsed = 0;
    function* rows() { for (let i = 0; i < 1200; i++) { parsed++; yield [`Synthetic ${i}`]; } }
    const result = await applyImportAddStream(store, 'Items', rows(), { headerRow: false, columns: [{ column: 0, field: 'Name' }] },
      { signal: controller.signal, onProgress: (n) => { if (n === 500) controller.abort(); } });
    assert.equal(result.stopped, true);
    assert.equal(result.imported, 500);
    assert.equal(parsed, 500);
    assert.equal(undoImport(store, result.id, {}).deleted, 500);
    assert.equal((store.sql.prepare('SELECT count(*) AS n FROM Items').get() as { n: number }).n, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
