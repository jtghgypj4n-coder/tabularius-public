import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createStore, endTransaction, Store, writer, type Transaction } from '../src/index.ts';

function shop(t: TestContext): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-record-atomic-'));
  const path = join(dir, 'Records.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('AR-store-core-02 cascade and audit failures leave records and notifications intact', (t) => {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key', type: 'number' }, { name: 'Name' }, { name: 'File', type: 'container' }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Key', type: 'number' }, { name: 'Name' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'Key' }], rightDelete: true },
  ] as never);
  const p = s.create('Parents', { Key: 1, Name: 'old' }).recordId;
  const c1 = s.create('Children', { Key: 1, Name: 'one' }).recordId;
  const c2 = s.create('Children', { Key: 1, Name: 'two' }).recordId;
  const created = s.auditLog({ table: 'Parents', recordId: p })[0].seq;
  const heard: string[] = [];
  s.listeners.add((c) => heard.push(c.kind));
  s.sql.exec(`CREATE TRIGGER reject_child BEFORE DELETE ON Children WHEN OLD._fm_record_id = ${c2} BEGIN SELECT RAISE(ABORT, 'child unavailable'); END`);
  assert.throws(() => s.delete('Parents', p), /child unavailable/);
  assert.equal(s.get('Parents', p).fieldData.Name, 'old');
  assert.equal(s.get('Children', c1).fieldData.Name, 'one');
  assert.equal(s.get('Children', c2).fieldData.Name, 'two');
  assert.deepEqual(heard, []);
  s.sql.exec('DROP TRIGGER reject_child');

  s.sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON _fm_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
  assert.throws(() => s.delete('Parents', p, { cascade: false }), /audit unavailable/);
  assert.equal(s.get('Parents', p).fieldData.Name, 'old');
  assert.throws(() => s.setContainer('Parents', p, 'File', 1, { filename: 'test.txt', mime: 'text/plain', data: Buffer.from('data') }), /audit unavailable/);
  assert.equal(s.get('Parents', p).fieldData.File, '');
  assert.deepEqual(heard, []);
  s.sql.exec('DROP TRIGGER reject_audit');
  s.update('Parents', p, { Name: 'new' });
  heard.length = 0;
  s.sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON _fm_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
  assert.throws(() => s.restoreRecord('Parents', p, created), /audit unavailable/);
  assert.equal(s.get('Parents', p).fieldData.Name, 'new');
  assert.deepEqual(heard, []);
});

test('AR-store-core-04 stale parent rejects mixed and related-only edits', (t) => {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Key', type: 'number' }, { name: 'Name' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'Key' }] },
  ] as never);
  const parent = s.create('Parents', { Key: 1, Name: 'old' });
  const child = s.create('Children', { Key: 1, Name: 'old' });
  for (const data of [{ Name: 'bad', 'Children::Name': 'new' }, { 'Children::Name': 'new' }] as Record<string, string>[]) {
    assert.throws(() => s.update('Parents', parent.recordId, data, parent.modId + 99), (e: unknown) => (e as { code?: number }).code === 306);
    assert.equal(s.get('Parents', parent.recordId).fieldData.Name, 'old');
    assert.equal(s.get('Children', child.recordId).fieldData.Name, 'old');
  }
  assert.ok(s.locks.acquire('Parents', parent.recordId, 'other-session', 'Bob').ok);
  assert.throws(() => s.update('Parents', parent.recordId, { 'Children::Name': 'new' }, parent.modId), (e: unknown) => (e as { code?: number }).code === 301);
  assert.equal(s.get('Children', child.recordId).fieldData.Name, 'old');
  s.locks.release('Parents', parent.recordId, 'other-session');
  s.sql.exec("CREATE TRIGGER reject_parent_audit BEFORE INSERT ON _fm_audit WHEN NEW.tbl = 'Parents' BEGIN SELECT RAISE(ABORT, 'parent audit unavailable'); END");
  assert.throws(() => s.update('Parents', parent.recordId, { Name: 'bad', 'Children::Name': 'new' }, parent.modId), /parent audit unavailable/);
  assert.equal(s.get('Children', child.recordId).fieldData.Name, 'old');
  s.sql.exec('DROP TRIGGER reject_parent_audit');
  assert.equal(s.update('Parents', parent.recordId, { 'Children::Name': 'new' }, parent.modId).modId, parent.modId);
  assert.equal(s.get('Parents', parent.recordId).modId, parent.modId);
  assert.equal(s.get('Children', child.recordId).fieldData.Name, 'new');
});

