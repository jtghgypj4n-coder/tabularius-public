import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, designObjects, designText, importTables, planImportTables, reconvertCheck, Store, type SheetInput } from '../src/index.ts';
import { importDesigns } from '../src/import.ts';

function fresh(t: { after(fn: () => void): void }): { store: Store; path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-io-'));
  const path = join(dir, 'test.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, path, dir };
}

test('AR-store-design-io-01', (t) => {
  const { store } = fresh(t);
  store.applyDesign([{ op: 'createTable', name: 'Existing', fields: [{ name: 'Name' }] }, { op: 'createLayout', name: 'Incoming', occurrence: 'Existing' }]);
  const before = store.schema.layouts.map((l) => [l.id, l.name]);
  const sheet: SheetInput = { name: 'Incoming', rows: [['Name'], ['one']] };
  const create = store.create.bind(store);
  store.create = (() => { throw new Error('write failed'); }) as typeof store.create;
  try { assert.throws(() => importTables(store, [sheet], planImportTables([sheet])), /write failed/); }
  finally { store.create = create; }
  assert.deepEqual(store.schema.layouts.map((l) => [l.id, l.name]), before);
  assert.deepEqual(store.schema.tables.map((x) => x.name), ['Existing']);
  assert.deepEqual(store.schema.tableOccurrences.map((x) => x.name), ['Existing']);
});

test('AR-store-design-io-01 after a record was written', (t) => {
  const { store } = fresh(t);
  store.applyDesign([{ op: 'createTable', name: 'Existing' }, { op: 'createLayout', name: 'Incoming', occurrence: 'Existing' }]);
  const before = store.schema.layouts.map((l) => [l.id, l.name]);
  const sheet: SheetInput = { name: 'Incoming', rows: [['Name'], ['one'], ['two']] };
  const create = store.create.bind(store);
  let writes = 0;
  store.create = ((...args: Parameters<typeof store.create>) => {
    if (++writes === 2) throw new Error('write failed');
    return create(...args);
  }) as typeof store.create;
  try { assert.throws(() => importTables(store, [sheet], planImportTables([sheet])), /write failed/); }
  finally { store.create = create; }
  assert.deepEqual(store.schema.layouts.map((l) => [l.id, l.name]), before);
  assert.deepEqual(store.schema.tables.map((x) => x.name), ['Existing']);
});

test('AR-store-design-io-01 imports through a disambiguated layout', (t) => {
  const { store } = fresh(t);
  store.applyDesign([{ op: 'createTable', name: 'Existing' }, { op: 'createLayout', name: 'Incoming', occurrence: 'Existing' }]);
  const originalId = store.schema.layouts.find((x) => x.name === 'Incoming')!.id;
  const sheet: SheetInput = { name: 'Incoming', rows: [['Name'], ['one']] };
  assert.equal(importTables(store, [sheet], planImportTables([sheet])).rows, 1);
  assert.equal(store.schema.layouts.find((x) => x.name === 'Incoming')!.id, originalId);
  assert.deepEqual(store.select('SELECT "Name" FROM "Incoming"').rows, [['one']]);
});

test('AR-store-design-io-02', (t) => {
  const { store, path } = fresh(t);
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Old', type: 'number' }, { name: 'Amount', type: 'number' }] }]);
  store.applyDesign([{ op: 'updateField', table: 'T', field: 'Old', name: 'New', kind: 'summary', summary: { type: 'total', field: 'Amount' } }]);
  const sql = new DatabaseSync(path);
  t.after(() => sql.close());
  sql.exec("DELETE FROM _fm_design_log WHERE op NOT LIKE '%\"updateField\"%'");
  const source = structuredClone(store.schema);
  source.tables[0].fields = source.tables[0].fields.filter((f) => f.name !== 'Amount');
  source.tables[0].fields.find((f) => f.name === 'New')!.name = 'Old';
  source.tables[0].fields.find((f) => f.name === 'Old')!.kind = 'normal';
  delete source.tables[0].fields.find((f) => f.name === 'Old')!.summary;
  const before = (sql.prepare("SELECT json FROM _fm_meta WHERE key = 'schema'").get() as { json: string }).json;
  const messages: string[] = [];
  assert.throws(() => importDesigns(sql, { schema: source, file: { chunks: () => [] } } as never, (message) => messages.push(message)), /Amount/);
  const saved = (sql.prepare("SELECT json FROM _fm_meta WHERE key = 'schema'").get() as { json: string }).json;
  assert.equal(saved, before);
  assert.equal(messages.length, 1);
});

test('AR-store-design-io-02 write rollback', (t) => {
  const { store, path } = fresh(t);
  const sql = new DatabaseSync(path);
  t.after(() => sql.close());
  const before = (sql.prepare("SELECT json FROM _fm_meta WHERE key = 'schema'").get() as { json: string }).json;
  sql.exec("CREATE TEMP TRIGGER stop_design_write BEFORE UPDATE ON _fm_meta WHEN NEW.key = 'designs' BEGIN SELECT RAISE(ABORT, 'write failed'); END");
  const source = structuredClone(store.schema);
  source.scripts.push({ id: 99, name: 'Fresh', steps: [] });
  assert.throws(() => importDesigns(sql, { schema: source, file: { chunks: () => [] } } as never), /write failed/);
  assert.equal((sql.prepare("SELECT json FROM _fm_meta WHERE key = 'schema'").get() as { json: string }).json, before);
});

test('AR-store-design-io-03', (t) => {
  const { store } = fresh(t);
  store.applyDesign([{ op: 'createScript', name: 'Caller', steps: [] }, { op: 'createScript', name: 'Target', steps: [] }]);
  store.applyDesign([{ op: 'updateScript', script: 'Caller', text: 'Perform Script [ “Target” ]' }]);
  const target = store.schema.scripts.find((x) => x.name === 'Target')!;
  store.applyDesign([{ op: 'deleteScript', script: 'Target' }, { op: 'createScript', name: 'Unrelated', steps: [] }]);
  assert.notEqual(store.schema.scripts.find((x) => x.name === 'Unrelated')!.id, target.id);
  // A design that names the id (a replayed log, a pasted snippet, a restore) may use one a deleted script held, as logs written
  // before ids were retired do; a live id is refused, so two scripts never share one.
  store.applyDesign([{ op: 'createScript', id: target.id, name: 'Explicit reuse', steps: [] }]);
  assert.equal(store.schema.scripts.find((x) => x.name === 'Explicit reuse')!.id, target.id);
  assert.throws(() => store.applyDesign([{ op: 'createScript', id: target.id, name: 'Twice', steps: [] }]), /already used/);
  store.applyDesign([{ op: 'createTable', name: 'T' }, { op: 'createValueList', name: 'First', values: ['x'] }]);
  const layoutId = store.schema.layouts.find((x) => x.name === 'T')!.id;
  const listId = store.schema.valueLists.find((x) => x.name === 'First')!.id;
  store.applyDesign([{ op: 'deleteLayout', layout: 'T' }, { op: 'deleteValueList', valueList: 'First' }]);
  store.applyDesign([{ op: 'createLayout', name: 'Replacement', occurrence: 'T' }, { op: 'createValueList', name: 'Second', values: ['y'] }]);
  assert.notEqual(store.schema.layouts.find((x) => x.name === 'Replacement')!.id, layoutId);
  assert.notEqual(store.schema.valueLists.find((x) => x.name === 'Second')!.id, listId);
});

test('AR-store-design-io-04', (t) => {
  const { store, path, dir } = fresh(t);
  const source = join(dir, 'source.fmp12');
  writeFileSync(source, 'BBBB');
  utimesSync(source, new Date('2026-09-01'), new Date('2026-09-01'));
  store.sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'source'").run(JSON.stringify({ importedAt: '2026-10-01T00:00:00Z', size: 4, sha256: createHash('sha256').update('AAAA').digest('hex') }));
  assert.match(reconvertCheck(path, source).unsafe ?? '', /changed/);
  writeFileSync(source, 'AAAA');
  utimesSync(source, new Date('2026-09-01'), new Date('2026-09-01'));
  assert.equal(reconvertCheck(path, source).unsafe, undefined);
  writeFileSync(source, 'BBBB');
  utimesSync(source, new Date('2026-09-01'), new Date('2026-09-01'));
  assert.match(reconvertCheck(path, source).unsafe ?? '', /changed/);
});

test('AR-store-design-io-05', () => {
  const child = spawnSync(process.execPath, ['--no-warnings', join(import.meta.dirname, 'design-io-list-worker.ts')], { timeout: 5000, encoding: 'utf8' });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
});

test('AR-store-design-io-06', (t) => {
  const { store } = fresh(t);
  const sheets: SheetInput[] = [
    { name: 'Data', rows: [['Name'], ['First file']] },
    { name: 'Data', rows: [['Name'], ['Second file']] },
  ];
  assert.throws(() => planImportTables(sheets, { links: false }), /duplicate|same name/i);
  const direct = planImportTables([sheets[0], { name: 'Other', rows: sheets[1].rows }], { links: false });
  direct.sheets[1].sheet = 'Data';
  assert.throws(() => importTables(store, sheets, direct), /duplicate|same name/i);
  assert.deepEqual(store.schema.tables, []);
});

test('AR-store-design-io-07', (t) => {
  const { store } = fresh(t);
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Old' }] }]);
  const layout = store.design('T')!;
  const object = layout.objects[0];
  const chart = { id: 999, kind: 'chart', type: 13, external: 'CHRT', anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 300, left: 20, bottom: 540, right: 380 }, style: {}, chart: { type: 'pie', source: 'found-set', categories: 'T::Old', series: [{ data: 'T::Old', name: 'T::Old' }] } };
  store.applyDesign([{ op: 'updateLayout', layout: 'T', design: { objects: [{ ...object, tooltip: 'T::Old', webUrl: 'T::Old', label: 'T::Old', activeSegmentFormula: 'T::Old' }, chart] } as never }]);
  store.applyDesign([{ op: 'updateField', table: 'T', field: 'Old', name: 'New' }]);
  const updated = store.design('T')!.objects[0];
  for (const key of ['tooltip', 'webUrl', 'label', 'activeSegmentFormula'] as const) assert.equal(updated[key], 'T::New', key);
  assert.equal(store.design('T')!.objects.find((x) => x.id === 999)!.chart?.categories, 'T::New');
  assert.equal(store.design('T')!.objects.find((x) => x.id === 999)!.chart?.series[0].data, 'T::New');
  store.applyDesign([{ op: 'deleteField', table: 'T', field: 'New' }]);
  const deleted = store.design('T')!.objects[0];
  for (const key of ['tooltip', 'webUrl', 'label', 'activeSegmentFormula'] as const) assert.match(deleted[key] ?? '', /<Field Missing>/, key);
  assert.match(store.design('T')!.objects.find((x) => x.id === 999)!.chart?.series[0].data ?? '', /<Field Missing>/);
});

