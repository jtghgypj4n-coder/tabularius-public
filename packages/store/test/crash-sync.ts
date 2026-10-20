import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySync, createStore, Store, type RemoteRecord, type RemoteSource, type RemoteWriter, type TableSyncConfig } from '../src/index.ts';
import { armCrashPointForTest } from '../src/crash-point.ts';

const config: TableSyncConfig = { localTable: 'Items', remoteLayout: 'Items', uuidField: 'uuid', modTimestampField: 'modts' };
// A durable fake remote survives the child. Each acknowledged request writes
// both fields together; no network, services, credentials, or extra processes.
function remote(path: string): RemoteSource & RemoteWriter {
  const read = (): RemoteRecord[] => JSON.parse(readFileSync(path, 'utf8'));
  const save = (rows: RemoteRecord[]) => writeFileSync(path, JSON.stringify(rows));
  return {
    changedSince: async () => read(), allUuids: async () => new Set(read().map((r) => r.uuid)),
    writableFields: async () => new Set(['uuid', 'Name', 'Other']),
    read: async (_layout, id) => read().find((r) => r.recordId === id),
    create: async (_layout, fields, before) => {
      before?.();
      const rows = read();
      assert.ok(!rows.some((r) => r.uuid === fields.uuid), 'retry must not create a duplicate');
      rows.push({ uuid: String(fields.uuid), recordId: '1', modId: '1', fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])) });
      save(rows); return { recordId: '1', modId: '1' };
    },
    update: async (_layout, id, fields, modId, before) => {
      before?.();
      const rows = read(); const row = rows.find((r) => r.recordId === id)!;
      assert.equal(row.modId, modId);
      Object.assign(row.fields, fields); row.modId = String(Number(modId) + 1);
      save(rows); return { modId: row.modId };
    },
    delete: async (_layout, id, before) => { before?.(); save(read().filter((r) => r.recordId !== id)); },
  };
}

async function run(root: string, direction: string): Promise<void> {
  const store = new Store(join(root, 'A.sqlite'), 'A');
  const fm = remote(join(root, 'remote.json'));
  try {
    const result = await applySync(store, 'A', [config], fm, fm, { write: direction === 'push', pull: direction === 'pull', allowDeletes: true });
    assert.equal(result.refused, undefined);
    assert.deepEqual(result.tables.flatMap((t) => t.failed), []);
  } finally { store.close(); }
}

function inspect(root: string, direction: string, operation: string, finished = false): void {
  const store = new Store(join(root, 'A.sqlite'), 'A');
  try {
    assert.deepEqual(store.sql.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check), ['ok']);
    const rows = store.sql.prepare('SELECT Name, Other, _fm_mod_id FROM Items').all();
    for (const row of rows) assert.equal(row.Name, row.Other);
    const remoteRows = JSON.parse(readFileSync(join(root, 'remote.json'), 'utf8')) as RemoteRecord[];
    for (const row of remoteRows) assert.equal(row.fields.Name, row.fields.Other);
    const map = store.sql.prepare('SELECT * FROM _fm_sync_map').all();
    if (direction === 'pull' || finished) {
      assert.equal(map.length, rows.length, 'record existence and map existence commit together');
      if (rows.length) assert.equal(map[0].last_local_mod_id, rows[0]._fm_mod_id, 'record and map versions commit together');
    }
    if (finished) {
      assert.equal(rows.length, operation === 'delete' ? 0 : 1);
      assert.equal(remoteRows.length, rows.length);
      if (rows.length) {
        assert.equal(rows[0].Name, 'new');
        assert.equal(remoteRows[0].fields.Name, 'new');
      }
      assert.equal(store.sql.prepare("SELECT count(*) n FROM _fm_sync_log WHERE status = 'attempt'").get()!.n, 0);
    }
  } finally { store.close(); }
}

if (process.argv[2] === 'crash-child') {
  armCrashPointForTest(process.argv[5]);
  await run(process.argv[3], process.argv[4]);
} else for (const direction of ['pull', 'push']) for (const operation of ['create', 'update', 'delete']) {
  for (const step of ['after-attempt', direction === 'pull' ? 'after-data' : 'after-send', 'after-map', 'after-commit']) {
    const checkpoint = `${direction === 'pull' ? 'sync-apply' : 'sync-push'}:${step}`;
    test(`${checkpoint} (${operation})`, { concurrency: false }, async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'tabularius-crash-sync-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      createStore(join(root, 'A.sqlite'));
      const store = new Store(join(root, 'A.sqlite'), 'A');
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'uuid' }, { name: 'modts' }, { name: 'Name' }, { name: 'Other' }] }]);
      writeFileSync(join(root, 'remote.json'), '[]');
      if (operation !== 'create') {
        store.create('Items', { uuid: 'u1', Name: 'old', Other: 'old' });
        writeFileSync(join(root, 'remote.json'), JSON.stringify([{ uuid: 'u1', recordId: '1', modId: '1', fields: { uuid: 'u1', Name: 'old', Other: 'old' } }]));
        const fm = remote(join(root, 'remote.json'));
        await applySync(store, 'A', [config], fm, fm, { write: true, pull: true });
      }
      if (direction === 'pull') writeFileSync(join(root, 'remote.json'), JSON.stringify(operation === 'delete' ? [] : [{ uuid: 'u1', recordId: '1', modId: '2', fields: { uuid: 'u1', Name: 'new', Other: 'new' } }]));
      else if (operation === 'create') store.create('Items', { uuid: 'u1', Name: 'new', Other: 'new' });
      else if (operation === 'update') store.update('Items', 1, { Name: 'new', Other: 'new' });
      else store.delete('Items', 1);
      store.close();
      const child = spawnSync(process.execPath, ['--no-warnings', import.meta.filename, 'crash-child', root, direction, checkpoint], { encoding: 'utf8', timeout: 20_000 });
      assert.equal(child.status, 73, child.stderr || child.stdout);
      inspect(root, direction, operation);
      await run(root, direction);
      inspect(root, direction, operation, true);
      await run(root, direction);
      inspect(root, direction, operation, true);
    });
  }
}
