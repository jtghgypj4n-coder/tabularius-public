// The tier-2 sync WRITE leg (store/src/sync-apply.ts) against a fake FileMaker
// Server held in memory: no network, no real server. What these pin down is
// the safety of the leg: nothing is sent without `write`, nothing at all when
// the plan holds a conflict, every write is logged before it goes out, a rerun
// carries on from where a stop left off (and never sends a write twice), and
// FileMaker's own modId check is what stops an update over a newer edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySync, createStore, readSyncLog, readSyncMap, releaseHeldTables, syncPlan, Store, SyncWriteError, openForPlanning,
  type DesignOp, type RemoteFile, type RemoteRecord, type RemoteSource, type RemoteWriter, type TableSyncConfig,
} from '../src/index.ts';

const config: TableSyncConfig = { localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' };
const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [
  { name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }, { name: 'Met', type: 'date' }, { name: 'Amount', type: 'number' }, { name: 'Photo', type: 'container' },
] } as DesignOp];

interface FmRecord { recordId: string; modId: number; fields: Record<string, string> }

/** A FileMaker Server's one layout, with the Data API's modId rules, and a record of every request that changes it. */
class FakeFm implements RemoteSource, RemoteWriter {
  records = new Map<string, FmRecord>();
  calls: string[] = [];
  uploads: { uuid: string; field: string; filename: string | null; data: Uint8Array }[] = [];
  failFirstUpload = false;
  /** Make the next container upload fail with this (after FileMaker was asked). */
  uploadFailure?: Error;
  next = 1;
  /** Fields the layout lets a write set. */
  writable = new Set(['uuid', 'Name', 'Met', 'Amount', 'Photo', 'Scan']);
  /** Runs before a write goes through (a test's way to make something happen meanwhile). */
  before?: (op: string, recordId: string) => void;
  /** Make the nth write (counting from 1) fail. */
  failWrite?: { n: number; error: () => Error; afterApplying?: boolean };
  keepUuid = true;
  /** Called as a container upload starts (before the connection checks anything) and after FileMaker has it, with how many it holds. */
  onUpload?: (phase: 'start' | 'done', applied: number) => void;
  /** Make the next read of one record (the readback after a create) fail. */
  failNextRead = false;
  /** What each container address holds. */
  private held = new Map<string, Uint8Array>();
  fetchSkipped?: string;
  fetchContainer?: (layout: string, address: string, maxBytes: number) => Promise<RemoteFile | { skipped: string }>;
  /** A file that FileMaker holds at an address, as if someone there had put it in. */
  hold(address: string, data: Uint8Array): void { this.held.set(address, data); }
  /** Lets the engine fetch a container file to compare it, as the Data API connection can. */
  enableFetch(): void {
    this.fetchContainer = async (_layout, address) => {
      const data = this.held.get(address);
      return this.fetchSkipped ? { skipped: this.fetchSkipped } : data ? { filename: null, mime: '', data } : { skipped: 'no such file' };
    };
  }
  /** Runs when the records are read (after the local ones were), for something to happen meanwhile. */
  onRead?: () => void;
  /** The field data of every create and update, as sent. */
  sent: Record<string, string | number>[] = [];
  private writes = 0;

  /** As the Data API stores a value written in its US form and reads it back with dateformats=2. */
  private stored = (data: Record<string, string | number>) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v).replace(/^(\d\d)\/(\d\d)\/(\d{4})$/, '$3-$1-$2')]));

  seed(uuid: string, fields: Record<string, string> = {}): FmRecord {
    const rec = { recordId: String(this.next++), modId: 1, fields: { uuid, modts: '', ...fields } };
    this.records.set(rec.recordId, rec);
    return rec;
  }
  byUuid = (uuid: string) => [...this.records.values()].find((r) => r.fields.uuid === uuid);
  /** As the Data API reads them: an empty container field is '', never absent. */
  private view = (r: FmRecord): RemoteRecord => ({ uuid: r.fields.uuid ?? '', recordId: r.recordId, modId: String(r.modId), fields: { Photo: '', Scan: '', ...r.fields } });

  async changedSince() { this.onRead?.(); return [...this.records.values()].map(this.view); }
  async allUuids() { return new Set([...this.records.values()].map((r) => r.fields.uuid)); }
  async writableFields() { return this.writable; }
  async read(_layout: string, recordId: string) {
    if (this.failNextRead) { this.failNextRead = false; throw new Error('the readback failed'); }
    const r = this.records.get(recordId);
    return r ? this.view(r) : undefined;
  }
  private gate(op: string, recordId: string, apply: () => void) {
    this.before?.(op, recordId);
    this.writes++;
    const f = this.failWrite;
    if (f && f.n === this.writes) {
      if (f.afterApplying) apply();
      throw f.error();
    }
    apply();
  }
  async create(_layout: string, fieldData: Record<string, string | number>, beforeSend?: () => void) {
    beforeSend?.();
    this.calls.push(`create ${fieldData.uuid}`);
    this.sent.push(fieldData);
    let made!: FmRecord;
    this.gate('create', '', () => {
      made = { recordId: String(this.next++), modId: 1, fields: { modts: '', ...this.stored(fieldData) } };
      if (!this.keepUuid) made.fields.uuid = 'assigned-by-filemaker';
      this.records.set(made.recordId, made);
    });
    return { recordId: made.recordId, modId: String(made.modId) };
  }
  async update(_layout: string, recordId: string, fieldData: Record<string, string | number>, modId: string, beforeSend?: () => void) {
    beforeSend?.();
    this.calls.push(`update ${this.records.get(recordId)?.fields.uuid} ${JSON.stringify(fieldData)}`);
    this.sent.push(fieldData);
    const r = this.records.get(recordId);
    if (!r) throw new SyncWriteError('Record is missing (error 101)', '101', true);
    this.before?.('update', recordId);
    if (String(r.modId) !== modId) throw new SyncWriteError('Record modification ID does not match (error 306)', '306', true);
    this.gate('update', recordId, () => {
      Object.assign(r.fields, this.stored(fieldData));
      r.modId++;
    });
    return { modId: String(r.modId) };
  }
  async delete(_layout: string, recordId: string, beforeSend?: () => void) {
    beforeSend?.();
    this.calls.push(`delete ${this.records.get(recordId)?.fields.uuid}`);
    this.gate('delete', recordId, () => void this.records.delete(recordId));
  }
  async uploadContainer(_layout: string, recordId: string, field: string, file: { filename: string | null; mime: string; data: Uint8Array }, beforeSend?: () => void) {
    this.onUpload?.('start', this.uploads.length);
    beforeSend?.();
    const record = this.records.get(recordId);
    if (!record) throw new SyncWriteError('Record is missing (error 101)', '101', true);
    this.uploads.push({ uuid: record.fields.uuid, field, filename: file.filename, data: new Uint8Array(file.data) });
    if (this.uploadFailure) { const e = this.uploadFailure; this.uploadFailure = undefined; throw e; }
    if (this.failFirstUpload) {
      this.failFirstUpload = false;
      throw new SyncWriteError('transient upload failure', 'network');
    }
    record.fields[field] = `container-${this.uploads.length}`;
    this.held.set(record.fields[field], new Uint8Array(file.data));
    record.modId++;
    this.onUpload?.('done', this.uploads.length);
    return { modId: String(record.modId) };
  }
}

interface Rig { dir: string; store: Store; fm: FakeFm; run: (o?: Partial<Parameters<typeof applySync>[5]>, cfg?: TableSyncConfig[]) => ReturnType<typeof applySync>; log: () => ReturnType<typeof readSyncLog> }

function rig(second = false): Rig {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sync-apply-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  store.applyDesign(design);
  if (second) store.applyDesign([{ op: 'createField', table: 'Contacts', name: 'Scan', type: 'container' }]);
  const fm = new FakeFm();
  return {
    dir, store, fm,
    run: (o = {}, cfg = [config]) => applySync(store, 'Local', cfg, fm, fm, { write: true, ...o }),
    log: () => readSyncLog(store, { limit: 1000 }),
  };
}
const cleanup = (r: Rig) => { r.store.close(); rmSync(r.dir, { recursive: true, force: true }); };
const rows = (s: Store) => s.query('SELECT * FROM "Contacts" ORDER BY _fm_record_id', 100);