test('AR-store-design-io-08', (t) => {
  const { store } = fresh(t);
  store.applyDesign([
    { op: 'createScript', name: 'A/B', steps: [] },
    { op: 'createScript', name: 'A_B (id 3)', steps: [] },
    { op: 'createScript', name: 'A?B', steps: [] },
  ]);
  const source = { schema: store.schema, layouts: store.designs().layouts, accounts: store.accounts(), privilegeSets: store.privilegeSets() };
  const files = [...designText(source)].filter(([path]) => path.startsWith('scripts/'));
  assert.equal(files.length, 3);
  assert.deepEqual(new Set(files.map(([path]) => path.toLowerCase())).size, 3);
  assert.deepEqual([...designObjects(source)].filter(([, x]) => x.kind === 'script').length, 3);
  const nested = structuredClone(source);
  nested.schema.scriptOrder = [
    { kind: 'folder', id: 90, name: 'A_B.txt', depth: 0 },
    { kind: 'item', id: 2, name: 'A_B (id 3)', depth: 1 },
    { kind: 'folder-end', id: 90, name: 'A_B.txt', depth: 0 },
    { kind: 'item', id: 1, name: 'A/B', depth: 0 },
    { kind: 'item', id: 3, name: 'A?B', depth: 0 },
  ];
  const nestedPaths = [...designText(nested).keys()].filter((path) => path.startsWith('scripts/'));
  assert.equal(nestedPaths.length, 3);
  assert.ok(!nestedPaths.some((path) => nestedPaths.some((other) => other !== path && other.toLowerCase().startsWith(path.toLowerCase() + '/'))));
});
