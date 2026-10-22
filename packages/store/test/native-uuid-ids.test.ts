import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applySync, createStore, Store } from '../src/index.ts';
import { UuidV7 } from '../src/uuid-v7.ts';
import { missingPrereqs, readLocalRecords, syncPlan, type TableSyncConfig } from '../src/sync.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('UUIDv7 is deterministic and monotonic when the clock repeats or moves backwards', () => {
  let now = 1000;
  const ids = new UuidV7(() => now, () => new Uint8Array(10));
  const first = ids.next();
  const second = ids.next();
  now = 999;
  const third = ids.next();
  now = 1001;
  const fourth = ids.next();
  assert.deepEqual([first, second, third, fourth].sort(), [first, second, third, fourth]);
  for (const id of [first, second, third, fourth]) assert.match(id, uuidPattern);
  assert.equal(first, '00000000-03e8-7000-8000-000000000000');
});

test('native rows keep integer aliases and distinct UUIDs across files and duplicates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-ids-'));
  const config: TableSyncConfig = { localTable: 'Items', remoteLayout: 'Items', uuidField: 'RemoteUuid', modTimestampField: 'Stamp' };
  try {
    const stores = ['a', 'b'].map((name) => {
      const path = join(dir, `${name}.sqlite`);
      createStore(path, { mode: 'native' });
      const store = new Store(path, name);
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }, { name: 'Stamp' }] }]);
      return store;
    });
    try {
      assert.throws(() => stores[0].applyDesign([{ op: 'createTable', name: 'Bad', fields: [{ name: '_fm_uuid' }] }]), /reserves _fm_uuid/);
      const a = stores[0].create('Items', { Title: 'A' });
      assert.throws(() => stores[0].applyDesign([{ op: 'createField', table: 'Items', name: '_fm_uuid' }]), /reserves _fm_uuid/);
      assert.throws(() => stores[0].applyDesign([{ op: 'updateField', table: 'Items', field: 'Title', name: '_fm_uuid' }]), /reserves _fm_uuid/);
      const b = stores[1].create('Items', { Title: 'B' });
      const copy = stores[0].duplicate('Items', a.recordId);
      assert.deepEqual([a.recordId, b.recordId, copy.recordId], [1, 1, 2]);
      assert.match(a.id!, uuidPattern);
      assert.match(b.id!, uuidPattern);
      assert.notEqual(a.id, b.id);
      assert.notEqual(a.id, copy.id);
      assert.equal(stores[0].get('Items', a.recordId).id, a.id);
      assert.equal(stores[0].query('SELECT _fm_uuid AS id FROM Items WHERE _fm_record_id = 1')[0].id, a.id);
      assert.deepEqual(missingPrereqs(stores[0], config), []);
      assert.deepEqual(readLocalRecords(stores[0], config).map((r) => r.uuid), [a.id, copy.id]);
      const remote = { async changedSince() { return [{ uuid: b.id!, recordId: '1', modId: '0', fields: { RemoteUuid: b.id!, Title: 'B', Stamp: '' } }]; } };
      const plans = await syncPlan(stores[0], 'A', [config], remote);
      assert.deepEqual(plans[0].pushes.map((p) => p.uuid).sort(), [a.id, copy.id].sort());
      assert.deepEqual(plans[0].pulls.map((p) => p.uuid), [b.id]);
      const pulled = await applySync(stores[0], 'A', [config], remote, { async writableFields() { return new Set(['RemoteUuid', 'Title']); } }, { write: false, pull: true });
      assert.equal(pulled.tables[0].pulled.created, 1);
      assert.equal(stores[0].get('Items', 3).id, b.id);
      assert.equal(stores[0].get('Items', 3).fieldData.Title, 'B');
      const sent: string[] = [];
      const remoteRows = new Map<string, { uuid: string; recordId: string; modId: string; fields: Record<string, string> }>(
        [[b.id!, { uuid: b.id!, recordId: '1', modId: '0', fields: { RemoteUuid: b.id!, Title: 'B', Stamp: '' } }]]);
      const writer = {
        async changedSince() { return [...remoteRows.values()]; },
        async writableFields() { return new Set(['RemoteUuid', 'Title']); },
        async create(_layout: string, fields: Record<string, string | number>, beforeSend?: () => void) {
          beforeSend?.();
          const uuid = String(fields.RemoteUuid);
          sent.push(uuid);
          const recordId = String(remoteRows.size + 1);
          remoteRows.set(uuid, { uuid, recordId, modId: '0', fields: { RemoteUuid: uuid, Title: String(fields.Title ?? ''), Stamp: '' } });
          return { recordId, modId: '0' };
        },
        async read(_layout: string, recordId: string) { return [...remoteRows.values()].find((r) => r.recordId === recordId); },
        async update() { return { modId: '1' }; },
        async delete() {},
      };
      const pushed = await applySync(stores[0], 'A', [config], writer, writer, { write: true });
      assert.equal(pushed.tables[0].created, 2);
      assert.deepEqual(sent.sort(), [a.id!, copy.id!].sort());
    } finally { stores.forEach((s) => s.close()); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('opening an older native table backs it up and backfills IDs once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-uuid-migration-'));
  const path = join(dir, 'old.sqlite');
  try {
    createStore(path, { mode: 'native' });
    const first = new Store(path);
    first.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
    const tableId = first.schema.tables.find((table) => table.name === 'Items')!.id;
    first.create('Items', { Title: 'kept' });
    first.close();
    const sql = new DatabaseSync(path);
    // Synthetic N2 shape: remove the N3 column and guards while retaining the row and design.
    sql.exec(`DROP TRIGGER _fm_uuid_insert_${tableId}; DROP TRIGGER _fm_uuid_update_${tableId}; DROP INDEX _fm_uuid_${tableId}`);
    sql.exec('ALTER TABLE Items DROP COLUMN _fm_uuid');
    sql.close();
    const migrated = new Store(path);
    const id = migrated.get('Items', 1).id;
    assert.match(id!, uuidPattern);
    migrated.close();
    const backups = readdirSync(dir).filter((n) => n.includes('.before-native-uuid-'));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(join(dir, backups[0]), { readOnly: true });
    assert.equal((backup.prepare('SELECT count(*) AS n FROM Items').get() as { n: number }).n, 1);
    assert.equal((backup.prepare('PRAGMA table_info(Items)').all() as { name: string }[]).some((col) => col.name === '_fm_uuid'), false);
    backup.close();
    const again = new Store(path);
    assert.equal(again.get('Items', 1).id, id);
    assert.throws(() => again.sql.exec("INSERT INTO Items (_fm_record_id, Title) VALUES (2, 'bad')"), /native record needs a UUID/);
    again.close();
    assert.equal(readdirSync(dir).filter((n) => n.includes('.before-native-uuid-')).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