test('a dry run sends nothing and writes nothing here, not even the bookkeeping tables', async () => {
  const r = rig();
  try {
    r.store.create('Contacts', { uuid: 'a', Name: 'Ann' });
    r.fm.seed('b', { Name: 'Bob' });
    const before = JSON.stringify(rows(r.store));
    const readOnly = openForPlanning(join(r.dir, 'Local.sqlite'));
    const res = await applySync(readOnly, 'Local', [config], r.fm, r.fm, { write: false });
    readOnly.close();
    assert.equal(res.write, false);
    assert.deepEqual(res.tables.map((t) => [t.created, t.updated, t.deleted, t.pulled.created]), [[1, 0, 0, 1]]);
    assert.deepEqual(r.fm.calls, []);
    assert.equal(JSON.stringify(rows(r.store)), before);
    assert.equal((r.store.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE '_fm_sync%'").get() as { n: number }).n, 0);
    // A dry run can't be handed the power to write: the engine refuses a write with only a reader.
    await assert.rejects(applySync(r.store, 'Local', [config], r.fm, { writableFields: async () => new Set() }, { write: true }), /needs a writer/);
  } finally {
    cleanup(r);
  }
});

test('write: creates and updates on FileMaker, logs each, and a second run has nothing left to send', async () => {
  const r = rig();
  try {
    const known = r.store.create('Contacts', { uuid: 'u1', Name: 'Ann', Met: '2026-01-02', Amount: 5 });
    r.fm.seed('u1', { Name: 'Ann', Met: '2026-01-02', Amount: '5' });
    // Both sides agree on u1 and have never synced: adopted, nothing sent.
    let res = await r.run();
    assert.deepEqual(r.fm.calls, []);
    assert.equal(res.tables[0].adopted, 1);
    assert.equal(readSyncMap(r.store, 'Local\u0000Contacts').length, 1);

    // Now a change here to u1, and a new record here.
    r.store.update('Contacts', known.recordId, { Name: 'Annie' });
    r.store.create('Contacts', { uuid: 'u2', Name: 'Bea', Met: '2026-03-04', Amount: 2.5 });
    res = await r.run({ actor: 'sync@fms.example.com' });
    assert.equal(res.refused, undefined);
    assert.deepEqual([res.tables[0].created, res.tables[0].updated, res.tables[0].deleted], [1, 1, 0]);
    // The update sent only the field that differs; the date went in FileMaker's form.
    assert.ok((r.fm.calls as string[]).includes('update u1 {"Name":"Annie"}'));
    assert.deepEqual(r.fm.sent.find((x) => x.uuid === 'u2'), { uuid: 'u2', Name: 'Bea', Met: '03/04/2026', Amount: 2.5 });
    assert.deepEqual(r.fm.byUuid('u2')!.fields, { modts: '', uuid: 'u2', Name: 'Bea', Met: '2026-03-04', Amount: '2.5' });
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'Annie');
    // A container and the modification timestamp are never sent.
    assert.deepEqual(res.tables[0].unsentFields, ['Photo']);

    const log = r.log();
    const mine = log.filter((l) => l.runId === res.runId);
    assert.deepEqual(mine.map((l) => [l.op, l.status]), [['run', 'started'], ['create', 'ok'], ['update', 'ok'], ['run', 'finished']]);
    assert.deepEqual(mine[1].fields, ['uuid', 'Name', 'Met', 'Amount']);
    assert.equal(mine[2].modIdBefore, '1');
    assert.equal(mine[2].modIdAfter, '2');
    assert.match(mine[0].detail ?? '', /sync@fms\.example\.com/);

    // Idempotent: nothing left to send, nothing sent, nothing new in the file but the run's two rows.
    r.fm.calls.length = 0;
    const again = await r.run();
    assert.deepEqual(r.fm.calls, []);
    assert.deepEqual([again.tables[0].created, again.tables[0].updated, again.tables[0].deleted, again.tables[0].adopted], [0, 0, 0, 0]);
    const dry = await syncPlan(r.store, 'Local', [config], r.fm);
    assert.equal(dry[0].pushes.length + dry[0].pulls.length + dry[0].conflicts.length, 0);
  } finally {
    cleanup(r);
  }
});

test('a container upload that failed is retried after a restart without creating another record', async () => {
  const r = rig();
  try {
    const made = r.store.create('Contacts', { uuid: 'u1', Name: 'Ann' });
    r.store.setContainer('Contacts', made.recordId, 'Photo', 1, { filename: 'small.txt', mime: 'text/plain', data: Buffer.from('container bytes') });
    r.fm.failFirstUpload = true;

    const first = await r.run({ containers: { maxBytes: 1024 } });
    assert.match(first.stopped ?? '', /run it again/i);
    assert.equal(r.fm.records.size, 1);
    assert.equal(r.fm.uploads.length, 1);
    assert.equal(r.fm.byUuid('u1')?.fields.Photo, undefined);
    const pending = r.store.sql.prepare('SELECT uuid, field FROM _fm_sync_container_pending').get() as { uuid: string; field: string };
    assert.equal(pending.uuid, 'u1');
    assert.equal(pending.field, 'Photo');

    r.store.close();
    r.store = new Store(join(r.dir, 'Local.sqlite'), 'Local');
    const second = await applySync(r.store, 'Local', [config], r.fm, r.fm, { write: true, containers: { maxBytes: 1024 } });
    assert.equal(second.stopped, undefined);
    assert.equal(r.fm.records.size, 1);
    assert.equal(r.fm.uploads.length, 2);
    assert.equal(r.fm.uploads[1].uuid, 'u1');
    assert.equal(r.fm.uploads[1].field, 'Photo');
    assert.equal(Buffer.from(r.fm.uploads[1].data).toString(), 'container bytes');
    assert.ok(r.fm.byUuid('u1')?.fields.Photo);
    assert.equal((r.store.sql.prepare('SELECT count(*) AS n FROM _fm_sync_container_pending').get() as { n: number }).n, 0);
    assert.deepEqual(second.tables.map((t) => [t.created, t.updated]), [[0, 1]]);
  } finally {
    cleanup(r);
  }
});

test('a conflict stops the whole run before anything is sent, and the log says so', async () => {
  const r = rig();
  try {
    r.store.create('Contacts', { uuid: 'x', Name: 'Mine' });
    r.store.create('Contacts', { uuid: 'new', Name: 'Would be created' });
    r.fm.seed('x', { Name: 'Theirs' });
    const res = await r.run();
    assert.match(res.refused ?? '', /1 conflict held for review, so nothing was written: Contacts x: changed on both sides \(Name\)/);
    assert.deepEqual(r.fm.calls, []);
    assert.equal(r.fm.byUuid('new'), undefined);
    assert.deepEqual(r.log().map((l) => [l.op, l.status]), [['run', 'started'], ['run', 'refused']]);
    assert.equal(res.tables.length, 0);
  } finally {
    cleanup(r);
  }
});

test('a resolution turns a conflict into a push; a table\'s own policy is not overridden; delete-vs-change never resolves', async () => {
  const r = rig();
  try {
    r.store.create('Contacts', { uuid: 'x', Name: 'Mine' });
    r.fm.seed('x', { Name: 'Theirs' });
    // filemaker-wins: no push to make, the FileMaker side is left alone and the pull is for the pull leg.
    let res = await r.run({ resolve: 'filemaker-wins' });
    assert.equal(res.refused, undefined);
    assert.equal(res.tables[0].pendingPulls, 1);
    assert.deepEqual(r.fm.calls, []);
    // tabularius-wins: ours goes to FileMaker.
    res = await r.run({ resolve: 'tabularius-wins' });
    assert.deepEqual(r.fm.calls, ['update x {"Name":"Mine"}']);
    assert.equal(r.fm.byUuid('x')!.fields.Name, 'Mine');
    // A table that names its own policy keeps it whatever --resolve says.
    r.store.create('Contacts', { uuid: 'y', Name: 'Mine' });
    r.fm.seed('y', { Name: 'Theirs' });
    r.fm.calls.length = 0;
    res = await r.run({ resolve: 'tabularius-wins' }, [{ ...config, policy: 'filemaker-wins' }]);
    assert.deepEqual(r.fm.calls, []);
    assert.equal(res.tables[0].pendingPulls, 1);
  } finally {
    cleanup(r);
  }
});

test('a record deleted on one side and changed on the other stops the run whatever the resolution', async () => {
  const r = rig();
  try {
    const l = r.store.create('Contacts', { uuid: 'x', Name: 'Ann' });
    const f = r.fm.seed('x', { Name: 'Ann' });
    await r.run(); // adopted
    r.store.delete('Contacts', l.recordId);
    f.fields.Name = 'Changed there';
    f.modId++;
    const res = await r.run({ resolve: 'tabularius-wins', allowDeletes: true });
    assert.match(res.refused ?? '', /x: deleted here, changed on FileMaker/);
    assert.ok(r.fm.byUuid('x'));
  } finally {
    cleanup(r);
  }
});

test('deletions are held unless allowed, and then checked against the record\'s modId first', async () => {
  const r = rig();
  try {
    const a = r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    const b = r.store.create('Contacts', { uuid: 'b', Name: 'B' });
    r.fm.seed('a', { Name: 'A' });
    const fb = r.fm.seed('b', { Name: 'B' });
    await r.run();
    r.store.delete('Contacts', a.recordId);
    r.store.delete('Contacts', b.recordId);
    let res = await r.run();
    assert.equal(res.tables[0].heldDeletes, 2);
    assert.deepEqual(r.fm.calls, []);
    // b is edited on FileMaker just before its delete would go out: the delete is refused for that record only.
    const readBack = r.fm.read.bind(r.fm);
    r.fm.read = async (layout, id) => { if (id === fb.recordId) fb.modId++; return readBack(layout, id); };
    res = await r.run({ allowDeletes: true });
    assert.equal(res.tables[0].deleted, 1);
    assert.equal(res.tables[0].failed.length, 1);
    assert.match(res.tables[0].failed[0].error, /changed on FileMaker since it was read/);
    assert.equal(r.fm.byUuid('a'), undefined);
    assert.ok(r.fm.byUuid('b'));
  } finally {
    cleanup(r);
  }
});

test('FileMaker\'s modId check refuses an update over a newer edit: that record fails, the rest go on', async () => {
  const r = rig();
  try {
    const a = r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    const b = r.store.create('Contacts', { uuid: 'b', Name: 'B' });
    const fa = r.fm.seed('a', { Name: 'A' });
    r.fm.seed('b', { Name: 'B' });
    await r.run();
    r.store.update('Contacts', a.recordId, { Name: 'A2' });
    r.store.update('Contacts', b.recordId, { Name: 'B2' });
    // Someone edits a on FileMaker after the plan was read and before the write.
    r.fm.before = (op, id) => { if (op === 'update' && id === fa.recordId) { fa.modId++; fa.fields.Name = 'edited there'; } };
    const res = await r.run();
    assert.equal(res.tables[0].updated, 1);
    assert.deepEqual(res.tables[0].failed.map((f) => [f.uuid, f.op]), [['a', 'update']]);
    assert.match(res.tables[0].failed[0].error, /306/);
    assert.equal(res.stopped, undefined);
    assert.equal(r.fm.byUuid('a')!.fields.Name, 'edited there', 'their edit is intact');
    assert.equal(r.fm.byUuid('b')!.fields.Name, 'B2');
    const failed = r.log().filter((l) => l.status === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].uuid, 'a');
    // Next run sees both sides changed: a conflict, held. Nothing is overwritten.
    r.fm.before = undefined;
    const next = await r.run();
    assert.match(next.refused ?? '', /a: changed on both sides/);
  } finally {
    cleanup(r);
  }
});

