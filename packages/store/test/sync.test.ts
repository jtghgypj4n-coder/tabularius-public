// Tier-2 live-sync DRY-RUN planner (research/export/tier2-live-sync.md). The
// planner works out what a sync would move without touching either side; these
// tests pin its change detection and — above all — its conflict rules, where
// the default must never silently overwrite. A fake RemoteSource stands in for
// a FileMaker Server Data API, so no network is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planTable, syncPlan, openForPlanning, ensureSyncTables, readSyncMap, missingPrereqs, importFmp12, Store,
  type TableSyncConfig, type LocalRecord, type RemoteRecord, type SyncMapEntry, type RemoteSource,
} from '../src/index.ts';

const baseConfig: TableSyncConfig = { localTable: 'T', remoteLayout: 'T', uuidField: 'uuid', modTimestampField: 'modts' };
const local = (uuid: string, modId: number, fields: Record<string, string> = {}): LocalRecord => ({ uuid, recordId: Number(uuid.replace(/\D/g, '')) || 1, modId, fields: { uuid, ...fields } });
const remote = (uuid: string, modId: string, fields: Record<string, string> = {}): RemoteRecord => ({ uuid, recordId: `r${uuid}`, modId, fields: { uuid, ...fields } });
const mapEntry = (e: Partial<SyncMapEntry> & { uuid: string }): SyncMapEntry => ({ localRecordId: null, lastLocalModId: null, remoteRecordId: null, lastRemoteModId: null, lastRemoteModTs: null, ...e });

test('planTable: new records push/pull by the side that has them', () => {
  const plan = planTable(baseConfig, [local('a', 1)], [remote('b', '1')], []);
  assert.deepEqual(plan.pushes.map((p) => [p.uuid, p.op]), [['a', 'create']]);
  assert.deepEqual(plan.pulls.map((p) => [p.uuid, p.op]), [['b', 'create']]);
  assert.equal(plan.conflicts.length, 0);
});

test('planTable: a one-sided change moves only that way', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 1, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  // Local bumped to modId 2, remote still at 5 → push. Then the reverse.
  const pushPlan = planTable(baseConfig, [local('a', 2)], [remote('a', '5')], map);
  assert.deepEqual(pushPlan.pushes.map((p) => [p.uuid, p.op]), [['a', 'update']]);
  assert.equal(pushPlan.pulls.length + pushPlan.conflicts.length, 0);

  const pullPlan = planTable(baseConfig, [local('a', 1)], [remote('a', '6')], map);
  assert.deepEqual(pullPlan.pulls.map((p) => [p.uuid, p.op]), [['a', 'update']]);
  assert.equal(pullPlan.pushes.length + pullPlan.conflicts.length, 0);
});

test('planTable: an unchanged record (modId matches the map) moves nothing', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 2, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  const plan = planTable(baseConfig, [local('a', 2)], [remote('a', '5')], map);
  assert.equal(plan.pushes.length + plan.pulls.length + plan.conflicts.length, 0);
});

test('planTable: local modification ids going backwards pause the table after a restore', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 8, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  const plan = planTable(baseConfig, [local('a', 3)], [remote('a', '5')], map);
  assert.equal(plan.paused, 'local modification ids went backwards; restored from backup?');
  assert.equal(plan.pushes.length + plan.pulls.length + plan.conflicts.length, 0);
});

test('planTable: default `flag` policy NEVER overwrites a both-sides change', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 1, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  const plan = planTable(baseConfig, [local('a', 2, { title: 'mine' })], [remote('a', '6', { title: 'theirs' })], map);
  assert.equal(plan.pushes.length, 0, 'flag must not push');
  assert.equal(plan.pulls.length, 0, 'flag must not pull');
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].policy, 'flag');
  assert.deepEqual(plan.conflicts[0].clashes, [{ field: 'title', local: 'mine', remote: 'theirs' }]);
});

test('planTable: a both-sides change with identical values is not a conflict', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 1, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  const plan = planTable(baseConfig, [local('a', 2, { title: 'same' })], [remote('a', '6', { title: 'same' })], map);
  assert.equal(plan.pushes.length + plan.pulls.length + plan.conflicts.length, 0);
});

