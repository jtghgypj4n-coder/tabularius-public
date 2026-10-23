import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { createStore, STORE_FORMAT, Store } from '../src/index.ts';
import { checkNativeCompat, nativeCompatChecks, planNativeUpgrade, upgradeNativeFile } from '../src/native-compat.ts';

test('compat registry reports native types, ISO dates and added entries by location', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-compat-registry-'));
  try {
    const compat = join(dir, 'compat.sqlite');
    const native = join(dir, 'native.sqlite');
    createStore(compat);
    createStore(native, { mode: 'native' });
    assert.deepEqual(checkNativeCompat(compat), []);
    const store = new Store(native);
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
        ...(['boolean', 'integer', 'decimal', 'json', 'uuid'] as const).map((type) => ({ name: type, type })),
        { name: 'When', type: 'date' },
      ] }]);
      store.applyDesign([{ op: 'createCustomFunction', name: 'Double', parameters: ['x'], formula: 'return x * 2;', language: 'javascript' }]);
    } finally { store.close(); }
    const findings = checkNativeCompat(native);
    assert.ok(findings.some((f) => f.id === 'file-mode'));
    assert.ok(findings.some((f) => f.id === 'iso-date-order'));
    for (const type of ['boolean', 'integer', 'decimal', 'json', 'uuid']) {
      assert.ok(findings.some((f) => f.table === 'Items' && f.field === type && f.id === 'native-field-type'), type);
    }
    assert.ok(findings.some((f) => f.table === 'Items' && f.field === 'When' && f.id === 'iso-date'));
    assert.ok(findings.some((f) => f.table === '(custom function)' && f.field === 'Double' && f.id === 'javascript-function'));
    const extra = { id: 'future-test', describe: 'future feature', test: () => [{ table: 'Items', field: 'When' }] };
    nativeCompatChecks.push(extra);
    try { assert.ok(checkNativeCompat(native).some((f) => f.id === 'future-test' && f.field === 'When')); }
    finally { nativeCompatChecks.pop(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('upgrade previews, backs up before writing, converts dates, and stays one-way', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-upgrade-'));
  try {
    const file = join(dir, 'Demo.sqlite');
    const backup = join(dir, 'before.sqlite');
    createStore(file);
    const store = new Store(file);
    let ids: number[];
    try {
      store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }, { name: 'At', type: 'timestamp' }] }]);
      ids = [
        store.create('Events', { Day: '10/16/2026', At: '10/16/2026 12:30:00' }).recordId,
        store.create('Events', { Day: '10/17/2026', At: '10/17/2026 13:45:00' }).recordId,
      ];
    } finally { store.close(); }
    assert.equal(planNativeUpgrade(file).alreadyNative, false);
    assert.equal(planNativeUpgrade(file).dateValues, 4);
    assert.equal(checkNativeCompat(file).length, 0, 'preview is read-only');
    const result = await upgradeNativeFile(file, async () => {
      const db = new DatabaseSync(file, { readOnly: true });
      try { await sqliteBackup(db, backup); }
      finally { db.close(); }
      const before = new DatabaseSync(file, { readOnly: true });
      try { assert.equal(before.prepare("SELECT json FROM _fm_meta WHERE key = 'fileMode'").get(), undefined); }
      finally { before.close(); }
      return backup;
    });
    assert.equal(result.backup, backup);
    assert.ok(existsSync(backup));
    const old = new DatabaseSync(backup, { readOnly: true });
    try { assert.equal(old.prepare("SELECT json FROM _fm_meta WHERE key = 'fileMode'").get(), undefined); }
    finally { old.close(); }
    const upgraded = new Store(file);
    try {
      assert.equal(upgraded.fileMode, 'native');
      assert.equal(upgraded.dateOrder, 'ISO');
      assert.deepEqual(ids.map((id) => upgraded.get('Events', id, 'iso').fieldData), [
        { Day: '2026-10-16', At: '2026-10-16T12:30:00' },
        { Day: '2026-10-17', At: '2026-10-17T13:45:00' },
      ]);
    } finally { upgraded.close(); }
    assert.equal(planNativeUpgrade(file).alreadyNative, true);
    await assert.rejects(upgradeNativeFile(file, async () => { throw new Error('backup should not run'); }), /already native/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('upgrade refuses repeating and global fields before backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-upgrade-refuse-'));
  try {
    const file = join(dir, 'Demo.sqlite');
    createStore(file);
    const store = new Store(file);
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
        { name: 'Tags', options: { repetitions: 2 } }, { name: 'Setting', options: { global: true } },
      ] }]);
    } finally { store.close(); }
    const plan = planNativeUpgrade(file);
    assert.match(plan.blockers.join('\n'), /Items::Tags.*repeating/);
    assert.match(plan.blockers.join('\n'), /Items::Setting.*global/);
    await assert.rejects(upgradeNativeFile(file, async () => { throw new Error('backup should not run'); }), /repeating/);
    assert.deepEqual(checkNativeCompat(file), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('upgrade refuses an invalid stored date without changing data or taking a backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-upgrade-date-'));
  try {
    const file = join(dir, 'Demo.sqlite');
    createStore(file);
    const store = new Store(file);
    let id: number;
    try {
      store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }] }]);
      id = store.create('Events', { Day: '02/30/2026' }).recordId;
    } finally { store.close(); }
    assert.match(planNativeUpgrade(file).blockers.join('\n'), /Events::Day.*cannot be converted/);
    await assert.rejects(upgradeNativeFile(file, async () => { throw new Error('backup should not run'); }), /Events::Day/);
    const unchanged = new Store(file);
    try {
      assert.equal(unchanged.fileMode, 'compat');
      assert.equal(unchanged.get('Events', id, 'us').fieldData.Day, '02/30/2026');
    } finally { unchanged.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('upgrade refuses an out-of-range timestamp clock before backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-upgrade-clock-'));
  try {
    const file = join(dir, 'Demo.sqlite');
    createStore(file);
    const store = new Store(file);
    try {
      store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'At', type: 'timestamp' }] }]);
      const id = store.create('Events', { At: '10/16/2026 25:00:00' }).recordId;
      for (const clock of ['25:00:00', '23:60:00', '23:59:60']) {
        store.update('Events', id, { At: `10/16/2026 ${clock}` });
        assert.match(planNativeUpgrade(file).blockers.join('\n'), /Events::At.*cannot be converted/, clock);
      }
    } finally { store.close(); }
    await assert.rejects(upgradeNativeFile(file, async () => { throw new Error('backup should not run'); }), /Events::At/);
    const unchanged = new Store(file);
    try { assert.equal(unchanged.fileMode, 'compat'); }
    finally { unchanged.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed backup prevents the mode change', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-upgrade-backup-'));
  try {
    const file = join(dir, 'Demo.sqlite');
    createStore(file);
    await assert.rejects(upgradeNativeFile(file, async () => { throw new Error('backup failed'); }), /backup failed/);
    assert.deepEqual(checkNativeCompat(file), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check and upgrade refuse a newer store format before writing or backing up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-upgrade-format-'));
  try {
    const file = join(dir, 'Demo.sqlite');
    createStore(file);
    const db = new DatabaseSync(file);
    try { db.prepare("INSERT INTO _fm_meta (key, json) VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(STORE_FORMAT + 1)); }
    finally { db.close(); }
    assert.throws(() => checkNativeCompat(file), /newer Tabularius/);
    assert.throws(() => planNativeUpgrade(file), /newer Tabularius/);
    await assert.rejects(upgradeNativeFile(file, async () => { throw new Error('backup should not run'); }), /newer Tabularius/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