test('a stop is resumable, and a write that reached FileMaker unrecorded is adopted, never made twice', async () => {
  const r = rig();
  try {
    for (const u of ['a', 'b', 'c']) r.store.create('Contacts', { uuid: u, Name: u.toUpperCase() });
    // The second create reaches FileMaker, then the answer is lost.
    r.fm.failWrite = { n: 2, afterApplying: true, error: () => new Error('socket hang up') };
    let res = await r.run();
    assert.match(res.stopped ?? '', /stopped at Contacts b: socket hang up/);
    assert.equal(res.tables[0].created, 1);
    assert.deepEqual([...r.fm.records.values()].map((x) => x.fields.uuid), ['a', 'b']);
    const failedRow = r.log().find((l) => l.uuid === 'b');
    assert.equal(failedRow?.status, 'failed');

    // Resume: b is the same on both sides (adopted), only c is made.
    r.fm.failWrite = undefined;
    r.fm.calls.length = 0;
    res = await r.run();
    assert.equal(res.stopped, undefined);
    assert.deepEqual(r.fm.calls, ['create c']);
    assert.equal(res.tables[0].adopted, 1);
    assert.deepEqual([...r.fm.records.values()].map((x) => x.fields.uuid), ['a', 'b', 'c']);
    r.fm.calls.length = 0;
    await r.run();
    assert.deepEqual(r.fm.calls, []);
  } finally {
    cleanup(r);
  }
});

test('an attempt a crash left unfinished is marked interrupted by the next run', async () => {
  const r = rig();
  try {
    r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    await r.run();
    // Simulate a run that died after logging its attempt.
    r.store.sql.prepare("INSERT INTO _fm_sync_log (run_id, at, op, status) VALUES ('dead-run', '2026-10-15T00:00:00Z', 'create', 'attempt')").run();
    const res = await r.run();
    assert.equal(res.interrupted, 1);
    assert.equal(r.log().find((l) => l.runId === 'dead-run')?.status, 'interrupted');
  } finally {
    cleanup(r);
  }
});

test('a UUID field that will not keep the supplied value stops the run, holds the table, and says how to fix it', async () => {
  const r = rig();
  try {
    r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    r.store.create('Contacts', { uuid: 'b', Name: 'B' });
    r.fm.keepUuid = false;
    let res = await r.run();
    assert.match(res.stopped ?? '', /reads back with UUID "assigned-by-filemaker", not "a"/);
    assert.equal(r.fm.calls.length, 1, 'only one stray record, not one per local record');
    // A rerun does nothing at all until the table is released.
    r.fm.calls.length = 0;
    res = await r.run();
    assert.match(res.tables[0].skipped ?? '', /held by an earlier run/);
    assert.deepEqual(r.fm.calls, []);
    assert.equal(releaseHeldTables(r.store, 'Local', [config]), 1);
    r.fm.keepUuid = true;
    res = await r.run();
    // The stray record from before is on FileMaker under another key (to be removed by hand): it is a pull, not touched.
    assert.equal(res.tables[0].created, 2);
    assert.equal(res.tables[0].pendingPulls, 1);
  } finally {
    cleanup(r);
  }
});

test('failures that are not one record\'s stop the run at once; too many refused records stop it too', async () => {
  const r = rig();
  try {
    for (const u of ['a', 'b', 'c', 'd']) r.store.create('Contacts', { uuid: u, Name: u });
    r.fm.failWrite = { n: 1, error: () => new SyncWriteError('Account is invalid (error 212)', '212', false) };
    let res = await r.run();
    assert.match(res.stopped ?? '', /stopped at Contacts a: Account is invalid/);
    assert.equal(r.fm.calls.length, 1);

    r.fm.failWrite = undefined;
    const original = r.fm.create.bind(r.fm);
    r.fm.create = async () => { throw new SyncWriteError('Validation failed (error 502)', '502', true); };
    res = await r.run({ maxFailures: 3 });
    assert.match(res.stopped ?? '', /stopped after 3 records were refused/);
    assert.equal(res.tables[0].failed.length, 3);
    r.fm.create = original;
    res = await r.run();
    assert.equal(res.tables[0].created, 4);
  } finally {
    cleanup(r);
  }
});

test('a paused table is skipped and the others still sync; fields the layout does not allow are not sent', async () => {
  const r = rig();
  try {
    r.store.create('Contacts', { uuid: 'a', Name: 'A', Amount: 9 });
    r.fm.writable = new Set(['uuid', 'Name']);
    const res = await r.run({}, [{ ...config, localTable: 'Nowhere', remoteLayout: 'Nowhere' }, config]);
    assert.match(res.tables[0].skipped ?? '', /missing field/);
    assert.equal(res.tables[1].created, 1);
    assert.deepEqual(res.tables[1].unsentFields, ['Met', 'Amount', 'Photo']);
    assert.deepEqual(r.fm.byUuid('a')!.fields, { modts: '', uuid: 'a', Name: 'A' });
  } finally {
    cleanup(r);
  }
});

// ---- The pull leg: FileMaker's changes brought here ----

const pullRows = (s: Store) => s.query('SELECT uuid, Name, Met, Amount, _fm_mod_id FROM "Contacts" ORDER BY uuid', 100).map((r) => ({ ...r }));

