// Each child exits without catch/finally, closing stores, or SQLite checkpoints.
// Keep these sequential: the stores have two records, and only conversion reads a fixture.
// The suite is split over crash-points-*.test.ts so each file stays well inside CI's per-file timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySync, createStore, importFmp12, Store, type RemoteRecord, type RemoteSource, type TableSyncConfig } from '../../store/src/index.ts';
import { backupFolder, backupSets, claimFolder, restoreAt, restoreBackup, restorePointTo, sweepCrashLeftovers } from '../src/backup.ts';
import { externalFiles, verifyExternal } from '../src/backup-external.ts';
import { Host, STORE_EXT } from '../src/host.ts';

const fixture = join(import.meta.dirname, '../../../fixtures/fmp12/Charts.fmp12');
const groups = {
  backup: ['external-after-file', 'external-after-manifest', 'seal-before', 'seal-after-encrypt', 'seal-after-publish', 'seal-after-remove', 'after-copy', 'after-verify', 'after-external', 'after-publish', 'after-prune'],
  restore: ['external-after-copy', 'external-after-verify', 'external-after-decrypt', 'after-copy', 'after-verify', 'after-external', 'after-journal', 'after-save', 'after-publish', 'after-commit', 'after-cleanup'],
  'restore-at': ['after-file', 'after-commit'],
  'restore-copy': ['mid-apply-log', 'after-copy', 'after-replay', 'after-verify', 'after-publish'],
  'restore-replace': ['mid-apply-log', 'after-copy', 'after-replay', 'after-verify', 'after-publish'],
  'containers-out': ['after-write', 'after-update', 'after-commit'],
  'containers-in': ['after-copy', 'after-commit', 'after-checkpoint', 'after-remove'],
  'design-apply': ['after-effect', 'after-schema', 'after-log', 'before-commit', 'after-commit'],
  compat: ['after-copy', 'after-drop', 'after-rename'],
  'host-conversion': ['after-workspace', 'after-convert', 'after-reserve', 'after-publish', 'after-cleanup'],
  'host-upload': ['mid-source-stage', 'mid-source-complete', 'after-convert', 'after-source-stage', 'after-reserve', 'after-store-publish', 'after-source-rename', 'after-cleanup'],
  'sync-apply': ['after-attempt', 'after-data', 'after-map', 'after-commit'],
} as const;
type Operation = keyof typeof groups;
const pathOf = (folder: string, name = 'A') => join(folder, name + STORE_EXT);
const config: TableSyncConfig = { localTable: 'Items', remoteLayout: 'Items', uuidField: 'uuid', modTimestampField: 'modts' };
const remote: RemoteSource = {
  changedSince: async () => [{ uuid: 'u1', recordId: '1', modId: '2', fields: { uuid: 'u1', Name: 'new', Other: 'new', modts: '' } } satisfies RemoteRecord],
  allUuids: async () => new Set(['u1']),
};
const writer = { writableFields: async () => new Set(['uuid', 'Name', 'Other']) };

function seed(folder: string, name = 'A', external = false): void {
  mkdirSync(folder, { recursive: true });
  createStore(pathOf(folder, name));
  const store = new Store(pathOf(folder, name), name);
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Other' }, { name: 'uuid' }, { name: 'modts' }, { name: 'Pic', type: 'container' }] }]);
    for (let i = 1; i <= 2; i++) {
      const id = store.create('Items', { Name: 'old', Other: 'old', uuid: 'u' + i }).recordId;
      store.setContainer('Items', id, 'Pic', 1, { filename: `p${i}.txt`, mime: 'text/plain', data: Buffer.from(`old-${i}`) });
    }
    if (external) {
      store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: 'Items/Pic/' } } }]);
      store.moveContainersOut('Items', 'Pic');
    }
  } finally { store.close(); }
}