test('planTable: filemaker-wins pulls, tabularius-wins pushes', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 1, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  const fm = planTable({ ...baseConfig, policy: 'filemaker-wins' }, [local('a', 2, { t: 'x' })], [remote('a', '6', { t: 'y' })], map);
  assert.deepEqual(fm.pulls.map((p) => p.uuid), ['a']);
  assert.equal(fm.pushes.length + fm.conflicts.length, 0);
  const tb = planTable({ ...baseConfig, policy: 'tabularius-wins' }, [local('a', 2, { t: 'x' })], [remote('a', '6', { t: 'y' })], map);
  assert.deepEqual(tb.pushes.map((p) => p.uuid), ['a']);
  assert.equal(tb.pulls.length + tb.conflicts.length, 0);
});

test('planTable: newer-wins orders by the modification timestamp, and flags a tie/unparsable', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 1, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  const cfg = { ...baseConfig, policy: 'newer-wins' as const };
  // Local stamp later than remote → push, and nothing else.
  const localNewer = planTable(cfg, [local('a', 2, { modts: '2026-10-13 12:00:00', t: 'x' })], [{ ...remote('a', '6', { t: 'y' }), modTimestamp: '2026-10-13 09:00:00' }], map);
  assert.deepEqual(localNewer.pushes.map((p) => p.uuid), ['a']);
  assert.equal(localNewer.pulls.length + localNewer.conflicts.length, 0);
  // Remote stamp later → pull, and nothing else.
  const remoteNewer = planTable(cfg, [local('a', 2, { modts: '2026-10-13 09:00:00', t: 'x' })], [{ ...remote('a', '6', { t: 'y' }), modTimestamp: '2026-10-13 12:00:00' }], map);
  assert.deepEqual(remoteNewer.pulls.map((p) => p.uuid), ['a']);
  assert.equal(remoteNewer.pushes.length + remoteNewer.conflicts.length, 0);
  // Equal stamps → flag (no silent coin-flip), and no overwrite.
  const tie = planTable(cfg, [local('a', 2, { modts: '2026-10-13 12:00:00', t: 'x' })], [{ ...remote('a', '6', { t: 'y' }), modTimestamp: '2026-10-13 12:00:00' }], map);
  assert.equal(tie.conflicts.length, 1);
  assert.equal(tie.pushes.length + tie.pulls.length, 0);
  // Missing stamp → flag.
  const missing = planTable(cfg, [local('a', 2, { t: 'x' })], [remote('a', '6', { t: 'y' })], map);
  assert.equal(missing.conflicts.length, 1);
  // A non-ISO stamp (FileMaker's native MM/DD/YYYY form) is NOT guessed at: it
  // is unorderable, so newer-wins falls back to flag rather than mis-ordering
  // across timezones. The remote adapter's job is to supply ISO timestamps.
  const slash = planTable(cfg, [local('a', 2, { modts: '10/13/2026 12:00:00', t: 'x' })], [{ ...remote('a', '6', { t: 'y' }), modTimestamp: '10/13/2026 09:00:00' }], map);
  assert.equal(slash.conflicts.length, 1);
  assert.equal(slash.pushes.length + slash.pulls.length, 0);
});

test('planTable: duplicate UUID keys pause the table instead of silently picking one', () => {
  const dupLocal = planTable(baseConfig, [local('a', 1), { ...local('a', 2), recordId: 2 }], [], []);
  assert.match(dupLocal.paused ?? '', /duplicate UUID/i);
  assert.equal(dupLocal.pushes.length + dupLocal.pulls.length + dupLocal.conflicts.length, 0);
  const dupRemote = planTable(baseConfig, [], [remote('a', '1'), { ...remote('a', '2'), recordId: 'ra2' }], []);
  assert.match(dupRemote.paused ?? '', /duplicate UUID/i);
});

test('planTable: local deletion pushes a delete; remote deletion needs the present-uuid set', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 2, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  // Local gone, remote still present and unchanged → push delete.
  const del = planTable(baseConfig, [], [remote('a', '5')], map);
  assert.deepEqual(del.pushes.map((p) => [p.uuid, p.op]), [['a', 'delete']]);
  // Remote gone: undetectable without the present set.
  const noSet = planTable(baseConfig, [local('a', 2)], [], map);
  assert.equal(noSet.pulls.length, 0, 'no remote-delete without the present-uuid set');
  // With the present set (a absent) → pull delete.
  const withSet = planTable(baseConfig, [local('a', 2)], [], map, { presentRemoteUuids: new Set() });
  assert.deepEqual(withSet.pulls.map((p) => [p.uuid, p.op]), [['a', 'delete']]);
});