test('pull: creates, updates and (when allowed) deletes here; push is left alone, and a rerun has nothing left', async () => {
  const r = rig();
  try {
    const mine = r.store.create('Contacts', { uuid: 'u1', Name: 'Ann', Amount: 5 });
    const gone = r.store.create('Contacts', { uuid: 'u9', Name: 'Will go' });
    const f1 = r.fm.seed('u1', { Name: 'Ann', Amount: '5' });
    const f9 = r.fm.seed('u9', { Name: 'Will go' });
    await r.run(); // adopt both
    // On FileMaker: u1 edited, u2 new (with a date), u9 deleted.
    f1.fields.Name = 'Annie'; f1.modId++;
    r.fm.seed('u2', { Name: 'Bea', Met: '2026-03-04', Amount: '2.5' });
    r.fm.records.delete(f9.recordId);
    // And one new here, which only a push would send.
    r.store.create('Contacts', { uuid: 'u3', Name: 'Only here' });

    let res = await r.run({ write: false, pull: true });
    assert.deepEqual(r.fm.calls, [], 'pull alone sends nothing');
    assert.deepEqual(res.tables[0].pulled, { created: 1, updated: 1, deleted: 0, related: 0 });
    assert.equal(res.tables[0].heldPullDeletes, 1);
    assert.equal(res.tables[0].pendingPushes, 1);
    assert.deepEqual(pullRows(r.store).map((x) => [x.uuid, x.Name, x.Met, x.Amount]), [['u1', 'Annie', null, 5], ['u2', 'Bea', '2026-03-04', 2.5], ['u3', 'Only here', null, null], ['u9', 'Will go', null, null]]);
    // The audit log says what a pull changed here came from a sync; what was typed in directly has no such source.
    const bySurface = r.store.auditLog({}).filter((e) => e.table === 'Contacts' && (e.kind === 'create' || e.kind === 'update'));
    assert.deepEqual(bySurface.filter((e) => e.surface === 'sync').length, 2, 'the pulled create and update');
    assert.ok(bySurface.filter((e) => e.surface !== 'sync').length >= 3, 'the direct writes keep no sync label');

    res = await r.run({ write: false, pull: true, allowDeletes: true });
    assert.deepEqual(res.tables[0].pulled, { created: 0, updated: 0, deleted: 1, related: 0 });
    assert.deepEqual(pullRows(r.store).map((x) => x.uuid), ['u1', 'u2', 'u3']);
    void mine; void gone;

    const log = r.log().filter((l) => l.op.startsWith('pull-') && l.status === 'ok');
    assert.deepEqual(log.map((l) => [l.op, l.uuid]), [['pull-create', 'u2'], ['pull-update', 'u1'], ['pull-delete', 'u9']]);

    // Both ways in one run settles it: u3 goes out, and then nothing is left either way.
    res = await r.run({ write: true, pull: true });
    assert.equal(res.tables[0].created, 1);
    r.fm.calls.length = 0;
    res = await r.run({ write: true, pull: true, allowDeletes: true });
    assert.deepEqual(r.fm.calls, []);
    const t = res.tables[0];
    assert.deepEqual([t.created, t.updated, t.deleted, t.pulled.created, t.pulled.updated, t.pulled.deleted, t.adopted, t.pendingPulls, t.pendingPushes], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const plan = await syncPlan(r.store, 'Local', [config], r.fm);
    assert.equal(plan[0].pushes.length + plan[0].pulls.length + plan[0].conflicts.length, 0);
  } finally {
    cleanup(r);
  }
});

test('a dry run says what a pull would do and changes nothing; without --pull the records are only counted', async () => {
  const r = rig();
  try {
    r.fm.seed('u2', { Name: 'Bea' });
    const before = JSON.stringify(pullRows(r.store));
    let readOnly = openForPlanning(join(r.dir, 'Local.sqlite'));
    let res = await applySync(readOnly, 'Local', [config], r.fm, r.fm, { write: false });
    readOnly.close();
    assert.equal(res.tables[0].pulled.created, 1);
    assert.equal(JSON.stringify(pullRows(r.store)), before);
    res = await r.run(); // write only
    assert.equal(res.tables[0].pendingPulls, 1);
    assert.equal(pullRows(r.store).length, 0);
    readOnly = openForPlanning(join(r.dir, 'Local.sqlite'));
    await assert.rejects(applySync(readOnly, 'Local', [config], r.fm, r.fm, { write: false, pull: true }), /needs a Store that can write/);
    readOnly.close();
  } finally {
    cleanup(r);
  }
});

test('a pull refuses a record edited here since the plan read it, and the next run sees a conflict; the rest are pulled', async () => {
  const r = rig();
  try {
    const a = r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    r.store.create('Contacts', { uuid: 'b', Name: 'B' });
    const fa = r.fm.seed('a', { Name: 'A' });
    const fb = r.fm.seed('b', { Name: 'B' });
    await r.run();
    fa.fields.Name = 'A from FM'; fa.modId++;
    fb.fields.Name = 'B from FM'; fb.modId++;
    // Someone edits a here after the plan read the local records and before the pull writes.
    r.fm.onRead = () => { r.fm.onRead = undefined; r.store.update('Contacts', a.recordId, { Name: 'A edited here' }); };
    const res = await r.run({ write: false, pull: true });
    assert.deepEqual(res.tables[0].failed.map((f) => [f.uuid, f.op]), [['a', 'pull-update']]);
    assert.match(res.tables[0].failed[0].error, /306|modification/i);
    assert.equal(res.tables[0].pulled.updated, 1);
    assert.deepEqual(pullRows(r.store).map((x) => [x.uuid, x.Name]), [['a', 'A edited here'], ['b', 'B from FM']]);
    const next = await r.run({ write: false, pull: true });
    assert.match(next.refused ?? '', /a: changed on both sides/);
  } finally {
    cleanup(r);
  }
});

test('a pulled delete is refused when the record changed here meanwhile', async () => {
  const r = rig();
  try {
    const a = r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    const fa = r.fm.seed('a', { Name: 'A' });
    await r.run();
    r.fm.records.delete(fa.recordId);
    r.fm.onRead = () => { r.fm.onRead = undefined; r.store.update('Contacts', a.recordId, { Name: 'edited here' }); };
    const res = await r.run({ write: false, pull: true, allowDeletes: true });
    assert.match(res.tables[0].failed[0].error, /changed here since it was read/);
    assert.equal(pullRows(r.store).length, 1);
  } finally {
    cleanup(r);
  }
});

test('reviewed choices turn each kind of conflict into the push or pull it names; a stale choice refuses the run', async () => {
  const r = rig();
  try {
    // Four conflicts: both changed, deleted here and changed there, changed here and deleted there, and a second of the first kind.
    const a = r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    const b = r.store.create('Contacts', { uuid: 'b', Name: 'B' });
    const c = r.store.create('Contacts', { uuid: 'c', Name: 'C' });
    const d = r.store.create('Contacts', { uuid: 'd', Name: 'D' });
    const fa = r.fm.seed('a', { Name: 'A' });
    const fb = r.fm.seed('b', { Name: 'B' });
    const fc = r.fm.seed('c', { Name: 'C' });
    const fd = r.fm.seed('d', { Name: 'D' });
    await r.run();
    r.store.update('Contacts', a.recordId, { Name: 'A here' }); fa.fields.Name = 'A there'; fa.modId++;
    r.store.delete('Contacts', b.recordId); fb.fields.Name = 'B there'; fb.modId++;
    r.store.update('Contacts', c.recordId, { Name: 'C here' }); r.fm.records.delete(fc.recordId);
    r.store.update('Contacts', d.recordId, { Name: 'D here' }); fd.fields.Name = 'D there'; fd.modId++;

    const held = await r.run({ write: true, pull: true, allowDeletes: true });
    assert.match(held.refused ?? '', /4 conflicts/);
    const stale = await r.run({ write: true, pull: true, resolutions: [{ table: 'Contacts', uuid: 'zzz', keep: 'mine', reviewToken: 'unreviewed' }] });
    assert.match(stale.refused ?? '', /no longer matches a conflict \(Contacts zzz\)/);

    const token = (uuid: string) => held.plans[0].conflicts.find((c) => c.uuid === uuid)!.reviewToken!;
    // a: mine (sent); b: mine (deleted there); c: theirs (deleted here too); d: theirs (comes here).
    const res = await r.run({ write: true, pull: true, allowDeletes: true, resolutions: [
      { table: 'Contacts', uuid: 'a', keep: 'mine', reviewToken: token('a') }, { table: 'Contacts', uuid: 'b', keep: 'mine', reviewToken: token('b') },
      { table: 'Contacts', uuid: 'c', keep: 'theirs', reviewToken: token('c') }, { table: 'Contacts', uuid: 'd', keep: 'theirs', reviewToken: token('d') },
    ] });
    assert.equal(res.refused, undefined);
    assert.deepEqual(res.tables[0].failed, []);
    assert.equal(r.fm.byUuid('a')!.fields.Name, 'A here');
    assert.equal(r.fm.byUuid('b'), undefined);
    assert.deepEqual(rows(r.store).map((x) => [x.uuid, x.Name]), [['a', 'A here'], ['d', 'D there']]);
    // And the other two answers for a deleted-versus-changed pair: a record deleted there comes back, or one deleted here is made again.
    r.store.create('Contacts', { uuid: 'e', Name: 'E' });
    const fe = r.fm.seed('e', { Name: 'E' });
    await r.run();
    r.store.delete('Contacts', Number(r.store.query("SELECT _fm_record_id i FROM Contacts WHERE uuid = 'e'", 1)[0].i)); fe.fields.Name = 'E there'; fe.modId++;
    const review = await r.run({ write: false });
    await r.run({ write: true, pull: true, resolutions: [{ table: 'Contacts', uuid: 'e', keep: 'theirs', reviewToken: review.plans[0].conflicts[0].reviewToken! }] });
    assert.deepEqual(rows(r.store).filter((x) => x.uuid === 'e').map((x) => x.Name), ['E there'], 'deleted here, kept theirs: made here again');
  } finally {
    cleanup(r);
  }
});

for (const change of ['remote-edit', 'local-edit', 'local-edit-during-read', 'remote-delete', 'local-delete', 'remote-restore', 'local-restore', 'setup', 'missing-token', 'altered-token'] as const) {
  test(`review binding refuses ${change} after check without applying any record`, async () => {
    const r = rig();
    try {
      const local = r.store.create('Contacts', { uuid: 'conflict', Name: 'Original' });
      const remote = r.fm.seed('conflict', { Name: 'Original' });
      await r.run();
      r.store.update('Contacts', local.recordId, { Name: 'Mine' });
      remote.fields.Name = 'Theirs'; remote.modId++;
      if (change === 'remote-restore') r.fm.records.delete(remote.recordId);
      if (change === 'local-restore') r.store.delete('Contacts', local.recordId);
      const review = await r.run({ write: false, reviewIdentity: 'destination A' });
      const reviewToken = review.plans[0].conflicts[0].reviewToken!;
      if (change === 'remote-edit') { remote.fields.Name = 'Newer FileMaker edit'; remote.modId++; }
      if (change === 'local-edit') r.store.update('Contacts', local.recordId, { Name: 'Newer local edit' });
      if (change === 'remote-delete') r.fm.records.delete(remote.recordId);
      if (change === 'local-delete') r.store.delete('Contacts', local.recordId);
      if (change === 'remote-restore') r.fm.seed('conflict', { Name: 'Restored there' });
      if (change === 'local-restore') r.store.create('Contacts', { uuid: 'conflict', Name: 'Restored here' });
      r.store.create('Contacts', { uuid: 'unrelated', Name: 'Must not be sent' });
      let before = JSON.stringify([rows(r.store), [...r.fm.records]]);
      if (change === 'local-edit-during-read') r.fm.onRead = () => {
        r.store.update('Contacts', local.recordId, { Name: 'Changed during the apply read' });
        before = JSON.stringify([rows(r.store), [...r.fm.records]]);
      };
      const result = await r.run({ write: true, pull: true, allowDeletes: true,
        reviewIdentity: change === 'setup' ? 'destination B' : 'destination A',
        resolutions: [{ table: 'Contacts', uuid: 'conflict', keep: 'mine',
          reviewToken: change === 'missing-token' ? '' : change === 'altered-token' ? 'altered' : reviewToken }],
      });
      assert.match(result.refused ?? '', /changed since it was reviewed/);
      assert.equal(JSON.stringify([rows(r.store), [...r.fm.records]]), before);
      assert.deepEqual(r.fm.calls, []);
    } finally { cleanup(r); }
  });
}

for (const choice of ['push-create', 'push-update', 'push-delete', 'pull-create', 'pull-update', 'pull-delete'] as const) {
  test(`review binding refuses a local change during layout metadata before ${choice}`, async () => {
    const r = rig();
    try {
      const local = r.store.create('Contacts', { uuid: 'x', Name: 'Original' });
      const remote = r.fm.seed('x', { Name: 'Original' });
      await r.run();
      r.store.update('Contacts', local.recordId, { Name: 'Mine' });
      remote.fields.Name = 'Theirs'; remote.modId++;
      if (choice === 'push-delete' || choice === 'pull-create') r.store.delete('Contacts', local.recordId);
      if (choice === 'push-create' || choice === 'pull-delete') r.fm.records.delete(remote.recordId);
      const review = await r.run({ write: false });
      r.fm.calls = [];
      let before = '';
      r.fm.writableFields = async () => {
        await Promise.resolve();
        if (choice === 'push-delete' || choice === 'pull-create') r.store.create('Contacts', { uuid: 'x', Name: 'Restored' });
        else r.store.update('Contacts', local.recordId, { Name: 'Newer edit' });
        before = JSON.stringify([rows(r.store), [...r.fm.records]]);
        return r.fm.writable;
      };
      const result = await r.run({ write: true, pull: true, allowDeletes: true, resolutions: [
        { table: 'Contacts', uuid: 'x', keep: choice.startsWith('push') ? 'mine' : 'theirs', reviewToken: review.plans[0].conflicts[0].reviewToken! },
      ] });
      assert.match(result.refused ?? '', /changed since it was reviewed/);
      assert.equal(JSON.stringify([rows(r.store), [...r.fm.records]]), before);
      assert.deepEqual(r.fm.calls, []);
    } finally { cleanup(r); }
  });
}

for (const stage of ['delete-preflight', 'earlier-create', 'earlier-readback', 'earlier-update', 'earlier-delete'] as const) {
  test(`review binding refuses a restored local deletion during ${stage}`, async () => {
    const r = rig();
    try {
      const local = r.store.create('Contacts', { uuid: 'z', Name: 'Original' });
      const remote = r.fm.seed('z', { Name: 'Original' });
      const earlier = stage === 'earlier-update' || stage === 'earlier-delete' ? r.store.create('Contacts', { uuid: 'a', Name: 'A' }) : undefined;
      if (earlier) r.fm.seed('a', { Name: 'A' });
      await r.run();
      r.store.delete('Contacts', local.recordId);
      remote.fields.Name = 'Theirs'; remote.modId++;
      if (stage === 'earlier-create' || stage === 'earlier-readback') r.store.create('Contacts', { uuid: 'a', Name: 'A' });
      if (stage === 'earlier-update') r.store.update('Contacts', earlier!.recordId, { Name: 'New A' });
      if (stage === 'earlier-delete') r.store.delete('Contacts', earlier!.recordId);
      const review = await r.run({ write: false });
      r.fm.calls = [];
      const restore = async () => { await Promise.resolve(); r.store.create('Contacts', { uuid: 'z', Name: 'Restored' }); };
      const read = r.fm.read.bind(r.fm);
      const create = r.fm.create.bind(r.fm);
      const update = r.fm.update.bind(r.fm);
      const remove = r.fm.delete.bind(r.fm);
      if (stage === 'delete-preflight' || stage === 'earlier-readback') r.fm.read = async (layout, id) => {
        const result = await read(layout, id);
        if (stage === 'earlier-readback' || id === remote.recordId) await restore();
        return result;
      };
      if (stage === 'earlier-create') r.fm.create = async (...args) => { const result = await create(...args); await restore(); return result; };
      if (stage === 'earlier-update') r.fm.update = async (...args) => { const result = await update(...args); await restore(); return result; };
      if (stage === 'earlier-delete') r.fm.delete = async (...args) => { await remove(...args); await restore(); };
      const result = await r.run({ write: true, allowDeletes: true, resolutions: [
        { table: 'Contacts', uuid: 'z', keep: 'mine', reviewToken: review.plans[0].conflicts[0].reviewToken! },
      ] });
      assert.match(result.refused ?? '', /changed since it was reviewed/);
      assert.equal(r.fm.byUuid('z')!.fields.Name, 'Theirs');
      assert.equal(rows(r.store).find((r) => r.uuid === 'z')!.Name, 'Restored');
      assert.equal(r.fm.calls.some((c) => c === 'delete z'), false);
      assert.equal(r.log().some((row) => row.status === 'attempt'), false, 'completed writes and the refused preflight have final audit outcomes');
      assert.equal(result.tables[0].created + result.tables[0].updated + result.tables[0].deleted, stage === 'delete-preflight' ? 0 : 1);
    } finally { cleanup(r); }
  });
}

for (const stage of ['delete-preflight', 'earlier-update', 'earlier-readback'] as const) {
  test(`review binding records rejected ${stage} before refusing a stale choice`, async () => {
    const r = rig();
    try {
      const local = r.store.create('Contacts', { uuid: 'z', Name: 'Original' });
      const remote = r.fm.seed('z', { Name: 'Original' });
      const earlier = stage === 'earlier-update' ? r.store.create('Contacts', { uuid: 'a', Name: 'A' }) : undefined;
      if (earlier) r.fm.seed('a', { Name: 'A' });
      await r.run();
      r.store.delete('Contacts', local.recordId);
      remote.fields.Name = 'Theirs'; remote.modId++;
      if (stage === 'earlier-readback') r.store.create('Contacts', { uuid: 'a', Name: 'A' });
      if (earlier) r.store.update('Contacts', earlier.recordId, { Name: 'New A' });
      const review = await r.run({ write: false });
      r.fm.calls = [];
      const reject = async () => {
        await Promise.resolve();
        r.store.create('Contacts', { uuid: 'z', Name: 'Restored' });
        throw new SyncWriteError('request rejected', '301', true);
      };
      if (stage === 'earlier-update') r.fm.update = reject;
      else r.fm.read = reject;
      const result = await r.run({ write: true, allowDeletes: true, resolutions: [
        { table: 'Contacts', uuid: 'z', keep: 'mine', reviewToken: review.plans[0].conflicts[0].reviewToken! },
      ] });
      assert.match(result.refused ?? '', /changed since it was reviewed/);
      const log = readSyncLog(r.store, { runId: result.runId });
      assert.equal(log.some((row) => row.status === 'attempt'), false, 'every attempted operation has a final outcome');
      assert.deepEqual(result.tables[0].failed, [{ uuid: stage === 'delete-preflight' ? 'z' : 'a', op: stage === 'delete-preflight' ? 'delete' : stage === 'earlier-update' ? 'update' : 'create', error: 'request rejected' }]);
      assert.equal(r.fm.byUuid('z')!.fields.Name, 'Theirs');
      if (stage === 'earlier-readback') {
        assert.equal(result.tables[0].created, 1, 'the acknowledged create is counted despite failed verification');
        const made = r.fm.byUuid('a')!;
        const mapped = readSyncMap(r.store, 'Local\u0000Contacts').find((m) => m.uuid === 'a')!;
        assert.equal(mapped.remoteRecordId, made.recordId);
        assert.equal(mapped.lastRemoteModId, String(made.modId));
        const row = log.find((row) => row.op === 'create')!;
        assert.equal(row.status, 'ok');
        assert.equal(row.remoteRecordId, made.recordId);
        assert.match(row.detail ?? '', /readback/i);
        r.fm.calls = [];
        const again = await r.run({ resolve: 'tabularius-wins', allowDeletes: true });
        assert.match(again.tables[0].skipped ?? '', /held by an earlier run/);
        assert.deepEqual(r.fm.calls, [], 'unverified UUIDs require attention before more writes');
      } else {
        assert.equal(log.find((row) => row.uuid !== null)?.status, 'failed');
      }
    } finally { cleanup(r); }
  });
}

test('a rejected create readback preserves the acknowledged write and stops further writes without a stale review', async () => {
  const r = rig();
  try {
    r.store.create('Contacts', { uuid: 'a', Name: 'A' });
    r.store.create('Contacts', { uuid: 'b', Name: 'B' });
    r.fm.read = async () => { throw new SyncWriteError('readback rejected', '301', true); };
    const result = await r.run();
    assert.equal(result.refused, undefined);
    assert.match(result.stopped ?? '', /readback rejected/);
    assert.equal(result.tables[0].created, 1);
    assert.deepEqual(r.fm.calls, ['create a']);
    assert.deepEqual(result.tables[0].failed, [{ uuid: 'a', op: 'create', error: 'readback rejected' }]);
    const mapped = readSyncMap(r.store, 'Local\u0000Contacts').find((m) => m.uuid === 'a')!;
    assert.equal(mapped.remoteRecordId, r.fm.byUuid('a')!.recordId);
    const row = readSyncLog(r.store, { runId: result.runId }).find((row) => row.op === 'create')!;
    assert.equal(row.status, 'ok');
    assert.equal(row.remoteRecordId, mapped.remoteRecordId);
    assert.match(row.detail ?? '', /UUID readback failed/);
    assert.equal(r.log().some((row) => row.status === 'attempt'), false);
    r.fm.calls = [];
    const again = await r.run();
    assert.match(again.tables[0].skipped ?? '', /held by an earlier run/);
    assert.deepEqual(r.fm.calls, []);
  } finally { cleanup(r); }
});

// --- container uploads that a run did not finish --------------------------------------------------------------
// A "kill" is the process ending between FileMaker's answers: a sticky throw from assertWritable that unwinds past the
// uploads, so nothing after the point is recorded. The restart is a new Store on the same file and a fresh run.

const bytes = (text: string) => ({ filename: `${text}.txt`, mime: 'text/plain', data: Buffer.from(text) });
const pendingRows = (s: Store) => s.sql.prepare('SELECT uuid, field FROM _fm_sync_container_pending ORDER BY uuid, field').all() as { uuid: string; field: string }[];
const owedFields = (s: Store) => pendingRows(s).map((x) => `${x.uuid}:${x.field}`);
const withFiles = (r: Rig, uuid: string, files: Record<string, string> = { Photo: 'photo bytes', Scan: 'scan bytes' }): number => {
  const made = r.store.create('Contacts', { uuid, Name: 'Ann' });
  for (const [field, text] of Object.entries(files)) r.store.setContainer('Contacts', made.recordId, field, 1, bytes(text));
  return made.recordId;
};
type Kill = { start: number } | { done: number };
const killAt = (r: Rig, at: Kill) => {
  let dead = false;
  r.fm.onUpload = (phase, n) => { if ('start' in at ? phase === 'start' && n === at.start : phase === 'done' && n === at.done) dead = true; };
  return () => { if (dead) throw new Error('killed'); };
};
const containers = { maxBytes: 1024 };
const killed = (r: Rig, at: Kill, o: Partial<Parameters<typeof applySync>[5]> = {}) =>
  assert.rejects(r.run({ containers, assertWritable: killAt(r, at), ...o }), /killed/);
const restart = (r: Rig): void => { r.store.close(); r.store = new Store(join(r.dir, 'Local.sqlite'), 'Local'); r.fm.onUpload = undefined; };
const again = (r: Rig, o: Partial<Parameters<typeof applySync>[5]> = {}) => applySync(r.store, 'Local', [config], r.fm, r.fm, { write: true, containers, ...o });
const sentFields = (r: Rig) => r.fm.uploads.map((u) => `${u.uuid}:${u.field}`).sort();

for (const [name, at] of [['before the first upload', { start: 0 }], ['between the two uploads', { start: 1 }], ['after the last upload', { done: 2 }]] as [string, Kill][]) {
  test(`a created record's two container files are all sent once after a kill ${name}`, async () => {
    const r = rig(true);
    try {
      withFiles(r, 'u1');
      r.fm.enableFetch();
      await killed(r, at);
      assert.equal(r.fm.records.size, 1);
      assert.deepEqual(owedFields(r.store), ['u1:Photo', 'u1:Scan']);
      restart(r);
      const res = await again(r);
      assert.equal(res.stopped, undefined);
      assert.equal(r.fm.records.size, 1);
      assert.ok(r.fm.byUuid('u1')!.fields.Photo && r.fm.byUuid('u1')!.fields.Scan);
      assert.deepEqual(sentFields(r), ['u1:Photo', 'u1:Scan']);
      assert.deepEqual(pendingRows(r.store), []);
      // Nothing is left to do, and nothing is done.
      r.fm.calls.length = 0;
      await again(r);
      assert.deepEqual(r.fm.calls, []);
      assert.equal(r.fm.uploads.length, 2);
    } finally { cleanup(r); }
  });
}

test('an updated record keeps its owed container files across a kill after its fields were sent', async () => {
  const r = rig(true);
  try {
    const known = r.store.create('Contacts', { uuid: 'u1', Name: 'Ann' });
    r.fm.seed('u1', { Name: 'Ann' });
    r.fm.enableFetch();
    await r.run({ containers });
    r.store.update('Contacts', known.recordId, { Name: 'Annie' });
    r.store.setContainer('Contacts', known.recordId, 'Photo', 1, bytes('photo bytes'));
    r.store.setContainer('Contacts', known.recordId, 'Scan', 1, bytes('scan bytes'));
    await killed(r, { start: 0 });
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'Annie');
    assert.deepEqual(owedFields(r.store), ['u1:Photo', 'u1:Scan']);
    restart(r);
    await again(r);
    assert.equal(r.fm.calls.filter((c) => c.startsWith('update')).length, 1);
    assert.deepEqual(sentFields(r), ['u1:Photo', 'u1:Scan']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('several records: the one cut off resumes, the ones not reached are made, none is sent twice', async () => {
  const r = rig();
  try {
    for (const u of ['u1', 'u2', 'u3']) withFiles(r, u, { Photo: `${u} photo` });
    r.fm.enableFetch();
    await killed(r, { start: 1 });
    assert.equal(r.fm.records.size, 2);
    assert.deepEqual(owedFields(r.store), ['u2:Photo']);
    restart(r);
    await again(r);
    assert.equal(r.fm.records.size, 3);
    assert.deepEqual(sentFields(r), ['u1:Photo', 'u2:Photo', 'u3:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a record FileMaker dropped while its files were owed takes the owed rows with it', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    await killed(r, { start: 0 });
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    r.fm.records.delete(r.fm.byUuid('u1')!.recordId);
    restart(r);
    await again(r, { pull: true, allowDeletes: true });
    assert.deepEqual(rows(r.store), []);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a record deleted here while its files were owed is not sent its files', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    await killed(r, { start: 0 });
    r.store.delete('Contacts', id);
    restart(r);
    await again(r);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(r.fm.uploads.length, 0);
    assert.equal(r.fm.records.size, 1);
  } finally { cleanup(r); }
});

test('files owed to a record FileMaker changed meanwhile do not send the old copy of its fields over the edit', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Name = 'EditedOnFM';
    theirs.modId++;
    restart(r);
    r.fm.calls.length = 0;
    await again(r, { pull: true });
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'EditedOnFM');
    assert.deepEqual(r.fm.calls.filter((c) => c.startsWith('update')), []);
    assert.equal(rows(r.store)[0].Name, 'EditedOnFM');
    // The record is pulled first: its files wait for the next run.
    assert.equal(r.fm.uploads.length, 0);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    // The edit is in, so the files owed go next, and the edit stays.
    await again(r, { pull: true });
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'EditedOnFM');
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('files owed to a record FileMaker edited are left alone by a run that does not pull', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Name = 'EditedOnFM';
    theirs.modId++;
    restart(r);
    r.fm.calls.length = 0;
    await again(r);
    assert.deepEqual(r.fm.calls, []);
    assert.equal(r.fm.uploads.length, 0);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'EditedOnFM');
  } finally { cleanup(r); }
});

test('a retry sends no field, even one that differs from FileMaker without this side having saved it', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    restart(r);
    // A value changed underneath the bookkeeping (no new modId): not a save, so not something to send.
    r.store.sql.prepare('UPDATE "Contacts" SET "Name" = ? WHERE _fm_record_id = ?').run('Raw', id);
    r.fm.calls.length = 0;
    await again(r);
    assert.deepEqual(r.fm.calls.filter((c) => c.startsWith('update')), []);
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'Ann');
    assert.deepEqual(sentFields(r), ['u1:Photo']);
  } finally { cleanup(r); }
});

