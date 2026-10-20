// The tier-2 sync write leg over HTTP, against Tabularius's own Data API standing
// in for FileMaker Server (docs/data-api-compatibility.md): a mock, on
// 127.0.0.1, with a throwaway file. Nothing here can reach a real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { setCaptureOnlyDefaults, captureOnlyDefaults } from '../../scripts/src/index.ts';
import { serve, dataApiClient, dataApiSource, checkSyncAllowed, describeApply, parseSyncConfig, FmsSyncError } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { applySync, createStore, readSyncLog, openForPlanning, Store, SyncWriteError, type DesignOp, type TableSyncConfig } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let remote: Store;
let local: Store;

const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [
  { name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }, { name: 'Met', type: 'date' }, { name: 'Amount', type: 'number' },
] } as DesignOp];
const table: TableSyncConfig = { localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' };
const login = { database: 'Remote', user: 'Admin', password: 'pw', tables: [table] };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-fms-apply-'));
  const served = join(dir, 'served');
  mkdirSync(served);
  createStore(join(served, 'Remote' + STORE_EXT));
  const s = await serve({ dir: served, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  remote = s.host.get('Remote')!;
  remote.applyDesign(design);
  remote.setPassword('Admin', 'pw', '[Full Access]');
  createStore(join(dir, 'Local' + STORE_EXT));
  local = new Store(join(dir, 'Local' + STORE_EXT), 'Local');
  local.applyDesign(design);
});
after(() => {
  local?.close();
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Query rows as plain objects, to compare. */
const plain = (rows: object[]) => rows.map((r) => ({ ...r }));
const remoteRows = () => JSON.stringify(remote.query('SELECT uuid, Name, Met, Amount, _fm_mod_id FROM "Contacts" ORDER BY uuid', 100));

test('write over HTTP: adopt what matches, create, update with the modId, hold deletes, then delete; each step logged', async () => {
  remote.create('Contacts', { uuid: 'u1', Name: 'Ann', Met: '01/02/2026', Amount: 5 });
  remote.create('Contacts', { uuid: 'u4', Name: 'Only on FileMaker' });
  const u1 = local.create('Contacts', { uuid: 'u1', Name: 'Ann', Met: '01/02/2026', Amount: 5 });
  local.create('Contacts', { uuid: 'u3', Name: 'Only here', Met: '03/04/2026', Amount: 2.5 });

  const run = async (o: { write: boolean; pull?: boolean; allowDeletes?: boolean; resolve?: 'tabularius-wins' }, onProgress?: (progress: { completed: number; total: number; elapsedMs: number; etaMs: number | null }) => void) => {
    const client = dataApiClient({ server: base, ...login });
    try {
      return await applySync(local, 'Local', [table], client, client, { ...o, onProgress, actor: 'Admin@127.0.0.1' });
    } finally {
      await client.close();
    }
  };

  // A dry run first: the read-only source says what would go, and changes nothing anywhere.
  const beforeRemote = remoteRows();
  const source = dataApiSource({ server: base, ...login });
  const readOnly = openForPlanning(join(dir, 'Local' + STORE_EXT));
  try {
    const dry = await applySync(readOnly, 'Local', [table], source, source, { write: false });
    assert.deepEqual([dry.tables[0].created, dry.tables[0].updated, dry.tables[0].pulled.created], [1, 0, 1]);
    assert.match(describeApply(dry, 'fms.example.com').join('\n'), /^Dry run: nothing was changed here or on fms\.example\.com\. Add --write to send to it, --pull to bring its changes here\./);
  } finally {
    readOnly.close();
    await source.close();
  }
  assert.equal(remoteRows(), beforeRemote);
  assert.equal(readSyncLog(local).length, 0);

  // Then the write: u3 is created (its UUID, and its date in the Data API's form, kept), u1 only recorded.
  const progress: { completed: number; total: number; elapsedMs: number; etaMs: number | null }[] = [];
  let res = await run({ write: true }, (p) => progress.push(p));
  assert.equal(progress[0].completed, 0);
  assert.ok(progress.some((p) => p.completed === 1 && p.total === 1 && p.etaMs === 0));
  assert.equal(res.refused, undefined);
  assert.deepEqual([res.tables[0].created, res.tables[0].updated, res.tables[0].adopted], [1, 0, 1]);
  assert.deepEqual(plain(remote.query('SELECT uuid, Name, Met, Amount FROM "Contacts" WHERE uuid = \'u3\'', 5)), [{ uuid: 'u3', Name: 'Only here', Met: '2026-03-04', Amount: 2.5 }]);
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /^Wrote to fms\.example\.com/);

  // An edit here goes over as an update carrying the modId; only the changed field is sent.
  local.update('Contacts', u1.recordId, { Name: 'Annie' });
  res = await run({ write: true });
  assert.deepEqual([res.tables[0].created, res.tables[0].updated], [0, 1]);
  assert.deepEqual(plain(remote.query('SELECT Name, Amount FROM "Contacts" WHERE uuid = \'u1\'', 5)), [{ Name: 'Annie', Amount: 5 }]);

  // Nothing left: a rerun sends nothing and the served file is byte-for-byte what it was.
  const settled = remoteRows();
  res = await run({ write: true });
  assert.deepEqual([res.tables[0].created, res.tables[0].updated, res.tables[0].deleted, res.tables[0].adopted], [0, 0, 0, 0]);
  assert.equal(remoteRows(), settled);

  // A change on both sides is a conflict: nothing at all is sent, even for the other, clean change.
  local.update('Contacts', u1.recordId, { Name: 'Mine' });
  local.create('Contacts', { uuid: 'u5', Name: 'Would be created' });
  remote.update('Contacts', Number(remote.query('SELECT _fm_record_id id FROM "Contacts" WHERE uuid = \'u1\'', 1)[0].id), { Name: 'Theirs' });
  const held = remoteRows();
  res = await run({ write: true });
  assert.match(res.refused ?? '', /Contacts u1: changed on both sides \(Name\)/);
  assert.equal(remoteRows(), held);
  // ...until a resolution is given.
  res = await run({ write: true, resolve: 'tabularius-wins' });
  assert.equal(res.refused, undefined);
  assert.deepEqual(plain(remote.query('SELECT uuid, Name FROM "Contacts" WHERE uuid IN (\'u1\', \'u5\') ORDER BY uuid', 5)), [{ uuid: 'u1', Name: 'Mine' }, { uuid: 'u5', Name: 'Would be created' }]);

  // A deletion here is held until deletes are allowed.
  const u3 = local.query('SELECT _fm_record_id id FROM "Contacts" WHERE uuid = \'u3\'', 1)[0].id as number;
  local.delete('Contacts', u3);
  res = await run({ write: true });
  assert.equal(res.tables[0].heldDeletes, 1);
  assert.equal(remote.query('SELECT 1 FROM "Contacts" WHERE uuid = \'u3\'', 1).length, 1);
  res = await run({ write: true, allowDeletes: true });
  assert.equal(res.tables[0].deleted, 1);
  assert.equal(remote.query('SELECT 1 FROM "Contacts" WHERE uuid = \'u3\'', 1).length, 0);
  res = await run({ write: true, allowDeletes: true });
  assert.deepEqual([res.tables[0].deleted, res.tables[0].heldDeletes, res.tables[0].failed.length], [0, 0, 0]);

  // Pull: records made (u4 was already there, u6 is new) and one edited on the server come here, dates as the Data API reads them back (ISO).
  remote.create('Contacts', { uuid: 'u6', Name: 'Made there', Met: '05/06/2026', Amount: 7 });
  remote.update('Contacts', Number(remote.query('SELECT _fm_record_id id FROM "Contacts" WHERE uuid = \'u1\'', 1)[0].id), { Name: 'Edited there' });
  const localBefore = JSON.stringify(local.query('SELECT uuid, Name FROM "Contacts" ORDER BY uuid', 100));
  res = await run({ write: false });
  assert.deepEqual([res.tables[0].pulled.created, res.tables[0].pulled.updated, res.tables[0].pendingPulls], [2, 1, 0]);
  assert.equal(JSON.stringify(local.query('SELECT uuid, Name FROM "Contacts" ORDER BY uuid', 100)), localBefore, 'a dry run changes nothing here');
  res = await run({ write: false, pull: true });
  assert.deepEqual([res.tables[0].pulled.created, res.tables[0].pulled.updated], [2, 1]); // u4, there from the start, and u6
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /^Brought changes from fms\.example\.com here/);
  assert.deepEqual(plain(local.query('SELECT uuid, Name, Met, Amount FROM "Contacts" WHERE uuid IN (\'u1\', \'u6\') ORDER BY uuid', 5)), [{ uuid: 'u1', Name: 'Edited there', Met: '2026-01-02', Amount: 5 }, { uuid: 'u6', Name: 'Made there', Met: '2026-05-06', Amount: 7 }]);
  res = await run({ write: true, pull: true, allowDeletes: true });
  assert.deepEqual([res.tables[0].created, res.tables[0].updated, res.tables[0].pulled.created, res.tables[0].pulled.updated, res.tables[0].adopted], [0, 0, 0, 0, 0]);

  // The log has every write, in order, with the account that made them.
  const writes = readSyncLog(local, { limit: 1000 }).filter((l) => ['create', 'update', 'delete'].includes(l.op) && l.status === 'ok');
  assert.deepEqual(writes.map((l) => [l.op, l.uuid]), [['create', 'u3'], ['update', 'u1'], ['create', 'u5'], ['update', 'u1'], ['delete', 'u3']], 'the writes to FileMaker, in order');
  assert.ok(readSyncLog(local, { limit: 1000 }).some((l) => l.op === 'run' && /Admin@127\.0\.0\.1/.test(l.detail ?? '')));
});

test('the Data API client: a stale modId is refused as one record\'s problem, a missing record reads as gone, only stored fields are writable', async () => {
  const client = dataApiClient({ server: base, ...login });
  try {
    assert.deepEqual([...await client.writableFields('Contacts')].sort(), ['Amount', 'Met', 'Name', 'modts', 'uuid']);
    const made = await client.create('Contacts', { uuid: 'w1', Name: 'W' });
    await assert.rejects(client.update('Contacts', made.recordId, { Name: 'X' }, String(Number(made.modId) + 5)), (e: unknown) => e instanceof SyncWriteError && e.code === '306' && e.recordLevel);
    const done = await client.update('Contacts', made.recordId, { Name: 'X' }, made.modId);
    assert.notEqual(done.modId, made.modId);
    assert.equal((await client.read('Contacts', made.recordId))?.fields.Name, 'X');
    await client.delete('Contacts', made.recordId);
    assert.equal(await client.read('Contacts', made.recordId), undefined);
    await assert.rejects(client.create('Nowhere', {}), FmsSyncError);
  } finally {
    await client.close();
  }
});

test('writing is off unless the configuration says so, and a capture-only file never syncs at all', () => {
  const cfg = parseSyncConfig({ server: 'fms.example.com', database: 'Invoices', tables: [{ localTable: 'T', uuidField: 'id', modTimestampField: 'm' }] });
  assert.equal(cfg.allowWrites, undefined);
  assert.doesNotThrow(() => checkSyncAllowed(['Invoices'], cfg, { write: false }));
  assert.throws(() => checkSyncAllowed(['Invoices'], cfg, { write: true }), /doesn't allow writing to FileMaker: add "allowWrites": true/);
  const allowed = parseSyncConfig({ server: 'fms.example.com', database: 'Invoices', allowWrites: true, tables: [{ localTable: 'T', uuidField: 'id', modTimestampField: 'm' }] });
  assert.equal(allowed.allowWrites, true);
  assert.doesNotThrow(() => checkSyncAllowed(['Invoices'], allowed, { write: true }));
  assert.throws(() => parseSyncConfig({ server: 'x', database: 'y', allowWrites: 'yes', tables: [{ localTable: 'T', uuidField: 'id', modTimestampField: 'm' }] }), /"allowWrites" is true or false/);
  // The local file's name, the remote file's name, and the operator's list: planning is refused too.
  const held = ['Held'];
  assert.throws(() => checkSyncAllowed(['Held_Billing'], allowed, { write: true, captureOnly: held }), /"Held_Billing" is capture-only/);
  assert.throws(() => checkSyncAllowed(['Held_Billing'], allowed, { write: false, captureOnly: held }), /capture-only/);
  assert.throws(() => checkSyncAllowed(['Invoices'], { ...allowed, database: 'Held_Prod' }, { write: true, captureOnly: held }), /"Held_Prod" is capture-only/);
  assert.doesNotThrow(() => checkSyncAllowed(['Invoices'], allowed, { write: true, captureOnly: held }));
  // The process-wide list (TABULARIUS_CAPTURE_ONLY, serve's --capture-only) counts with no extra given.
  const was = [...captureOnlyDefaults()];
  setCaptureOnlyDefaults(['Wide'], true);
  try {
    assert.throws(() => checkSyncAllowed(['Wide_Books'], allowed, { write: false }), /"Wide_Books" is capture-only/);
  } finally {
    setCaptureOnlyDefaults(was, true);
  }
});