function change(folder: string, name = 'A', log?: string, label = 'new'): void {
  const store = new Store(pathOf(folder, name), name);
  try {
    if (log) store.sql.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint = 0');
    for (let i = 1; i <= 2; i++) {
      store.update('Items', i, { Name: label, Other: label });
      store.setContainer('Items', i, 'Pic', 1, { filename: `p${i}.txt`, mime: 'text/plain', data: Buffer.from(`${label}-${i}`) });
    }
    if (log) writeFileSync(log, readFileSync(store.path + '-wal'));
  } finally { store.close(); }
}

function checkStore(store: Store): void {
  assert.deepEqual(store.sql.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check), ['ok']);
  assert.deepEqual(store.sql.prepare('PRAGMA foreign_key_check').all(), []);
}

function state(store: Store): string {
  checkStore(store);
  const rows = store.sql.prepare('SELECT Name, Other, Pic FROM Items ORDER BY _fm_record_id').all();
  const label = String(rows[0].Name);
  assert.ok(label === 'old' || label === 'new' || label === 'later');
  assert.equal(rows.length, 2);
  for (const [i, row] of rows.entries()) {
    assert.equal(row.Name, label);
    assert.equal(row.Other, label);
    assert.equal(Buffer.from(store.container(Number(row.Pic))!.data).toString(), `${label}-${i + 1}`);
  }
  return label;
}

function conversionState(store: Store): unknown {
  checkStore(store);
  return store.schema.tables.map((table) => ({
    name: table.name, fields: table.fields,
    rows: store.sql.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}" ORDER BY _fm_record_id`).all(),
  }));
}

async function reopen(folder: string, inspect: (host: Host) => void): Promise<void> {
  const release = claimFolder(folder);
  let host: Host | undefined;
  try { host = new Host(folder); inspect(host); }
  finally { await host?.close(); release(); }
}

async function operate(op: Operation, root: string, mode = ''): Promise<void> {
  const live = join(root, 'live');
  const key = mode === 'encrypted' ? 'crash-test-key' : undefined;
  const point = () => ({ copy: pathOf(join(root, 'set')), logs: [{ at: 1, read: async () => readFileSync(join(root, 'replay.wal')) }] });
  if (op === 'backup') { await backupFolder(live, join(root, 'Backups'), 1, key); return; }
  if (op === 'restore') { await restoreBackup(live, join(root, 'set'), undefined, key); return; }
  if (op === 'restore-at') { await restoreAt(live, join(root, 'Backups'), Date.now()); return; }
  if (op === 'restore-copy') { await restorePointTo(point(), pathOf(live, 'Copy')); return; }
  if (op === 'restore-replace') { await restorePointTo(point(), pathOf(live)); return; }
  if (op === 'host-conversion') {
    const host = new Host(live, () => {}, { background: mode === 'background' });
    try { if (mode === 'background') await host.scan(); } finally { await host.close(); }
    return;
  }
  if (op === 'host-upload') {
    const host = new Host(live);
    try { await host.hostUpload(join(root, 'upload.part'), 'Charts'); }
    finally { await host.close(); }
    return;
  }
  const store = new Store(pathOf(live), 'A');
  try {
    if (op === 'containers-out') store.moveContainersOut('Items', 'Pic');
    if (op === 'containers-in') store.moveContainersIn([1, 2]);
    if (op === 'design-apply') {
      const table = store.schema.tables[0];
      store.applyDesign([
        { op: 'renameTable', table: table.id, name: 'Renamed' },
        { op: 'updateField', table: table.id, field: table.fields[0].id, name: 'Title' },
      ]);
    }
    if (op === 'compat') store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Name', type: 'number' }]);
    if (op === 'sync-apply') {
      const result = await applySync(store, 'A', [config], remote, writer, { write: false, pull: true });
      assert.equal(result.refused, undefined);
      assert.deepEqual(result.tables.flatMap((t) => t.failed), []);
    }
  } finally { store.close(); }
}