test('an update whose answer was lost after FileMaker applied it still owes its files', async () => {
  const r = rig();
  try {
    const known = r.store.create('Contacts', { uuid: 'u1', Name: 'Ann' });
    r.fm.seed('u1', { Name: 'Ann' });
    r.fm.enableFetch();
    await r.run({ containers });
    r.store.update('Contacts', known.recordId, { Name: 'Annie' });
    r.store.setContainer('Contacts', known.recordId, 'Photo', 1, bytes('photo bytes'));
    r.fm.failWrite = { n: 1, error: () => new Error('connection reset'), afterApplying: true };
    const first = await r.run({ containers }).catch((e: Error) => ({ stopped: e.message }));
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'Annie');
    assert.equal(r.fm.uploads.length, 0);
    assert.ok((first as { stopped?: string }).stopped);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
  } finally { cleanup(r); }
});

test('a file FileMaker refuses for its record is reported, and is no longer owed', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    r.fm.uploadFailure = new SyncWriteError('the field is not on the layout (error 102)', '102', true);
    const res = await r.run({ containers });
    assert.equal(res.stopped, undefined);
    assert.equal(r.fm.uploads.length, 1);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('an owed file that is missing here is reported, and is no longer owed', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    r.store.sql.prepare('UPDATE _fm_containers SET external = ? WHERE id = ?').run('gone/missing.bin', Number(rows(r.store)[0].Photo));
    restart(r);
    await again(r);
    assert.equal(r.fm.uploads.length, 0);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a pull that finds a file still owed to FileMaker neither empties nor replaces it: the file is sent after the pull', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Name = 'EditedOnFM';
    theirs.modId++;
    restart(r);
    await again(r, { pull: true });
    assert.equal(rows(r.store)[0].Name, 'EditedOnFM');
    assert.ok(Number(rows(r.store)[0].Photo) > 0, 'the file owed was kept');
    assert.equal(r.store.container(Number(rows(r.store)[0].Photo))?.filename, 'photo bytes.txt');
    assert.equal(id, rows(r.store)[0]._fm_record_id);
    await again(r, { pull: true });
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
    assert.ok(Number(rows(r.store)[0].Photo) > 0);
    assert.equal(rows(r.store)[0].Name, 'EditedOnFM');
  } finally { cleanup(r); }
});