test('planTable: a delete racing an edit on the other side is flagged, not applied', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 2, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  // Local deleted, remote changed since last sync → conflict.
  const localGone = planTable(baseConfig, [], [remote('a', '9')], map, { presentRemoteUuids: new Set(['a']) });
  assert.equal(localGone.conflicts.length, 1);
  assert.equal(localGone.pushes.length + localGone.pulls.length, 0);
  // The mirror: remote deleted, local changed since last sync → conflict.
  const remoteGone = planTable(baseConfig, [local('a', 9)], [], map, { presentRemoteUuids: new Set() });
  assert.equal(remoteGone.conflicts.length, 1);
  assert.equal(remoteGone.pushes.length + remoteGone.pulls.length, 0);
});

test('planTable: the same value written two ways is not a clash, and the timestamp field never is', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 1, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  // Both edited since the last sync, to the same values: a number as 5 and 5.0, a
  // timestamp with T and with a space, and each side's own modification stamp.
  const same = planTable(baseConfig,
    [{ ...local('a', 2, { at: '2026-10-13T12:00:00', modts: '2026-10-14T09:00:00' }), fields: { uuid: 'a', n: 5, at: '2026-10-13T12:00:00', modts: '2026-10-14T09:00:00' } }],
    [remote('a', '6', { n: '5.0', at: '2026-10-13 12:00:00', modts: '2026-10-14 10:30:00' })], map, { types: { n: 'number', at: 'timestamp' } });
  assert.equal(same.pushes.length + same.pulls.length + same.conflicts.length, 0);
  // A real difference is still caught, and the stamps are not listed with it.
  const differ = planTable(baseConfig,
    [local('a', 2, { n: '5', modts: '2026-10-14T09:00:00' })],
    [remote('a', '6', { n: '6', modts: '2026-10-14 10:30:00' })], map);
  assert.deepEqual(differ.conflicts[0].clashes, [{ field: 'n', local: '5', remote: '6' }]);
  // Text is compared as text: a zip code 007 is not 7, and text that starts with a timestamp is not that timestamp.
  const text = planTable(baseConfig,
    [local('a', 2, { zip: '007', note: '2026-10-13T12:00:00 called' })],
    [remote('a', '6', { zip: '7', note: '2026-10-13 12:00:00 called back' })], map, { types: { zip: 'text', note: 'text' } });
  assert.deepEqual(text.conflicts[0].clashes.map((c) => c.field), ['zip', 'note']);
  // Only a timestamp field's T and space are the same: in a text field they are different text.
  const textStamp = planTable(baseConfig, [local('a', 2, { note: '2026-10-13T12:00:00' })], [remote('a', '6', { note: '2026-10-13 12:00:00' })], map, { types: { note: 'text' } });
  assert.deepEqual(textStamp.conflicts[0].clashes.map((c) => c.field), ['note']);
  // FileMaker's returns are line feeds here; a container is an id here and a URL there, and doesn't sync.
  const shapes = planTable(baseConfig,
    [{ ...local('a', 2, { notes: 'one\ntwo' }), fields: { uuid: 'a', notes: 'one\ntwo', photo: 12 } }],
    [remote('a', '6', { notes: 'one\rtwo', photo: 'https://fms.example.com/Streaming_SSL/MainDB/1.jpg' })], map, { types: { notes: 'text', photo: 'container' } });
  assert.equal(shapes.conflicts.length, 0);
});

test('planTable: a FileMaker record made again under the same UUID counts as changed, even with the same modId', () => {
  const map = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 2, remoteRecordId: 'ra', lastRemoteModId: '5' })];
  const plan = planTable(baseConfig, [local('a', 2)], [{ ...remote('a', '5'), recordId: 'rb' }], map);
  assert.deepEqual(plan.pulls.map((p) => [p.uuid, p.op]), [['a', 'update']]);
});

test('planTable: a record the map knows on one side only is made on the other, not updated there', () => {
  const onlyHere = [mapEntry({ uuid: 'a', localRecordId: 1, lastLocalModId: 1 })];
  assert.deepEqual(planTable(baseConfig, [local('a', 2)], [], onlyHere).pushes.map((p) => [p.uuid, p.op]), [['a', 'create']]);
  const onlyThere = [mapEntry({ uuid: 'b', remoteRecordId: 'rb', lastRemoteModId: '1' })];
  assert.deepEqual(planTable(baseConfig, [], [remote('b', '2')], onlyThere).pulls.map((p) => [p.uuid, p.op]), [['b', 'create']]);
});