if (process.argv[2] === 'crash-child') {
  if (process.argv[7] === 'fallback') {
    const fs = (await import('node:fs')).default;
    fs.linkSync = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  }
  if (process.argv[5].includes('mid-source-')) {
    const fs = (await import('node:fs')).default;
    const copy = fs.copyFileSync;
    fs.copyFileSync = (from, to, flags) => {
      const selected = process.argv[5].endsWith('stage') ? 'upload.part' : 'source.fmp12';
      if (String(from).endsWith(selected)) {
        const bytes = fs.readFileSync(from);
        fs.writeFileSync(to, bytes.subarray(0, Math.floor(bytes.length / 2)), { flag: 'wx' });
        process.exit(73);
      }
      return copy(from, to, flags);
    };
  }
  const { armCrashPointForTest } = await import('../../store/src/crash-point.ts');
  armCrashPointForTest(process.argv[5], Number(process.argv[6] ?? 1));
  await operate(process.argv[3] as Operation, process.argv[4], process.argv[7]);
}

/** Registers the crash tests of these operations; each child runs one at a time within the file. */
export function crashSuite(ops: readonly Operation[], onlySteps?: readonly string[]): void {
  let expectedConversion: unknown;
  for (const [op, steps] of Object.entries(groups) as [Operation, readonly string[]][]) {
    if (!ops.includes(op)) continue;
    for (const step of steps) {
      if (onlySteps && !onlySteps.includes(step)) continue;
      const checkpoint = `${step === 'mid-apply-log' ? 'apply-log' : step === 'after-reserve' ? 'host-conversion' : op === 'restore-replace' ? 'restore-copy' : op}:${step}`;
      const variants: { occurrence: number; mode: string }[] = [{ occurrence: 1, mode: '' }];
      if (op === 'host-conversion') {
        if (step === 'after-reserve' || step.startsWith('mid-source-')) variants[0].mode = 'fallback';
        else variants.push({ occurrence: 1, mode: 'background' });
      }
      if (step.includes('seal-') || step === 'external-after-decrypt') variants[0].mode = 'encrypted';
      if (step.startsWith('external-')) {
        if (step !== 'external-after-manifest') variants.push({ occurrence: 2, mode: variants[0].mode });
        if (!variants[0].mode) variants.push({ occurrence: 1, mode: 'encrypted' });
      }
      if (op === 'host-upload') {
        if (step === 'after-reserve' || step.startsWith('mid-source-')) variants[0].mode = 'fallback';
        else variants.push({ occurrence: 1, mode: 'fallback' });
      }
      if (op === 'restore' && ['after-save', 'after-publish'].includes(step)) {
        variants.push({ occurrence: 4, mode: '' }, { occurrence: 7, mode: '' });
      }
      if ((['backup', 'restore'].includes(op) && ['after-copy', 'after-verify'].includes(step)) ||
          (op === 'containers-out' && ['after-write', 'after-update'].includes(step)) ||
          (op === 'containers-in' && ['after-copy', 'after-remove'].includes(step)) ||
          (op === 'design-apply' && step === 'after-effect')) variants.push({ occurrence: 2, mode: '' });
      for (const variant of variants) test(`${checkpoint}${op === 'restore-replace' ? ' (replace)' : ''}${op === 'host-upload' && step === 'after-reserve' ? ' (upload)' : ''}${variant.mode ? ` (${variant.mode})` : ''}${variant.occurrence > 1 ? ` #${variant.occurrence}` : ''}`, { concurrency: false, timeout: 60_000 }, async (t) => {
        const root = mkdtempSync(join(tmpdir(), 'tabularius-crash-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        const live = join(root, 'live');
        mkdirSync(live);
        if (variant.mode === 'fallback') t.mock.method(fs, 'linkSync', () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); });
        let convertedState: unknown;
        if (op.startsWith('host-')) {
          assert.ok(existsSync(fixture), 'Charts.fmp12 test fixture is required');
          copyFileSync(fixture, op === 'host-upload' ? join(root, 'upload.part') : join(live, 'Charts.fmp12'));
          if (!expectedConversion) {
            importFmp12(fixture, join(root, 'expected.sqlite'));
            const expected = new Store(join(root, 'expected.sqlite'), 'Charts');
            try { expectedConversion = conversionState(expected); } finally { expected.close(); }
          }
          convertedState = expectedConversion;
        } else {
          seed(live, 'A', op === 'restore' || op === 'backup' || op === 'containers-in');
          if (op === 'backup' || op === 'restore' || op === 'restore-at') seed(live, 'B', op !== 'restore-at');
          if (op === 'backup' || op === 'restore' || op === 'restore-copy' || op === 'restore-replace' || op === 'restore-at') {
            const set = await backupFolder(live, join(root, 'Backups'), 7, variant.mode === 'encrypted' ? 'crash-test-key' : undefined);
            if (op !== 'backup') cpSync(set.dir, join(root, 'set'), { recursive: true });
            for (const name of op === 'restore-copy' || op === 'restore-replace' ? ['A'] : ['A', 'B']) change(live, name, op === 'restore-copy' || op === 'restore-replace' ? join(root, 'replay.wal') : undefined);
          }
          if (op === 'restore-replace') change(live, 'A', undefined, 'later');
          if (op === 'containers-out') {
            mkdirSync(join(live, 'RC_Data_FMS/A'), { recursive: true });
            writeFileSync(join(live, 'RC_Data_FMS/A/keep.txt'), 'unrelated');
            const store = new Store(pathOf(live), 'A');
            store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: 'Items/Pic/' } } }]);
            store.close();
          }
          if (op === 'compat') {
            const store = new Store(pathOf(live), 'A');
            store.update('Items', 1, { Name: '12' }); store.update('Items', 2, { Name: '34' }); store.close();
          }
          if (op === 'sync-apply') {
            const store = new Store(pathOf(live), 'A');
            store.delete('Items', 2);
            // Establish the old map, then let the remote edit both fields.
            await applySync(store, 'A', [config], { ...remote, changedSince: async () => [{ uuid: 'u1', recordId: '1', modId: '1', fields: { uuid: 'u1', Name: 'old', Other: 'old', modts: '' } }] }, writer, { write: false, pull: true });
            store.close();
          }
        }
        const child = spawnSync(process.execPath, ['--no-warnings', import.meta.filename, 'crash-child', op, root, checkpoint, String(variant.occurrence), variant.mode], { encoding: 'utf8', timeout: 45_000 });
        assert.equal(child.status, 73, `${checkpoint} was not reached: ${child.stderr || child.stdout || child.error}`);
        if ((op === 'restore-copy' || op === 'restore-replace') && step !== 'after-publish') {
          const staged = new Store(pathOf(live, op === 'restore-copy' ? 'Copy' : 'A') + '.restoring', 'Staged');
          try { assert.equal(state(staged), step === 'after-copy' ? 'old' : 'new'); } finally { staged.close(); }
        }
        const inspect = (host: Host, finished = false) => {
          if (op.startsWith('host-')) {
            const converted = host.get('Charts');
            if (converted) assert.deepEqual(conversionState(converted), convertedState);
            if (converted) {
              const source = join(live, 'Charts.fmp12');
              assert.equal(statSync(source).size, statSync(fixture).size);
              assert.deepEqual(readFileSync(source), readFileSync(fixture));
            }
            if (finished) assert.ok(converted);
            if (op === 'host-conversion') assert.ok(converted);
            else assert.equal(existsSync(pathOf(live, 'Charts')), existsSync(join(live, 'Charts.fmp12')), 'source and store publish together');
          } else if (op === 'design-apply') {
            const store = host.get('A')!; checkStore(store);
            const table = store.schema.tables[0];
            const isNew = table.name === 'Renamed';
            if (finished) assert.ok(isNew);
            assert.equal(table.fields[0].name, isNew ? 'Title' : 'Name');
            assert.equal(store.sql.prepare(`SELECT "${table.fields[0].name}" AS value FROM "${table.name}"`).get()!.value, 'old');
          } else if (op === 'compat') {
            const store = host.get('A')!; checkStore(store);
            const isNew = store.schema.tables[0].fields[0].type === 'number';
            if (finished) assert.ok(isNew);
            assert.deepEqual(store.sql.prepare('SELECT Name FROM Items ORDER BY _fm_record_id').all().map((r) => r.Name), isNew ? [12, 34] : ['12', '34']);
            assert.ok(!(store.sql.prepare('PRAGMA table_info(Items)').all()).some((r) => String(r.name).startsWith('_fm_retype_')));
          } else if (op === 'sync-apply') {
            const store = host.get('A')!; checkStore(store);
            const row = store.sql.prepare('SELECT Name, Other, _fm_mod_id FROM Items').get()!;
            assert.equal(row.Name, row.Other);
            if (finished) assert.equal(row.Name, 'new');
            const map = store.sql.prepare('SELECT last_local_mod_id, last_remote_mod_id FROM _fm_sync_map').get()!;
            assert.equal(map.last_local_mod_id, row._fm_mod_id, 'record and sync map commit together');
            assert.equal(map.last_remote_mod_id, row.Name === 'new' ? '2' : '1');
          } else {
            const label = state(host.get('A')!);
            if (finished) assert.equal(label, op === 'backup' || op === 'restore-copy' || op === 'restore-replace' ? 'new' : 'old');
            if (op === 'restore' || op === 'backup' || op === 'restore-at') assert.equal(state(host.get('B')!), label, 'no mixed database/container generations');
            if (finished && op === 'restore-copy') assert.ok(host.get('Copy'));
            if (op === 'restore-copy' && host.get('Copy')) assert.equal(state(host.get('Copy')!), 'new');
            if (op.startsWith('containers-')) {
              const rows = host.get('A')!.sql.prepare('SELECT external FROM _fm_containers').all();
              assert.ok(rows.every((r) => !!r.external === !!rows[0].external), 'all containers move together');
              if (finished) assert.equal(!!rows[0].external, op === 'containers-out');
              if (op === 'containers-out') assert.deepEqual(externalFiles(live, ['A']).sort(), ['RC_Data_FMS/A/keep.txt', ...rows.flatMap((r) => r.external ? [`RC_Data_FMS/A/${r.external}`] : [])].sort(), 'external folder contains only committed files and the unrelated original');
            }
          }
        };
        await reopen(live, inspect);
        if (op === 'containers-out') assert.ok(!existsSync(pathOf(live) + '.containers-out.json'));
        if (op === 'backup') for (const set of backupSets(join(root, 'Backups'))) {
          const dir = join(root, 'Backups', set);
          assert.deepEqual(await verifyExternal(dir, variant.mode === 'encrypted' ? 'crash-test-key' : undefined), {});
          if (variant.mode === 'encrypted') {
            const target = join(root, 'checked-' + set);
            mkdirSync(target);
            await restoreBackup(target, dir, undefined, 'crash-test-key');
            await reopen(target, (host) => assert.equal(state(host.get('A')!), state(host.get('B')!)));
            continue;
          }
          const a = new Store(pathOf(dir), 'A'); const b = new Store(pathOf(dir, 'B'), 'B');
          try { assert.equal(state(a), state(b)); } finally { a.close(); b.close(); }
        }
        // Repeating a completed upload is a name conflict; resume only if publication did not finish.
        if (op !== 'host-upload' || !existsSync(pathOf(live, 'Charts'))) await operate(op, root, variant.mode);
        await reopen(live, (host) => inspect(host, true));
        if (op.startsWith('host-')) assert.ok(!readdirSync(live).some((n) => n.includes('.tmp-')), 'completed conversion temps are swept');
        sweepCrashLeftovers(live, join(root, 'Backups'), Date.now() + 2 * 86_400_000);
        assert.ok(!readdirSync(live).some((n) => /\.restoring|\.restore-previous-|restore-journal/.test(n)));
        for (const sub of ['RC_Data_FMS', 'Files']) if (existsSync(join(live, sub))) assert.ok(!readdirSync(join(live, sub)).some((n) => n.endsWith('.restoring')));
        if (existsSync(join(root, 'Backups'))) assert.ok(!readdirSync(join(root, 'Backups')).some((n) => n.endsWith('.partial')));
      });
    }
  }
}