test('a run that pulls, after a kill between two uploads, keeps the file not yet sent', async () => {
  const r = rig(true);
  try {
    withFiles(r, 'u1');
    r.fm.enableFetch();
    await killed(r, { start: 1 });
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(owedFields(r.store), ['u1:Photo', 'u1:Scan']);
    restart(r);
    // FileMaker's modId moved with the upload, so the record is found changed there, and its Scan reads as empty.
    const res = await again(r, { pull: true });
    assert.equal(res.stopped, undefined);
    assert.ok(Number(rows(r.store)[0].Scan) > 0, 'the file owed was not emptied by the pull');
    assert.deepEqual(sentFields(r), ['u1:Photo', 'u1:Scan']);
    assert.deepEqual(pendingRows(r.store), []);
    assert.ok(r.fm.byUuid('u1')!.fields.Scan);
  } finally { cleanup(r); }
});

test('a record FileMaker only touched, with a file owed, is not pulled over it and gets its file', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    r.fm.byUuid('u1')!.modId++;
    restart(r);
    await again(r, { pull: true });
    assert.ok(Number(rows(r.store)[0].Photo) > 0);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a record FileMaker only touched, with a file owed, is sent its file by a run that does not pull, and is not left as a pull waiting', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    r.fm.byUuid('u1')!.modId++;
    restart(r);
    const res = await again(r);
    assert.equal(res.tables[0].pendingPulls, 0);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a retry does not take FileMaker\'s baseline over a change a later pull must bring', async () => {
  const r = rig(true);
  try {
    // Amount is one FileMaker computes: not writable on the layout, so never sent and only ever pulled.
    r.fm.writable.delete('Amount');
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const known = readSyncMap(r.store, 'Local\u0000Contacts').find((m) => m.uuid === 'u1')!;
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Amount = '5';
    theirs.modId++;
    restart(r);
    await again(r);
    assert.equal(r.fm.uploads.length, 0, 'not retried while a change there is waiting for a pull');
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    assert.equal(readSyncMap(r.store, 'Local\u0000Contacts').find((m) => m.uuid === 'u1')!.lastRemoteModId, known.lastRemoteModId);
    await again(r, { pull: true });
    assert.equal(Number(rows(r.store)[0].Amount), 5);
    await again(r, { pull: true });
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a retry is left for the pull when FileMaker changed another container meanwhile', async () => {
  const r = rig(true);
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    r.fm.hold('container-theirs', Buffer.from('their scan'));
    theirs.fields.Scan = 'container-theirs';
    theirs.modId++;
    restart(r);
    await again(r);
    assert.equal(r.fm.uploads.length, 0);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    await again(r, { pull: true });
    assert.equal(r.store.container(Number(rows(r.store)[0].Scan))?.data.length, 'their scan'.length);
    assert.ok(Number(rows(r.store)[0].Photo) > 0);
  } finally { cleanup(r); }
});