test('AR-store-core-02 failed external container publication removes its file', (t) => {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
  ] as never);
  const id = s.create('Items', {}).recordId;
  s.sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON _fm_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
  assert.throws(() => s.setContainer('Items', id, 'Doc', 1, { filename: 'failed.txt', mime: 'text/plain', data: Buffer.from('data') }), /audit unavailable/);
  assert.equal(s.containerId('Items', id, 'Doc'), undefined);
  assert.equal(existsSync(join(s.externalRoots[0], 'Items', 'Docs', 'failed.txt')), false);
});

function twoFiles(t: TestContext, cascade: boolean): { parent: Store; child: Store; p: number; c: number } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cross-file-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  const parent = open('Parent'), child = open('Child');
  t.after(() => { parent.close(); child.close(); rmSync(dir, { recursive: true, force: true }); });
  parent.resolveFile = (name) => name === 'Child' ? child : undefined;
  child.applyDesign([{ op: 'createTable', name: 'Children', fields: [{ name: 'Key', type: 'number' }, { name: 'Name' }] }]);
  parent.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key', type: 'number' }] },
    { op: 'createDataSource', name: 'Child', paths: ['file:Child'] },
    { op: 'createOccurrence', name: 'Children', file: 'Child', externalTable: child.schema.tables[0].id },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: child.schema.tables[0].fields[0].id }], ...(cascade ? { rightDelete: true } : {}) },
  ] as never);
  const p = parent.create('Parents', { Key: 1 }).recordId;
  const c = child.create('Children', { Key: 1, Name: 'old' }).recordId;
  return { parent, child, p, c };
}

test('a related write into another file still goes through that file', (t) => {
  const { parent, child, p, c } = twoFiles(t, false);
  const mod = parent.get('Parents', p).modId;
  parent.update('Parents', p, { 'Children::Name': 'new' }, mod);
  assert.equal(child.get('Children', c).fieldData.Name, 'new');
});

test('a cascade delete into another file still deletes there', (t) => {
  const { parent, child, p, c } = twoFiles(t, true);
  parent.delete('Parents', p);
  assert.equal(parent.recordCount('Parents'), 0);
  assert.equal(child.recordCount('Children'), 0);
  assert.throws(() => child.get('Children', c));
});

test('AR-store-core-02 notifications wait for the enclosing transaction', (t) => {
  const s = shop(t);
  s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  const id = s.create('Items', { Name: 'old' }).recordId;
  const heard: { kind: string; account?: string }[] = [];
  s.listeners.add((change) => heard.push({ kind: change.kind, account: change.account }));
  const rolled: Transaction = { files: new Map() };
  writer.run({ account: 'Alice', transaction: { open: rolled } }, () => s.delete('Items', id));
  assert.deepEqual(heard, []);
  endTransaction(rolled, false);
  assert.deepEqual(heard, []);
  assert.equal(s.get('Items', id).fieldData.Name, 'old');
  const kept: Transaction = { files: new Map() };
  writer.run({ account: 'Alice', transaction: { open: kept } }, () => s.delete('Items', id));
  assert.deepEqual(heard, []);
  endTransaction(kept, true);
  assert.deepEqual(heard, [{ kind: 'delete', account: 'Alice' }]);
});