test('planTable: records with an empty UUID are left out and counted, not matched to each other', () => {
  const plan = planTable(baseConfig, [local('', 1), local('a', 1), local(' ', 1)], [remote('', '1'), remote('b', '1')], []);
  assert.equal(plan.paused, undefined, 'several empty keys are not duplicate keys');
  assert.deepEqual(plan.unkeyed, { local: 2, remote: 1 });
  assert.deepEqual(plan.pushes.map((p) => p.uuid), ['a']);
  assert.deepEqual(plan.pulls.map((p) => p.uuid), ['b']);
  assert.equal(planTable(baseConfig, [local('a', 1)], [], []).unkeyed, undefined);
});

// ---- Store-backed: prerequisites, and that a plan writes to NEITHER side ----

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const flicks = join(fixtures, 'Flicks.fmp12');
const skip = existsSync(flicks) ? false : 'fixtures missing: run npm run fixtures';

test('syncPlan over a real store: prerequisites, and nothing is written', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sync-'));
  try {
    importFmp12(flicks, join(dir, 'Flicks.sqlite'));
    const store = new Store(join(dir, 'Flicks.sqlite'));

    // Pick the first base table that has records and a text field to key on.
    const table = store.schema!.tables.find((t) => store.recordCount(t.name) > 0 && t.fields.some((f) => f.type === 'text'));
    assert.ok(table, 'expected a non-empty table with a text field in Flicks');
    const keyField = table!.fields.find((f) => f.type === 'text')!.name;

    // A table missing its UUID/modts fields comes back paused, naming them.
    const bogus: TableSyncConfig = { localTable: table!.name, remoteLayout: table!.name, uuidField: '___no_such_uuid___', modTimestampField: '___no_such_modts___' };
    assert.deepEqual(missingPrereqs(store, bogus).sort(), ['___no_such_modts___', '___no_such_uuid___']);

    const fake: RemoteSource & { reads: number } = {
      reads: 0,
      async changedSince() { this.reads++; return []; }, // the server has no changes
    };
    const config: TableSyncConfig = { localTable: table!.name, remoteLayout: table!.name, uuidField: keyField, modTimestampField: keyField };

    const before = store.recordCount(table!.name);
    const pausedPlans = await syncPlan(store, 'Flicks.fmp12', [bogus], fake);
    assert.match(pausedPlans[0].paused ?? '', /missing field/);

    const plans = await syncPlan(store, 'Flicks.fmp12', [config], fake);
    const plan = plans[0];
    assert.equal(plan.paused, undefined);
    // Empty map + no remote changes → every keyed local record is a "new locally" push.
    assert.ok(plan.pushes.length > 0, 'local records should plan as pushes');
    assert.ok(plan.pushes.every((p) => p.op === 'create'));
    assert.equal(plan.pulls.length, 0);
    assert.equal(plan.conflicts.length, 0);
    assert.ok(fake.reads > 0, 'the remote source was consulted');

    // The dry run writes NOTHING: record count unchanged, and it did not even
    // create its own bookkeeping tables (those are the apply/setup leg's job).
    assert.equal(store.recordCount(table!.name), before);
    const bookkeeping = (store.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('_fm_sync_map','_fm_sync_state')").get() as { n: number }).n;
    assert.equal(bookkeeping, 0, 'the dry run must not create bookkeeping tables');

    // ensureSyncTables is the explicit setup step that does create them; after it
    // the map reads back empty (planning recorded nothing in it).
    // The dry run's own way in can't write at all, and plans the same.
    const readOnly = openForPlanning(join(dir, 'Flicks.sqlite'));
    try {
      assert.throws(() => readOnly.sql.exec('CREATE TABLE _scratch (x)'), /readonly/i);
      const again = await syncPlan(readOnly, 'Flicks.fmp12', [config], fake);
      assert.deepEqual(again[0].pushes, plan.pushes);
    } finally {
      readOnly.close();
    }

    ensureSyncTables(store);
    assert.equal(readSyncMap(store, 'Flicks.fmp12\u0000' + table!.name).length, 0);

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