test('an owed file replaces the one FileMaker holds for the same field when they differ (this side\'s file wins until sent)', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    r.fm.hold('container-theirs', Buffer.from('another file'));
    theirs.fields.Photo = 'container-theirs';
    theirs.modId++;
    restart(r);
    const res = await again(r);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.notEqual(r.fm.byUuid('u1')!.fields.Photo, 'container-theirs');
    assert.deepEqual(pendingRows(r.store), []);
    // The file it replaced is said so, with its size.
    assert.match(res.tables[0].containers.skipped.map((x) => x.reason).join(), /replaced a different file FileMaker held \(12 bytes/);
    // What it sent is FileMaker's version now: the next run finds nothing to adopt or pull.
    const next = await again(r, { pull: true });
    assert.deepEqual([next.tables[0].adopted, next.tables[0].pulled.updated], [0, 0]);
  } finally { cleanup(r); }
});

test('a retry that cannot compare FileMaker\'s file with its own says it was sent without comparing', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Photo = 'container-theirs';
    theirs.modId++;
    r.fm.fetchSkipped = 'too big';
    restart(r);
    const res = await again(r);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.match(res.tables[0].containers.skipped.map((x) => x.reason).join(), /sent without comparing it with the one FileMaker holds: too big/);
  } finally { cleanup(r); }
});

test('a record settled for FileMaker gives up the files it owed, and takes FileMaker\'s file', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    r.fm.hold('container-theirs', Buffer.from('their file'));
    theirs.fields.Photo = 'container-theirs';
    theirs.fields.Name = 'EditedOnFM';
    theirs.modId++;
    restart(r);
    r.store.update('Contacts', id, { Name: 'EditedHere' });
    const res = await again(r, { pull: true, resolve: 'filemaker-wins' });
    assert.equal(res.stopped, undefined);
    assert.equal(r.fm.uploads.length, 0);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(rows(r.store)[0].Name, 'EditedOnFM');
    assert.equal(r.store.container(Number(rows(r.store)[0].Photo))?.data.length, 'their file'.length);
    assert.match(res.tables[0].containers.skipped.map((x) => x.reason).join(), /FileMaker's file \(10 bytes\) replaced the file here that was owed to it/);
  } finally { cleanup(r); }
});

test('a record in use (301) keeps its owed file for the next run; a refusal that will not change is forgotten', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    r.fm.uploadFailure = new SyncWriteError('Record is in use (error 301)', '301', true);
    const first = await r.run({ containers });
    assert.equal(first.stopped, undefined);
    assert.deepEqual(first.tables[0].failed.map((x) => x.op), ['container'], 'counted as failed while it is tried again');
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    const second = await again(r);
    assert.deepEqual(second.tables[0].failed, []);
    assert.deepEqual(sentFields(r), ['u1:Photo', 'u1:Photo']);
    assert.ok(r.fm.byUuid('u1')!.fields.Photo);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('after a kill that landed after the upload, a run that pulls nothing leaves no false conflict on the next local edit', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { done: 1 });
    restart(r);
    await again(r);
    assert.equal(r.fm.uploads.length, 1);
    assert.deepEqual(pendingRows(r.store), []);
    r.store.update('Contacts', id, { Name: 'Annie' });
    const res = await again(r);
    assert.equal(res.refused, undefined);
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'Annie');
  } finally { cleanup(r); }
});

test('a record settled for FileMaker whose file field is empty there keeps the file owed here, and sends it after', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Name = 'EditedOnFM';
    theirs.modId++;
    restart(r);
    r.store.update('Contacts', id, { Name: 'EditedHere' });
    const res = await again(r, { pull: true, resolve: 'filemaker-wins' });
    assert.equal(rows(r.store)[0].Name, 'EditedOnFM');
    assert.ok(Number(rows(r.store)[0].Photo) > 0, 'the file only this side holds is kept');
    assert.equal(res.tables[0].containers.cleared, 0);
    assert.match(res.tables[0].containers.skipped.map((x) => x.reason).join(), /whose field is empty: it is kept and sent/);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    assert.equal(r.fm.uploads.length, 0);
    await again(r);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a conflict settled for FileMaker by a run that does not pull keeps the files owed', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Name = 'EditedOnFM';
    theirs.modId++;
    restart(r);
    r.store.update('Contacts', id, { Name: 'EditedHere' });
    await again(r, { resolve: 'filemaker-wins' });
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    assert.equal(r.fm.uploads.length, 0);
    assert.ok(Number(rows(r.store)[0].Photo) > 0);
  } finally { cleanup(r); }
});

test('an owed file forgotten unsent (over the size limit) leaves FileMaker\'s newer file as a change for a pull', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const known = readSyncMap(r.store, 'Local\u0000Contacts').find((m) => m.uuid === 'u1')!;
    const theirs = r.fm.byUuid('u1')!;
    r.fm.hold('container-theirs', Buffer.from('their own file'));
    theirs.fields.Photo = 'container-theirs';
    theirs.modId++;
    restart(r);
    const res = await again(r, { containers: { maxBytes: 5 } });
    assert.match(res.tables[0].containers.skipped.map((x) => x.reason).join(), /over the 5-byte limit/);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(readSyncMap(r.store, 'Local\u0000Contacts').find((m) => m.uuid === 'u1')!.lastRemoteModId, known.lastRemoteModId);
    await again(r, { pull: true });
    assert.equal(r.store.container(Number(rows(r.store)[0].Photo))?.data.length, 'their own file'.length);
    assert.equal(r.fm.uploads.length, 0);
  } finally { cleanup(r); }
});

test('a record owing two files, one sent and one forgotten unsent while FileMaker holds a different one there, leaves that file for a pull', async () => {
  const r = rig(true);
  try {
    withFiles(r, 'u1', { Photo: 'p', Scan: 'scan bytes long' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    r.fm.hold('container-theirs', Buffer.from('their scan'));
    theirs.fields.Scan = 'container-theirs';
    theirs.modId++;
    restart(r);
    const res = await again(r, { containers: { maxBytes: 5 } });
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.match(res.tables[0].containers.skipped.map((x) => x.reason).join(), /over the 5-byte limit/);
    assert.deepEqual(pendingRows(r.store), []);
    await again(r, { pull: true });
    assert.equal(r.store.container(Number(rows(r.store)[0].Scan))?.data.length, 'their scan'.length);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
  } finally { cleanup(r); }
});

test('a record settled for FileMaker whose owed file is the same there is cleared of it by the pull', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { done: 1 });
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    r.fm.byUuid('u1')!.fields.Name = 'EditedOnFM';
    restart(r);
    r.store.update('Contacts', id, { Name: 'EditedHere' });
    const res = await again(r, { pull: true, resolve: 'filemaker-wins' });
    assert.equal(rows(r.store)[0].Name, 'EditedOnFM');
    assert.equal(res.tables[0].containers.unchanged, 1);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(r.fm.uploads.length, 1);
  } finally { cleanup(r); }
});

test('an owed file forgotten unsent where FileMaker holds no file is not a change left for a pull', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    r.fm.byUuid('u1')!.modId++;
    restart(r);
    await again(r, { containers: { maxBytes: 5 } });
    assert.deepEqual(pendingRows(r.store), []);
    const next = await again(r, { pull: true });
    assert.equal(next.tables[0].containers.cleared, 0);
    assert.ok(Number(rows(r.store)[0].Photo) > 0, 'the local file is not emptied by a pull of FileMaker\'s empty field');
  } finally { cleanup(r); }
});

