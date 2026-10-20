import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';

test('unreferenced container rows and external files are retained until explicit purge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-containers-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Pic', type: 'container' }] }] as never);
  source.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
  const recordId = Number(source.create('Items', { Name: 'will be deleted' }).recordId);
  source.setContainer('Items', recordId, 'Pic', 1, { filename: 'private.png', mime: 'image/png', data: Uint8Array.of(1, 2, 3) });
  const containerId = source.containerId('Items', recordId, 'Pic')!;
    const pathOnDisk = source.externalFile('Items/Pic/private.png');
    assert.ok(pathOnDisk && existsSync(pathOnDisk));
    source.delete('Items', recordId);
    // A real row's delete audit entry is an undo source too. Remove that history
    // here to exercise the purge path for a genuinely unreferenced container.
    source.sql.prepare("DELETE FROM _fm_audit WHERE tbl = 'Items'").run();
  try {
    const report = source.orphanContainerReport();
    assert.equal(report.count, 1);
    assert.equal(report.containers[0].id, containerId);
    assert.equal(existsSync(pathOnDisk!), true, 'reporting leaves the external file alone');

    const purged = source.purgeOrphanContainers();
    assert.equal(purged.removed, 1);
    assert.equal(purged.externalFiles, 1);
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(existsSync(pathOnDisk!), false);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const top of ['RC_Data_FMS', 'Files']) {
  test(`purge deletes owned ${top} files when the store is opened through a directory alias`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-alias-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const actual = join(dir, 'actual');
    const alias = join(dir, 'alias');
    mkdirSync(actual);
    symlinkSync(actual, alias);
    const path = join(alias, 'Media.openhbam.sqlite');
    createStore(path);
    const source = new Store(path, 'Media');
    t.after(() => source.close());
    const folder = join(actual, top, 'Media', 'Items');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, 'private.png');
    writeFileSync(file, 'owned file');
    source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (706, 'private.png', 'image/png', 'file', x'', 'Items/private.png')").run();
    assert.equal(source.externalFile('Items/private.png'), realpathSync(file));
    const purged = source.purgeOrphanContainers();
    assert.equal(purged.removed, 1);
    assert.equal(purged.externalFiles, 1);
    assert.equal(existsSync(file), false);
  });
}