test('AR-store-core-02 interrupted external write is recovered on open', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-container-recover-'));
  const path = join(dir, 'Media.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createStore(path);
  const initial = new Store(path, 'Media');
  initial.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
  ] as never);
  const id = initial.create('Items', {}).recordId;
  const target = join(initial.externalRoots[0], 'Items', 'Docs', 'interrupted.txt');
  initial.close();
  const module = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.ts')).href;
  const crashModule = pathToFileURL(join(import.meta.dirname, '..', 'src', 'crash-point.ts')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { Store } = await import(process.env.STORE_MODULE);
    const { armCrashPointForTest } = await import(process.env.CRASH_MODULE);
    const store = new Store(process.env.STORE_PATH, 'Media');
    armCrashPointForTest('record-container:after-external-write');
    store.setContainer('Items', Number(process.env.RECORD_ID), 'Doc', 1,
      { filename: 'interrupted.txt', mime: 'text/plain', data: Buffer.from('data') });
  `], { env: { ...process.env, STORE_MODULE: module, CRASH_MODULE: crashModule, STORE_PATH: path, RECORD_ID: String(id) }, timeout: 5000 });
  assert.equal(child.status, 73, child.stderr.toString());
  assert.equal(existsSync(target), true);
  const recovered = new Store(path, 'Media');
  t.after(() => recovered.close());
  assert.equal(existsSync(target), false);
  assert.equal(recovered.containerId('Items', id, 'Doc'), undefined);
  assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith('.openhbam-container-pending-')), []);
});

test('a cascade that fails under a held transaction reports no audit row that was rolled back', (t) => {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key', type: 'number' }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Key', type: 'number' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'Key' }], rightDelete: true },
  ] as never);
  const p = s.create('Parents', { Key: 1 }).recordId;
  s.create('Children', { Key: 1 });
  const second = s.create('Children', { Key: 1 }).recordId;
  s.sql.exec(`CREATE TRIGGER reject_second BEFORE INSERT ON _fm_audit WHEN NEW.tbl = 'Children' AND NEW.record_id = ${second} BEGIN SELECT RAISE(ABORT, 'second audit unavailable'); END`);
  const seqs: number[] = [];
  const tx: Transaction = { files: new Map() };
  writer.run({ account: 'Alice', onAudit: (_file, seq) => seqs.push(seq), transaction: { open: tx } }, () => {
    assert.throws(() => s.delete('Parents', p), /second audit unavailable/);
  });
  endTransaction(tx, true);
  for (const seq of seqs) assert.ok(s.sql.prepare('SELECT 1 FROM _fm_audit WHERE seq = ?').get(seq), `audit ${seq} was reported but does not exist`);
  assert.equal(s.recordCount('Children'), 2);
});

test('truncate, restoring a deleted row and setting stored calculations are audited in the same write', (t) => {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createField', table: 'Items', name: 'Twice', kind: 'calculation', type: 'text', calculation: 'Name & Name' },
  ] as never);
  const id = s.create('Items', { Name: 'a' }).recordId;
  s.create('Items', { Name: 'b' });
  s.sql.exec("CREATE TRIGGER reject_truncate BEFORE INSERT ON _fm_audit WHEN NEW.kind = 'truncate' BEGIN SELECT RAISE(ABORT, 'truncate audit unavailable'); END");
  assert.throws(() => s.truncate('Items'), /truncate audit unavailable/);
  assert.equal(s.recordCount('Items'), 2);
  s.sql.exec('DROP TRIGGER reject_truncate');
  const row = s.sql.prepare('SELECT * FROM Items WHERE _fm_record_id = ?').get(id) as Record<string, never>;
  s.delete('Items', id);
  s.sql.exec("CREATE TRIGGER reject_create BEFORE INSERT ON _fm_audit WHEN NEW.kind = 'create' BEGIN SELECT RAISE(ABORT, 'create audit unavailable'); END");
  assert.throws(() => s.restoreDeletedRow('Items', row), /create audit unavailable/);
  assert.equal(s.recordCount('Items'), 1);
  s.sql.exec('DROP TRIGGER reject_create');
  const other = (s.sql.prepare('SELECT _fm_record_id AS id FROM Items').get() as { id: number }).id;
  s.sql.exec("CREATE TRIGGER reject_update BEFORE INSERT ON _fm_audit WHEN NEW.kind = 'update' BEGIN SELECT RAISE(ABORT, 'update audit unavailable'); END");
  const before = s.sql.prepare('SELECT Twice FROM Items WHERE _fm_record_id = ?').get(other) as { Twice: string };
  assert.throws(() => s.setStoredCalcValues('Items', 'Twice', [{ recordId: other, value: 'changed', expect: before.Twice }]), /update audit unavailable/);
  assert.deepEqual(s.sql.prepare('SELECT Twice FROM Items WHERE _fm_record_id = ?').get(other), before);
});

test('a bad external container journal marker is skipped when the file opens', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-bad-marker-'));
  const path = join(dir, 'Media.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createStore(path);
  const first = new Store(path, 'Media');
  const prefix = (first as unknown as { externalMarkerPrefix(): string }).externalMarkerPrefix();
  first.close();
  writeFileSync(join(dir, `${prefix}corrupt.json`), '{ not json');
  writeFileSync(join(dir, `${prefix}elsewhere.json`), JSON.stringify({ root: join(dir, 'no-such-root'), rel: 'x.txt' }));
  const warned: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { warned.push(args); });
  const reopened = new Store(path, 'Media');
  t.after(() => reopened.close());
  assert.ok(warned.length >= 2, 'each bad marker is reported');
  assert.equal(readdirSync(dir).filter((name) => name.startsWith(prefix)).length, 2, 'bad markers are left for an operator');
  const count = warned.length;
  const again = new Store(path, 'Media');
  t.after(() => again.close());
  assert.equal(warned.length, count, 'a marker already reported is not reported again on the next open');
});

test('an external container cannot be written inside an unmanaged transaction', (t) => {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
  ] as never);
  const id = s.create('Items', {}).recordId;
  s.sql.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => s.setContainer('Items', id, 'Doc', 1, { filename: 'x.txt', mime: 'text/plain', data: Buffer.from('x') }), /managed transaction/);
  } finally { s.sql.exec('ROLLBACK'); }
  assert.equal(existsSync(join(s.externalRoots[0], 'Items', 'Docs', 'x.txt')), false);
});

test('a quiet transaction publishes nothing when it ends', (t) => {
  const s = shop(t);
  s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  const id = s.create('Items', { Name: 'old' }).recordId;
  const heard: string[] = [];
  s.listeners.add((change) => heard.push(change.kind));
  const tx: Transaction = { files: new Map(), quiet: true };
  writer.run({ account: 'Alice', transaction: { open: tx } }, () => s.update('Items', id, { Name: 'new' }));
  endTransaction(tx, true);
  assert.deepEqual(heard, []);
});

test('a deleted record stays locked until the enclosing transaction commits', (t) => {
  const s = shop(t);
  s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  const id = s.create('Items', { Name: 'old' }).recordId;
  assert.ok(s.locks.acquire('Items', id, 'owner-1', 'Alice').ok);
  const rolled: Transaction = { files: new Map() };
  writer.run({ owner: 'owner-1', account: 'Alice', transaction: { open: rolled } }, () => s.delete('Items', id));
  assert.ok(s.locks.holder('Items', id), 'lock is kept while the delete is only pending');
  endTransaction(rolled, false);
  assert.ok(s.locks.holder('Items', id), 'a rolled back delete keeps the lock');
  const kept: Transaction = { files: new Map() };
  writer.run({ owner: 'owner-1', account: 'Alice', transaction: { open: kept } }, () => s.delete('Items', id));
  endTransaction(kept, true);
  assert.equal(s.locks.holder('Items', id), undefined);
});

test('a related-only edit does not need edit access to the parent record', (t) => {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Key', type: 'number' }, { name: 'Name' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'Key' }] },
  ] as never);
  const parent = s.create('Parents', { Key: 1, Name: 'old' });
  const child = s.create('Children', { Key: 1, Name: 'old' });
  s.savePrivilegeSet({ name: 'ChildrenEditor', records: { view: true, edit: false, create: false, delete: false },
    tables: { Children: { view: true, edit: true, create: false, delete: false } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
  s.setPassword('editor', 'password1234', 'ChildrenEditor');
  const privileges = s.privileges('editor');
  s.update('Parents', parent.recordId, { 'Children::Name': 'new' }, undefined, { privileges });
  assert.equal(s.get('Children', child.recordId).fieldData.Name, 'new');
  assert.throws(() => s.update('Parents', parent.recordId, { Name: 'changed' }, undefined, { privileges }), (e: unknown) => (e as { code?: number }).code === 200);
  assert.equal(s.get('Parents', parent.recordId).fieldData.Name, 'old');
});

function externalItems(t: TestContext): { s: Store; id: number; pending: () => string[]; file: string } {
  const s = shop(t);
  s.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
  ] as never);
  const id = s.create('Items', {}).recordId;
  const prefix = (s as unknown as { externalMarkerPrefix(): string }).externalMarkerPrefix();
  return { s, id, pending: () => readdirSync(dirname(s.path)).filter((n) => n.startsWith(prefix)), file: join(s.externalRoots[0], 'Items', 'Docs', 'held.txt') };
}

test('an external container written in a held transaction is removed if it rolls back', (t) => {
  const { s, id, pending, file } = externalItems(t);
  const tx: Transaction = { files: new Map() };
  writer.run({ account: 'Alice', transaction: { open: tx } }, () => s.setContainer('Items', id, 'Doc', 1, { filename: 'held.txt', mime: 'text/plain', data: Buffer.from('data') }));
  assert.equal(existsSync(file), true, 'on disk while the transaction is open');
  assert.equal(pending().length, 1, 'with its journal marker');
  endTransaction(tx, false);
  assert.equal(existsSync(file), false);
  assert.deepEqual(pending(), []);
});

test('an external container written in a held transaction keeps its marker until the commit', (t) => {
  const { s, id, pending, file } = externalItems(t);
  const tx: Transaction = { files: new Map() };
  writer.run({ account: 'Alice', transaction: { open: tx } }, () => s.setContainer('Items', id, 'Doc', 1, { filename: 'held.txt', mime: 'text/plain', data: Buffer.from('data') }));
  assert.equal(pending().length, 1, 'the marker is not removed before the transaction ends');
  endTransaction(tx, true);
  assert.equal(existsSync(file), true);
  assert.deepEqual(pending(), []);
  assert.ok(s.containerId('Items', id, 'Doc'));
});

test('an external container file is only written inside a store write', (t) => {
  const { s, id } = externalItems(t);
  const write = (s as unknown as { writeExternalFile(info: unknown, id: number, field: string, file: unknown): unknown }).writeExternalFile.bind(s);
  assert.throws(() => write(s.layout('Items'), id, 'Doc', { filename: 'loose.txt', mime: 'text/plain', data: Buffer.from('x') }), /needs a transaction/);
});