/** A record owing Photo and Scan, with FileMaker's Scan replaced, whose second run sent nothing (the Photo upload was refused as in use) and forgot Scan. */
async function forgottenScan(): Promise<Rig> {
  const r = rig(true);
  withFiles(r, 'u1', { Photo: 'p', Scan: 'scan bytes long' });
  r.fm.enableFetch();
  await killed(r, { start: 0 });
  const theirs = r.fm.byUuid('u1')!;
  r.fm.hold('container-theirs', Buffer.from('their scan'));
  theirs.fields.Scan = 'container-theirs';
  theirs.modId++;
  restart(r);
  r.fm.uploadFailure = new SyncWriteError('Record is in use (error 301)', '301', true);
  await again(r, { containers: { maxBytes: 5 } });
  assert.deepEqual(owedFields(r.store), ['u1:Photo']);
  return r;
}

test('a Scan forgotten unsent while the Photo upload failed is brought by a pull, not overwritten by the next retry', async () => {
  const r = await forgottenScan();
  try {
    await again(r, { pull: true });
    assert.equal(r.store.container(Number(rows(r.store)[0].Scan))?.data.length, 'their scan'.length);
    assert.equal(r.fm.byUuid('u1')!.fields.Scan, 'container-theirs');
    assert.ok(!sentFields(r).includes('u1:Scan'));
    await again(r, { pull: true });
    assert.deepEqual(pendingRows(r.store), []);
    assert.ok(r.fm.byUuid('u1')!.fields.Photo);
  } finally { cleanup(r); }
});

test('a Scan forgotten unsent while the Photo upload failed stays a change for a pull after the Photo goes', async () => {
  const r = await forgottenScan();
  try {
    await again(r, { pull: true, containers: { maxBytes: 5 } });
    await again(r, { pull: true });
    assert.equal(r.store.container(Number(rows(r.store)[0].Scan))?.data.length, 'their scan'.length);
    assert.ok(!sentFields(r).includes('u1:Scan'));
  } finally { cleanup(r); }
});

test('an ordinary update that leaves a file unsent is recorded at the version after its own write, not the one read', async () => {
  const r = rig(true);
  try {
    const known = r.store.create('Contacts', { uuid: 'u1', Name: 'Ann' });
    r.fm.seed('u1', { Name: 'Ann' });
    r.fm.enableFetch();
    await r.run({ containers });
    r.store.update('Contacts', known.recordId, { Name: 'Annie' });
    r.store.setContainer('Contacts', known.recordId, 'Scan', 1, bytes('scan bytes long'));
    r.fm.hold('container-theirs', Buffer.from('their scan'));
    r.fm.byUuid('u1')!.fields.Scan = 'container-theirs';
    r.store.sql.prepare('INSERT INTO _fm_sync_container_pending (table_key, uuid, field) VALUES (?, ?, ?)').run('Local\u0000Contacts', 'u1', 'Scan');
    await again(r, { containers: { maxBytes: 5 } });
    assert.equal(r.fm.byUuid('u1')!.fields.Name, 'Annie');
    const next = await again(r);
    assert.equal(next.tables[0].pendingPulls, 0);
  } finally { cleanup(r); }
});

test('a retry through a connection that cannot fetch files says the file was sent without comparing', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    await killed(r, { start: 0 });
    const theirs = r.fm.byUuid('u1')!;
    theirs.fields.Photo = 'container-theirs';
    theirs.modId++;
    restart(r);
    const res = await again(r);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.match(res.tables[0].containers.skipped.map((x) => x.reason).join(), /sent without comparing it with the one FileMaker holds: this connection can't fetch it/);
  } finally { cleanup(r); }
});

test('a push with nothing to send but a file that agrees clears what was owed for it', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await r.run({ containers });
    assert.equal(r.fm.uploads.length, 1);
    // A save here that changes no value, and a file owed from an earlier run that did land.
    r.store.update('Contacts', id, { Name: 'X' });
    r.store.update('Contacts', id, { Name: 'Ann' });
    r.store.sql.prepare('INSERT INTO _fm_sync_container_pending (table_key, uuid, field) VALUES (?, ?, ?)').run('Local\u0000Contacts', 'u1', 'Photo');
    r.fm.calls.length = 0;
    await again(r);
    assert.deepEqual(r.fm.calls, []);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a create whose answer was lost after FileMaker made the record still owes its files', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    r.fm.failWrite = { n: 1, error: () => new Error('connection reset'), afterApplying: true };
    const first = await r.run({ containers }).catch((e: Error) => ({ stopped: e.message }));
    assert.ok((first as { stopped?: string }).stopped);
    assert.equal(r.fm.records.size, 1);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
  } finally { cleanup(r); }
});

test('an owed field that is no longer writable on the layout is dropped, not kept', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    restart(r);
    r.fm.writable.delete('Photo');
    await again(r);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(r.fm.uploads.length, 0);
  } finally { cleanup(r); }
});

test('an owed file whose container row is gone here is dropped, and nothing is sent for it', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    r.store.sql.prepare('DELETE FROM _fm_containers WHERE id = ?').run(Number(rows(r.store)[0].Photo));
    restart(r);
    await again(r);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(r.fm.uploads.length, 0);
  } finally { cleanup(r); }
});

test('a retry sends only the files: it sends no fields and does not need the record unchanged here', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    restart(r);
    r.fm.calls.length = 0;
    await again(r);
    assert.deepEqual(r.fm.calls.filter((c) => c.startsWith('update')), []);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
  } finally { cleanup(r); }
});

test('a record made on FileMaker whose readback failed still gets its owed files once the table is released', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    r.fm.failNextRead = true;
    const first = await r.run({ containers });
    assert.match(first.stopped ?? '', /readback failed/);
    assert.equal(r.fm.records.size, 1);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    restart(r);
    assert.equal(releaseHeldTables(r.store, 'Local', [config]), 1);
    await again(r);
    assert.equal(r.fm.records.size, 1);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
    assert.deepEqual(pendingRows(r.store), []);
  } finally { cleanup(r); }
});

test('a kill after FileMaker made the record but before its answer was read still sends the files', async () => {
  const r = rig();
  try {
    withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    // The create has been applied when the connection is asked to read the new record back; the process ends there.
    let dead = false;
    r.fm.failNextRead = false;
    const read = r.fm.read.bind(r.fm);
    r.fm.read = async (layout: string, recordId: string) => { dead = true; return read(layout, recordId); };
    await assert.rejects(r.run({ containers, assertWritable: () => { if (dead) throw new Error('killed'); } }), /killed/);
    assert.equal(r.fm.records.size, 1);
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    restart(r);
    r.fm.read = read;
    // The record FileMaker made is found again by its uuid and not called a conflict (it holds no files, and one is owed).
    const res = await again(r);
    assert.equal(res.refused, undefined);
    assert.equal(res.stopped, undefined);
    assert.equal(r.fm.records.size, 1);
    assert.deepEqual(sentFields(r), ['u1:Photo']);
  } finally { cleanup(r); }
});

test('owed rows that can no longer be sent are dropped, and a retry with nothing to send sends and logs nothing', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { start: 0 });
    // A field that is no longer one the run sends, and a file now over the size limit.
    r.store.sql.prepare('INSERT INTO _fm_sync_container_pending (table_key, uuid, field) VALUES (?, ?, ?)').run('Local\u0000Contacts', 'u1', 'Gone');
    restart(r);
    r.fm.calls.length = 0;
    const res = await again(r, { containers: { maxBytes: 5 } });
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(res.tables[0].adopted, 0);
    assert.deepEqual(r.fm.calls, []);
    assert.deepEqual(readSyncLog(r.store, { runId: res.runId }).map((l) => l.status), ['started', 'finished']);
    // Emptied here: no longer owed either.
    r.store.sql.prepare('INSERT INTO _fm_sync_container_pending (table_key, uuid, field) VALUES (?, ?, ?)').run('Local\u0000Contacts', 'u1', 'Photo');
    r.store.setContainer('Contacts', id, 'Photo', 1, null);
    const emptied = await again(r);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(emptied.tables[0].created + emptied.tables[0].updated, 0);
    assert.deepEqual(r.fm.uploads, []);
  } finally { cleanup(r); }
});

for (const how of ['a connection that cannot fetch files', 'a file too big to fetch']) {
  test(`a file already on FileMaker is sent again when ${how} cannot say it is the same`, async () => {
    const r = rig(true);
    try {
      withFiles(r, 'u1');
      if (how !== 'a connection that cannot fetch files') { r.fm.enableFetch(); r.fm.fetchSkipped = 'too big'; }
      await killed(r, { start: 1 });
      assert.deepEqual(sentFields(r), ['u1:Photo']);
      restart(r);
      await again(r);
      // Photo cannot be compared, so it goes again; Scan goes for the first time; nothing stays owed.
      assert.deepEqual(sentFields(r), ['u1:Photo', 'u1:Photo', 'u1:Scan']);
      assert.deepEqual(pendingRows(r.store), []);
    } finally { cleanup(r); }
  });
}

test('an owed file already on FileMaker, in a record pushed for its fields, is cleared when the files agree', async () => {
  const r = rig();
  try {
    const id = withFiles(r, 'u1', { Photo: 'photo bytes' });
    r.fm.enableFetch();
    await killed(r, { done: 1 });
    assert.deepEqual(owedFields(r.store), ['u1:Photo']);
    restart(r);
    // A save here, settled in this side's favour: pushed with its fields, and the agreeing file is not sent again.
    r.store.update('Contacts', id, { Name: 'Ann Two' });
    const res = await again(r, { resolve: 'tabularius-wins' });
    assert.equal(res.tables[0].updated, 1);
    assert.deepEqual(pendingRows(r.store), []);
    assert.equal(r.fm.uploads.length, 1);
  } finally { cleanup(r); }
});