for (const kind of ['existing directory link', 'new directory link', 'file link', 'traversal', 'absolute path']) {
  test(`purge refuses a file outside its own folders via ${kind}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-outside-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'Media.openhbam.sqlite');
    createStore(path);
    const root = join(dir, 'RC_Data_FMS', 'Media');
    const outside = join(dir, 'RC_Data_FMS', 'Media-other');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside);
    const file = join(outside, 'keep.txt');
    writeFileSync(file, 'other hosted file');
    let rel = 'linked/keep.txt';
    if (kind === 'existing directory link') symlinkSync(outside, join(root, 'linked'));
    if (kind === 'file link') {
      rel = 'keep.txt';
      symlinkSync(file, join(root, rel));
    }
    if (kind === 'traversal') rel = '../Media-other/keep.txt';
    if (kind === 'absolute path') rel = realpathSync(file);
    const source = new Store(path, 'Media');
    t.after(() => source.close());
    if (kind === 'new directory link') symlinkSync(outside, join(root, 'linked'));
    // Approved mounts remain readable, but that does not grant purge ownership.
    assert.equal(source.externalFile(rel), kind === 'existing directory link' ? realpathSync(file) : undefined);
    source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (707, 'keep.txt', 'text/plain', 'file', x'', ?)").run(rel);
    const purged = source.purgeOrphanContainers();
    assert.equal(purged.removed, 1);
    assert.equal(purged.externalFiles, 0);
    assert.equal(existsSync(file), true);
  });
}

test('purge retains an owned external file still referenced by another container', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-shared-reference-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  t.after(() => source.close());
  source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container', options: { global: true } }] }] as never);
  const folder = join(dir, 'RC_Data_FMS', 'Media');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'shared.png');
  writeFileSync(file, 'shared file');
  const insert = source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (?, 'shared.png', 'image/png', 'file', x'', 'shared.png')");
  insert.run(708);
  insert.run(709);
  source.setGlobalField('Items::Pic', 709);
  const purged = source.purgeOrphanContainers();
  assert.equal(purged.removed, 1);
  assert.equal(purged.externalFiles, 0);
  assert.equal(existsSync(file), true);
  assert.equal(source.containerInfo(708), undefined);
  assert.equal(source.containerInfo(709)?.external?.missing, false);
});

test('a global container reference keeps its file from being purged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-global-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }, { name: 'GlobalPic', type: 'container', options: { global: true } }] }] as never);
    source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (701, 'global.png', 'image/png', 'file', x'0102')").run();
    source.setGlobalField('Items::GlobalPic', 701);
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(source.purgeOrphanContainers().removed, 0);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a container uploaded to a global field column is retained too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-global-column-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'GlobalPic', type: 'container', options: { global: true } }] }] as never);
    const recordId = Number(source.create('Items', {}).recordId);
    source.setContainer('Items', recordId, 'GlobalPic', 1, { filename: 'column.png', mime: 'image/png', data: Uint8Array.of(4, 5) });
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(source.purgeOrphanContainers().removed, 0);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleted field and table data retain container ids for design restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-design-trash-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }] },
      { op: 'createTable', name: 'Other', fields: [{ name: 'Pic', type: 'container' }] },
    ] as never);
    const fieldRecord = Number(source.create('Items', {}).recordId);
    source.setContainer('Items', fieldRecord, 'Pic', 1, { filename: 'field.png', mime: 'image/png', data: Uint8Array.of(6) });
    const fieldId = source.containerId('Items', fieldRecord, 'Pic')!;
    source.applyDesign([{ op: 'deleteField', table: 'Items', field: 'Pic' }] as never);
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(source.purgeOrphanContainers().removed, 0);
    const deletedField = source.deletedDesigns().find((d) => d.kind === 'field')!;
    source.applyDesign([{ op: 'restoreDeleted', deleted: deletedField.id }] as never);
    assert.equal(source.containerId('Items', fieldRecord, 'Pic'), fieldId);

    const tableRecord = Number(source.create('Other', {}).recordId);
    source.setContainer('Other', tableRecord, 'Pic', 1, { filename: 'table.png', mime: 'image/png', data: Uint8Array.of(7) });
    const tableId = source.containerId('Other', tableRecord, 'Pic')!;
    source.applyDesign([{ op: 'deleteTable', table: 'Other' }] as never);
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(source.purgeOrphanContainers().removed, 0);
    const deletedTable = source.deletedDesigns().find((d) => d.kind === 'table')!;
    source.applyDesign([{ op: 'restoreDeleted', deleted: deletedTable.id }] as never);
    assert.equal(source.containerId('Other', tableRecord, 'Pic'), tableId);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit history keeps a deleted row container alive for restoreRecord', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-history-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }] }] as never);
    const recordId = Number(source.create('Items', {}).recordId);
    source.setContainer('Items', recordId, 'Pic', 1, { filename: 'kept.png', mime: 'image/png', data: Uint8Array.of(7, 8) });
    const containerId = source.containerId('Items', recordId, 'Pic')!;
    source.delete('Items', recordId);
    const deleted = source.auditLog({ table: 'Items', recordId }).at(-1)!;
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(source.purgeOrphanContainers().removed, 0);
    assert.equal(source.restoreRecord('Items', recordId, deleted.seq - 1).action, 'created');
    assert.equal(source.containerId('Items', recordId, 'Pic'), containerId);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a duplicate merge undo can restore its saved row after an orphan purge is requested', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-merge-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }] }] as never);
    const recordId = Number(source.create('Items', {}).recordId);
    source.setContainer('Items', recordId, 'Pic', 1, { filename: 'merge.png', mime: 'image/png', data: Uint8Array.of(9) });
    const containerId = source.containerId('Items', recordId, 'Pic')!;
    const row = source.sql.prepare('SELECT * FROM Items WHERE _fm_record_id = ?').get(recordId) as Record<string, string | number | null>;
    source.delete('Items', recordId);
    assert.equal(source.purgeOrphanContainers().removed, 0);
    source.restoreDeletedRow('Items', row);
    assert.equal(source.containerId('Items', recordId, 'Pic'), containerId);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanup and import undo journals keep container pointers until their undo data is discarded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-import-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }] }] as never);
    source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (703, 'import.png', 'image/png', 'file', x'03')").run();
    source.sql.exec('CREATE TABLE _fm_cleanup (undo TEXT NOT NULL)');
    source.sql.prepare('INSERT INTO _fm_cleanup (undo) VALUES (?)').run(JSON.stringify([{ op: 'restore', table: 'Items', row: { _fm_record_id: 9, Pic: 703 } }]));
    source.sql.exec('CREATE TABLE _fm_imports (cleanup TEXT)');
    source.sql.prepare('INSERT INTO _fm_imports (cleanup) VALUES (?)').run('cleanup-batch');
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(source.purgeOrphanContainers().removed, 0);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending changes and calc refresh undo retain container pointers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-undo-stores-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }] }] as never);
    source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (704, 'pending.png', 'image/png', 'file', x'04')").run();
    source.sql.prepare("INSERT INTO _fm_pending (at, agent, kind, layout, tbl, record_id, data, mod_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), 'agent', 'update', 'Items', 'Items', 1, JSON.stringify({ Pic: 704 }), null, 'pending');
    assert.equal(source.orphanContainerReport().count, 0);
    source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (705, 'refresh.png', 'image/png', 'file', x'05')").run();
    source.sql.exec('CREATE TABLE _fm_calc_refresh (id TEXT PRIMARY KEY, at TEXT NOT NULL, account TEXT, summary TEXT NOT NULL, changes INTEGER NOT NULL, undo TEXT NOT NULL, undone TEXT)');
    source.sql.prepare('INSERT INTO _fm_calc_refresh (id, at, summary, changes, undo) VALUES (?, ?, ?, ?, ?)')
      .run('batch', new Date().toISOString(), 'refresh', 1, JSON.stringify([{ table: 'Items', field: 'Pic', recordId: 1, before: 705, after: null }]));
    assert.equal(source.orphanContainerReport().count, 0);
    assert.equal(source.purgeOrphanContainers().removed, 0);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed live field scan aborts the report and purge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-scan-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  try {
    source.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Pic', type: 'container' }] }] as never);
    source.schema!.tables[0]!.fields.push({ ...source.schema!.tables[0]!.fields[0]!, name: 'MissingPic' });
    assert.throws(() => source.orphanContainerReport());
    assert.throws(() => source.purgeOrphanContainers());
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('purging an orphan does not delete a shared-root file another hosted file can use', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-orphan-shared-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  const shared = join(dir, 'RC_Data_FMS', 'Shared', 'same.pdf');
  try {
    mkdirSync(join(dir, 'RC_Data_FMS', 'Shared'), { recursive: true });
    writeFileSync(shared, 'other hosted file');
    source.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (702, 'same.pdf', 'application/pdf', 'file', x'', 'Shared/same.pdf')").run();
    const purged = source.purgeOrphanContainers();
    assert.equal(purged.removed, 1);
    assert.equal(purged.externalFiles, 0);
    assert.equal(existsSync(shared), true);
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a working copy of a store reads container files through the same operator-approved directory links', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-copy-links-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const volume = join(dir, 'volume');
  mkdirSync(volume);
  writeFileSync(join(volume, 'private.png'), 'owned file');
  mkdirSync(join(dir, 'RC_Data_FMS', 'Media'), { recursive: true });
  symlinkSync(volume, join(dir, 'RC_Data_FMS', 'Media', 'Items'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const source = new Store(path, 'Media');
  t.after(() => source.close());
  assert.ok(source.externalFile('Items/private.png'), 'the original reads it');
  mkdirSync(join(dir, 'scratch'));
  await source.backup(join(dir, 'scratch', 'copy.sqlite'));
  const copy = new Store(join(dir, 'scratch', 'copy.sqlite'), 'Media');
  t.after(() => copy.close());
  assert.equal(copy.externalFile('Items/private.png'), undefined, 'a copy knows nothing of the roots until told');
  copy.readContainersLike(source);
  assert.equal(copy.externalFile('Items/private.png'), source.externalFile('Items/private.png'));
});
