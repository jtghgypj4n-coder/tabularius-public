import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { existingDirectoryLinks, safeExistingPath } from '../../store/src/safe-path.ts';

test('external container reads reject symlinks outside their root', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-path-read-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  new Store(path, 'Media').close();
  const sql = new DatabaseSync(path);
  sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (1, 'secret.txt', 'text/plain', 'file', x'', 'linked/secret.txt')").run();
  sql.close();
  const outside = join(dir, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside secret');
  const store = new Store(path, 'Media');
  t.after(() => store.close());
  const root = join(dir, 'RC_Data_FMS', 'Media');
  mkdirSync(root, { recursive: true });
  symlinkSync(outside, join(root, 'linked'));
  assert.equal(store.externalFile('linked/secret.txt'), undefined);
  assert.equal(store.containerInfo(1)?.external?.missing, true);
});

test('external container uploads do not write through symlinks outside their root', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-path-write-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  t.after(() => store.close());
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
  ] as never);
  const { recordId } = store.create('Items', {});
  const outside = join(dir, 'outside');
  mkdirSync(outside);
  const root = join(dir, 'RC_Data_FMS', 'Media');
  mkdirSync(root, { recursive: true });
  symlinkSync(outside, join(root, 'Items'));
  store.setContainer('Items', Number(recordId), 'Doc', 1, { filename: 'a.txt', mime: 'text/plain', data: Buffer.from('client bytes') });
  assert.equal(existsSync(join(outside, 'Docs', 'a.txt')), false);
});

test('external container storage may use a directory symlink present when the store opens', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-path-mounted-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const root = join(dir, 'RC_Data_FMS', 'Media');
  const volume = join(dir, 'other-volume');
  const secondVolume = join(dir, 'second-volume');
  mkdirSync(root, { recursive: true });
  mkdirSync(volume);
  mkdirSync(secondVolume);
  symlinkSync(volume, join(root, 'Items'));
  const elsewhere = join(dir, 'elsewhere');
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, 'secret.txt'), 'secret');
  symlinkSync(elsewhere, join(volume, 'escape'));
  const store = new Store(path, 'Media');
  t.after(() => store.close());
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
  ] as never);
  const { recordId } = store.create('Items', {});
  store.setContainer('Items', Number(recordId), 'Doc', 1, { filename: 'mounted.txt', mime: 'text/plain', data: Buffer.from('mounted') });
  const target = join(volume, 'Docs', 'mounted.txt');
  assert.equal(readFileSync(target, 'utf8'), 'mounted');
  assert.equal(statSync(target).mode & 0o777, 0o666 & ~process.umask());
  // Links inside a mount are never indexed, even when present at store open.
  assert.equal(store.externalFile('Items/escape/secret.txt'), undefined);
  rmSync(join(root, 'Items'));
  symlinkSync(secondVolume, join(root, 'Items'));
  assert.equal(store.externalFile('Items/Docs/mounted.txt'), undefined);
});

test('external container storage may use a directory symlink one level below the root (the field folder mounted elsewhere)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-path-depth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const root = join(dir, 'RC_Data_FMS', 'Media');
  const volume = join(dir, 'volume');
  mkdirSync(join(root, 'Items'), { recursive: true });
  mkdirSync(volume);
  symlinkSync(volume, join(root, 'Items', 'Docs'));
  const store = new Store(path, 'Media');
  t.after(() => store.close());
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Items/Docs/"' } } },
  ] as never);
  const { recordId } = store.create('Items', {});
  store.setContainer('Items', Number(recordId), 'Doc', 1, { filename: 'deep.txt', mime: 'text/plain', data: Buffer.from('deep') });
  assert.equal(readFileSync(join(volume, 'deep.txt'), 'utf8'), 'deep', 'a write lands on the mounted volume, not in the database');
});

test('external container mount lookup follows the volume’s case behavior', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-path-case-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const root = join(dir, 'RC_Data_FMS', 'Media');
  const volume = join(dir, 'volume');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'Items'));
  mkdirSync(volume);
  writeFileSync(join(volume, 'mounted.txt'), 'mounted');
  symlinkSync(volume, join(root, 'Items', 'Docs'));
  const store = new Store(path, 'Media');
  t.after(() => store.close());

  let insensitive = false;
  try { insensitive = realpathSync(join(root, 'items', 'docs')) === realpathSync(join(root, 'Items', 'Docs')); } catch {}
  assert.equal(store.externalFile('Items/docs/mounted.txt') !== undefined, insensitive);
});

test('store open inspects a bounded part of a large container tree and rejects late links', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-path-wide-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const root = join(dir, 'RC_Data_FMS', 'Media');
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < 5000; i++) mkdirSync(join(root, `folder-${i}`));
  const outside = join(dir, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  const started = performance.now();
  const store = new Store(path, 'Media');
  t.after(() => store.close());
  assert.ok(performance.now() - started < 3000, 'store open should not traverse the 5,000 directories');
  symlinkSync(outside, join(root, 'late'));
  assert.equal(store.externalFile('late/secret.txt'), undefined);
  symlinkSync(outside, join(root, 'folder-4999', 'deep-link'));
  assert.equal(store.externalFile('folder-4999/deep-link/secret.txt'), undefined);
});

test('a mounted link refuses a change in its target chain after first access', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-path-retarget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'root');
  const first = join(dir, 'first');
  const second = join(dir, 'second');
  mkdirSync(root);
  mkdirSync(first);
  mkdirSync(second);
  writeFileSync(join(first, 'file.txt'), 'first');
  writeFileSync(join(second, 'file.txt'), 'second');
  const alias = join(dir, 'alias');
  symlinkSync(first, alias);
  symlinkSync(alias, join(root, 'mounted'));
  const links = existingDirectoryLinks([root]);
  assert.equal(safeExistingPath(root, 'mounted/file.txt', links), realpathSync(join(first, 'file.txt')));
  rmSync(alias);
  symlinkSync(second, alias);
  assert.equal(safeExistingPath(root, 'mounted/file.txt', links), undefined);
});
