import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { prepareCaches } from '../src/preparation.ts';

test('an open peer reloads a schema edit made through another Store', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-schema-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const a = new Store(path, 'A');
  a.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Old' }] }]);
  const b = new Store(path, 'A');
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  const before = b.layout('T');
  assert.ok(before.fields.some((f) => f.name === 'Old'));
  const schema = b.schema;
  const designs = b.designs();
  a.applyDesign([{ op: 'createField', table: 'T', name: 'New' }]);
  assert.ok(b.schema.tables[0].fields.some((f) => f.name === 'New'));
  assert.notEqual(b.schema, schema);
  assert.ok(b.layout('T').fields.some((f) => f.name === 'New'), 'peer must not keep the old layout/schema');
  const id = a.create('T', { Old: 'old', New: 'new' }).recordId;
  assert.equal(b.get(before, id).fieldData.New, 'new', 'a retained layout is refreshed on use');
  a.applyDesign([{ op: 'updateLayout', layout: 'T', design: { ...a.design('T')!, width: 900 } }]);
  assert.notEqual(b.designs(), designs);
  assert.equal(b.design('T')!.width, 900);
});

test('constructor does not cache an old schema under a newer design version', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-constructor-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const a = new Store(path, 'A');
  a.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Old' }] }]);
  let b: Store | undefined;
  t.after(() => { a.close(); b?.close(); rmSync(dir, { recursive: true, force: true }); });
  const originalMeta = Store.prototype['meta'];
  let changed = false;
  t.mock.method(Store.prototype as unknown as { meta: (key: string) => unknown }, 'meta', function (this: Store, key: string) {
    const value = originalMeta.call(this, key);
    if (this !== a && this.path === path && key === 'schema' && !changed) {
      changed = true;
      a.applyDesign([{ op: 'createField', table: 'T', name: 'New' }]);
    }
    return value;
  });
  b = new Store(path, 'A');
  assert.equal(changed, true);
  assert.ok(b.schema.tables[0].fields.some((f) => f.name === 'New'));
});

test('an open peer immediately loses a revoked extended privilege', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-priv-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const a = new Store(path, 'A');
  const b = new Store(path, 'A');
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  a.savePrivilegeSet({ name: 'Api', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmrest'] });
  a.setPassword('Worker', 'secret', 'Api');
  assert.equal(b.privileges('Worker').has('fmrest'), true);
  a.savePrivilegeSet({ name: 'Api', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [] });
  assert.equal(b.privileges('Worker').has('fmrest'), false, 'revocation must reach the next request');
});

for (const shared of [false, true]) test(`a summary follows related-file writes with shared results ${shared ? 'enabled' : 'disabled'}`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-cross-file-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  const a = open('A'), b = open('B');
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  b.resolveFile = (name) => name === 'A' ? a : undefined;
  a.applyDesign([{ op: 'createTable', name: 'A', fields: [{ name: 'Key', type: 'number' }, { name: 'Value', type: 'number' }] }]);
  b.applyDesign([
    { op: 'createTable', name: 'B', fields: [{ name: 'Key', type: 'number' }] },
    { op: 'createDataSource', name: 'A', paths: ['file:A'] },
    { op: 'createOccurrence', name: 'A', file: 'A', externalTable: a.schema.tables[0].id },
    { op: 'createRelationship', left: 'B', right: 'A', predicates: [{ left: 'Key', right: a.schema.tables[0].fields[0].id }] },
    { op: 'createField', table: 'B', name: 'Echo', type: 'number', kind: 'calculation', calculation: 'A::Value', options: { unstored: true } },
    { op: 'createField', table: 'B', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Echo' } },
  ]);
  const aid = a.create('A', { Key: '1', Value: '3' }).recordId;
  const bid = b.create('B', { Key: '1' }).recordId;
  if (shared) { a.shareResults(); b.shareResults(); }
  const stamp = b.dataStamp();
  assert.equal(Number(b.get('B', bid).fieldData.Total), 3);
  a.update('A', aid, { Value: '7' });
  assert.equal(b.dataStamp(), stamp, 'the dependent file itself has not changed');
  assert.equal(Number(b.get('B', bid).fieldData.Total), 7, 'summary must follow its source file');
  const peer = new Store(a.path, 'A');
  try { peer.update('A', aid, { Value: '11' }); } finally { peer.close(); }
  assert.equal(Number(b.get('B', bid).fieldData.Total), 11, 'another source connection also invalidates the summary');
  a.sql.exec('BEGIN');
  a.update('A', aid, { Value: '19' });
  assert.equal(Number(b.get('B', bid).fieldData.Total), 19);
  a.sql.exec('ROLLBACK');
  assert.equal(Number(b.get('B', bid).fieldData.Total), 11, 'uncommitted source values must not survive rollback');
});

test('a related file rename clears resolved external field names', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-names-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  const a = open('A'), b = open('B');
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  a.applyDesign([{ op: 'createTable', name: 'A', fields: [{ name: 'Old' }] }]);
  b.resolveFile = (name) => name === 'A' ? a : undefined;
  b.applyDesign([
    { op: 'createTable', name: 'B', fields: [{ name: 'Own' }] },
    { op: 'createDataSource', name: 'A', paths: ['file:A'] },
    { op: 'createOccurrence', name: 'A', file: 'A', externalTable: a.schema.tables[0].id },
  ]);
  const to = b.schema.tableOccurrences.find((o) => o.name === 'A')!;
  const marker = `⟨field:${to.id}.${a.schema.tables[0].fields[0].id}⟩`;
  assert.equal(b.externalFieldNames(marker), 'A::Old');
  a.applyDesign([{ op: 'updateField', table: 'A', field: 'Old', name: 'New' }]);
  b.resetCaches(); // host's related-file design notification
  assert.equal(b.externalFieldNames(marker), 'A::New');
});

