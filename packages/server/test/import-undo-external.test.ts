import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { Host, STORE_EXT } from '../src/host.ts';
import { applyImport, undoImport } from '../src/import-mapping.ts';

const DESIGN = [{ op: 'createTable', name: 'PrivateTable', fields: [{ name: 'Name' }] }] as never;

function openWith(dir: string): Host {
  return new Host(dir, () => {}, { background: false });
}

function importThroughExternalLayout(host: Host): { main: Store; other: Store; id: string } {
  const main = host.create('Main');
  const other = host.create('Other');
  other.applyDesign(DESIGN);
  main.applyDesign([
    { op: 'createDataSource', name: 'OtherFile', paths: ['file:Other'] },
    { op: 'createOccurrence', name: 'ExternalTable', file: 'OtherFile', externalTable: other.schema.tables[0].id },
    { op: 'createLayout', name: 'ExternalLayout', occurrence: 'ExternalTable' },
  ]);
  const result = applyImport(main, 'ExternalLayout', [['Name'], ['one']], { headerRow: true, columns: [{ column: 0, field: 'Name' }], keys: [] }, {});
  assert.equal(result.imported, 1);
  return { main, other, id: result.id };
}

test('undoing an import through an external layout deletes the rows in the file they went into', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-undo-'));
  const host = openWith(dir);
  try {
    const { main, other, id } = importThroughExternalLayout(host);
    assert.equal(other.findIds('PrivateTable').length, 1);
    assert.deepEqual(undoImport(main, id, {}), { deleted: 1, kept: [] });
    assert.deepEqual(other.findIds('PrivateTable'), []);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an import through an external layout is not undone in a different file that took the first one\'s name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-undo-'));
  let host = openWith(dir);
  let id: string;
  try {
    ({ id } = importThroughExternalLayout(host));
    const first = host.get('Other')!;
    const [recordId] = first.findIds('PrivateTable');
    const modId = (first.sql.prepare('SELECT _fm_mod_id AS m FROM PrivateTable WHERE _fm_record_id = ?').get(recordId) as { m: number }).m;
    await host.close();
    // Another file of the same name, with the same table id, holding an unrelated record under the same record id and modification id.
    const path = join(dir, `Other${STORE_EXT}`);
    rmSync(path, { force: true });
    createStore(path);
    const replacement = new Store(path, 'Other');
    replacement.applyDesign(DESIGN);
    replacement.create('PrivateTable', { Name: 'unrelated' });
    assert.equal(replacement.findIds('PrivateTable')[0], recordId);
    assert.equal((replacement.sql.prepare('SELECT _fm_mod_id AS m FROM PrivateTable').get() as { m: number }).m, modId);
    replacement.close();
    host = openWith(dir);
    assert.throws(() => undoImport(host.get('Main')!, id, {}), /has been replaced/);
    assert.equal(host.get('Other')!.findIds('PrivateTable').length, 1);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an import recorded through an external layout before files were identified is not undone from there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-undo-'));
  const host = openWith(dir);
  try {
    const { main, other, id } = importThroughExternalLayout(host);
    main.sql.prepare('UPDATE _fm_imports SET owner_id = NULL, owner_name = NULL, table_id = NULL WHERE id = ?').run(id);
    assert.throws(() => undoImport(main, id, {}), /cannot be undone from here/);
    assert.equal(other.findIds('PrivateTable').length, 1);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [what, column, value] of [['table name', 'tbl', 'SomethingElse'], ['file name', 'owner_name', 'SomeOtherFile'], ['table id', 'table_id', 987654]] as const) {
  test(`an import is not undone when the layout no longer points to the recorded ${what}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-undo-'));
    const host = openWith(dir);
    try {
      const { main, other, id } = importThroughExternalLayout(host);
      main.sql.prepare(`UPDATE _fm_imports SET ${column} = ? WHERE id = ?`).run(value, id);
      assert.throws(() => undoImport(main, id, {}), /no longer points to the original table/);
      assert.equal(other.findIds('PrivateTable').length, 1);
    } finally {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
