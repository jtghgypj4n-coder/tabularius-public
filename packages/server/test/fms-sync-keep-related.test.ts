// A deletion pulled from FileMaker deletes the records this file's "delete related records" relationships say go
// with it, as a delete here does, and says how many; --keep-related (keepRelated) deletes only the record FileMaker
// deleted. Against Tabularius's own Data API standing in for FileMaker Server, as fms-sync-apply.test.ts does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, dataApiSource, describeApply } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { applySync, createStore, Store, type DesignOp, type TableSyncConfig } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let remote: Store;
let local: Store;

const table: TableSyncConfig = { localTable: 'Customers', remoteLayout: 'Customers', uuidField: 'uuid', modTimestampField: 'modts' };
const login = { database: 'Remote', user: 'Admin', password: 'pw', tables: [table] };
const customers = { op: 'createTable', name: 'Customers', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }] } as DesignOp;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-fms-related-'));
  const served = join(dir, 'served');
  mkdirSync(served);
  createStore(join(served, 'Remote' + STORE_EXT));
  const s = await serve({ dir: served, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  remote = s.host.get('Remote')!;
  remote.applyDesign([customers]);
  remote.setPassword('Admin', 'pw', '[Full Access]');
  createStore(join(dir, 'Local' + STORE_EXT));
  local = new Store(join(dir, 'Local' + STORE_EXT), 'Local');
  local.applyDesign([customers, { op: 'createTable', name: 'Orders', fields: [{ name: 'OrderNo' }, { name: 'Customer' }] } as DesignOp]);
  // Deleting a customer here deletes its orders.
  local.applyDesign([{ op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Name', right: 'Customer' }], rightDelete: true }] as DesignOp[]);
});
after(() => {
  local?.close();
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const pull = async (keepRelated?: boolean) => {
  const source = dataApiSource({ server: base, ...login });
  try {
    return await applySync(local, 'Local', [table], source, source, { write: false, pull: true, allowDeletes: true, ...(keepRelated ? { keepRelated: true } : {}) });
  } finally {
    await source.close();
  }
};
const orders = () => local.query(`SELECT OrderNo FROM "Orders" ORDER BY OrderNo`, 100).map((r) => String(r.OrderNo));
const dropRemote = (uuid: string) => remote.delete('Customers', Number(remote.query(`SELECT _fm_record_id id FROM "Customers" WHERE uuid = '${uuid}'`, 1)[0].id));

test('a pulled deletion takes the related records with it and says how many; keepRelated leaves them', async () => {
  for (const [uuid, name] of [['u1', 'Ann'], ['u2', 'Bo']] as const) remote.create('Customers', { uuid, Name: name });
  const first = await pull();
  assert.equal(first.tables[0].pulled.created, 2);
  for (const [no, who] of [['A-1', 'Ann'], ['A-2', 'Ann'], ['B-1', 'Bo']] as const) local.create('Orders', { OrderNo: no, Customer: who });

  // The default: as a delete here would.
  dropRemote('u1');
  const dropped = await pull();
  assert.equal(dropped.tables[0].pulled.deleted, 1);
  assert.equal(dropped.tables[0].pulled.related, 2);
  assert.deepEqual(orders(), ['B-1']);
  assert.match(describeApply(dropped, 'fm.example').join('\n'), /2 other records deleted here along with them.*--keep-related/);

  // Asked not to: only the customer goes.
  dropRemote('u2');
  const kept = await pull(true);
  assert.equal(kept.tables[0].pulled.deleted, 1);
  assert.equal(kept.tables[0].pulled.related, 0);
  assert.deepEqual(orders(), ['B-1']);
  assert.equal(local.query(`SELECT COUNT(*) n FROM "Customers"`, 1)[0].n, 0);
  assert.doesNotMatch(describeApply(kept, 'fm.example').join('\n'), /along with them/);
});