test('a summary over an unstable calculation is never served from cache', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-fallback-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const store = new Store(path, 'A');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Dynamic', type: 'number', kind: 'calculation', calculation: 'Random ()', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Dynamic' } },
  ]);
  const id = store.create('T', { Value: '1' }).recordId;
  let now = performance.now(), random = 0.25;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Math, 'random', () => random);
  const total = () => Number(store.get('T', id).fieldData.Total);
  assert.equal(total(), 0.25);
  random = 0.75;
  now += 999;
  assert.equal(total(), 0.75, 'Random () is recomputed on every read, as an unstored calculation');
  now += 1;
  assert.equal(total(), 0.75);
});


test('a design refresh during failed preparation also invalidates published caches', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-prepared-design-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const a = new Store(path, 'A');
  a.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Old' }] }]);
  const b = new Store(path, 'A');
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  b.layout('T');
  b.designs();
  a.applyDesign([
    { op: 'createField', table: 'T', name: 'New' },
    { op: 'updateLayout', layout: 'T', design: { ...a.design('T')!, width: 900 } },
  ]);
  assert.throws(() => prepareCaches(() => {
    assert.ok(b.layout('T').fields.some((f) => f.name === 'New'));
    assert.equal(b.design('T')!.width, 900);
    throw new Error('cancel preparation');
  }), /cancel preparation/);
  assert.ok(b.layout('T').fields.some((f) => f.name === 'New'));
  assert.equal(b.design('T')!.width, 900);
});

for (const peerWrite of [false, true]) test(`raw metadata edits invalidate caches (${peerWrite ? 'peer' : 'same'} connection), including rollback`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-raw-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const a = new Store(path), b = new Store(path);
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  a.savePrivilegeSet({ name: 'Api', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  a.setPassword('Worker', 'secret', 'Api');
  const sql = peerWrite ? b.sql : a.sql;
  assert.equal(a.privileges('Worker').has('fmrest'), true);
  const definition = { ...a.privilegeSet('Api')!, extendedPrivileges: [] };
  sql.prepare('UPDATE _fm_privileges SET json = ? WHERE name = ?').run(JSON.stringify(definition), 'Api');
  assert.equal(a.privileges('Worker').has('fmrest'), false);
  sql.prepare('UPDATE _fm_accounts SET privilege_set = ? WHERE name = ?').run('[Full Access]', 'Worker');
  assert.equal(a.privileges('Worker').full, true);
  const schema = structuredClone(a.schema);
  schema.scripts.push({ id: 12345, name: 'Raw script', steps: [] });
  sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'schema'").run(JSON.stringify(schema));
  assert.ok(a.schema.scripts.some((s) => s.name === 'Raw script'));
  if (!peerWrite) {
    sql.exec('BEGIN');
    sql.prepare('UPDATE _fm_accounts SET privilege_set = ? WHERE name = ?').run('Api', 'Worker');
    assert.equal(a.privileges('Worker').full, false);
    sql.exec('ROLLBACK');
    assert.equal(a.privileges('Worker').full, true);
  }
});

test('failed sign-ins do not reread design text or replace cached design objects', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-signin-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const a = new Store(path), b = new Store(path);
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  const schema = a.schema, designs = a.designs();
  const reset = t.mock.method(a, 'resetCaches');
  const internals = a as unknown as { prepared: Store['prepared']; meta: Store['meta'] };
  const prepared = t.mock.method(internals, 'prepared');
  const meta = t.mock.method(internals, 'meta');
  for (const source of [a, b]) {
    const version = a['metadataVersions']().design;
    source.auditSignIn('Unknown', '127.0.0.1', false);
    assert.equal(a['metadataVersions']().design, version);
    assert.equal(a.schema, schema);
    assert.equal(a.designs(), designs);
  }
  assert.equal(reset.mock.callCount(), 0);
  assert.equal(meta.mock.callCount(), 0);
  assert.ok(prepared.mock.calls.every((c) => !String(c.arguments[0]).includes('_fm_meta')));
});

test('data_version invalidates privileges after untracked peer writes', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cache-fallback-'));
  const path = join(dir, 'A.sqlite');
  createStore(path);
  const a = new Store(path), b = new Store(path);
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  a.setPassword('Worker', 'secret', '[Full Access]');
  assert.equal(a.privileges('Worker').full, true);
  // Simulate an older/external writer without the tracked-table trigger.
  b.sql.exec('DROP TRIGGER _fm_accounts_version_update');
  b.sql.prepare('UPDATE _fm_accounts SET privilege_set = ? WHERE name = ?').run('Missing', 'Worker');
  assert.equal(a.privileges('Worker').full, false);
});
