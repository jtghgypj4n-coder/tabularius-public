import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { asText, dayNumber, parseDateText, parseTimestampText } from '../../calc/src/index.ts';
import { parseDate, parseTimestamp } from '../../fmp12/src/index.ts';
import { applyOps, createStore, NATIVE_REFUSAL, reconvert, reconvertCheck, Store } from '../src/index.ts';

test('new stores add AI policy; compat metadata otherwise stays the same and native adds ISO dates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-meta-'));
  try {
    const compat = join(dir, 'compat.sqlite');
    const explicitCompat = join(dir, 'explicit-compat.sqlite');
    const native = join(dir, 'native.sqlite');
    createStore(compat);
    createStore(explicitCompat, { mode: 'compat' });
    createStore(native, { mode: 'native' });
    const rows = (path: string) => {
      const db = new DatabaseSync(path, { readOnly: true });
      try { return db.prepare('SELECT key, json FROM _fm_meta ORDER BY key').all() as { key: string; json: string }[]; }
      finally { db.close(); }
    };
    assert.equal(rows(compat).find((r) => r.key === 'aiPolicy')?.json, 'true');
    assert.equal(rows(native).find((r) => r.key === 'aiPolicy')?.json, 'true');
    const before = rows(compat).filter((r) => r.key !== 'aiPolicy').map(({ key, json }) => [key, key === 'source' ? json.replace(/"createdAt":"[^"]+"/, '"createdAt":"<timestamp>"') : json]);
    assert.equal(createHash('sha256').update(JSON.stringify(before)).digest('hex'), '65fba82d3e76824a8820a6b47f3ae8d2c238ff9720afa7201e2a347d1d7acf6c');
    assert.equal(rows(compat).some((r) => r.key === 'fileMode'), false);
    assert.equal(rows(explicitCompat).find((r) => r.key === 'fileMode')?.json, '"compat"');
    assert.equal(rows(native).find((r) => r.key === 'fileMode')?.json, '"native"');
    assert.equal(rows(native).find((r) => r.key === 'dateOrder')?.json, '"ISO"');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native design refuses repeating and global fields while compat accepts them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-design-'));
  try {
    for (const mode of ['native', 'compat'] as const) {
      const path = join(dir, `${mode}.sqlite`);
      createStore(path, { mode });
      const store = new Store(path, mode);
      try {
        store.applyDesign([{ op: 'createTable', name: 'Things', fields: [{ name: 'Name' }] }]);
        const repeat = { op: 'createField', table: 'Things', name: 'Tags', options: { repetitions: 2 } } as const;
        const global = { op: 'updateField', table: 'Things', field: 'Name', options: { global: true } } as const;
        if (mode === 'native') {
          assert.throws(() => store.checkDesign([repeat]), /array or JSON/);
          assert.throws(() => store.applyDesign([repeat]), /array or JSON/);
          assert.throws(() => store.applyDesign([global]), /settings table/);
          assert.throws(() => store.applyDesign([{ op: 'createTable', name: 'Bad', fields: [{ name: 'Shared', options: { global: true } }] }]), /settings table/);
          assert.deepEqual(store.schema.tables.map((t) => t.name), ['Things']);
        } else {
          store.applyDesign([repeat, global]);
          assert.equal(store.schema.tables[0].fields.find((f) => f.name === 'Tags')?.options?.repetitions, 2);
          assert.equal(store.schema.tables[0].fields.find((f) => f.name === 'Name')?.options?.global, true);
        }
      } finally { store.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native dates use ISO text without reading US dates', () => {
  assert.equal(parseDate('2026-10-16', 'ISO'), '2026-10-16');
  assert.equal(parseDate('10/16/2026', 'ISO'), undefined);
  assert.equal(parseTimestamp('2026-10-16T12:30:00', 'ISO'), '2026-10-16T12:30:00');
  assert.equal(parseTimestamp('10/16/2026 12:30:00', 'ISO'), undefined);
  assert.equal(parseTimestamp('2026-10-16 12:30:00', 'ISO'), '2026-10-16T12:30:00');
  assert.equal(parseTimestampText('2026-10-16 12:30:00', 'ISO'), parseTimestampText('2026-10-16T12:30:00', 'ISO'));
  assert.equal(parseDateText('10/16/2026', 'ISO'), undefined);
  assert.equal(parseTimestampText('10/16/2026 12:30:00', 'ISO'), undefined);
  assert.equal(asText({ type: 'date', value: dayNumber(2026, 10, 16) }, 'ISO'), '2026-10-16');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-dates-'));
  try {
    const path = join(dir, 'native.sqlite');
    createStore(path, { mode: 'native' });
    const store = new Store(path, 'native');
    try {
      assert.equal(store.normalize('2026-10-16', 'date'), '2026-10-16');
      assert.equal(store.normalize('10/16/2026', 'date', 'MDY'), '10/16/2026', 'a find criterion is left as typed');
      assert.equal(store.present('2026-10-16', 'date', 'us'), '2026-10-16');
      assert.equal(store.present('2026-10-16T12:30:00', 'timestamp', 'us'), '2026-10-16T12:30:00');
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native ISO dates validate month lengths and leap years without changing compat parsing', () => {
  for (const bad of ['2026-02-30', '2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31', '2026-00-10', '2026-01-00']) {
    assert.equal(parseDate(bad, 'ISO'), undefined, bad);
    assert.equal(parseTimestamp(`${bad}T12:30:00`, 'ISO'), undefined, bad);
  }
  for (const good of ['2024-02-29', '2000-02-29', '2026-02-28', '2026-04-30', '2026-12-31']) {
    assert.equal(parseDate(good, 'ISO'), good);
    assert.equal(parseTimestamp(`${good}T12:30:00`, 'ISO'), `${good}T12:30:00`);
  }
  for (const order of ['MDY', 'DMY', 'YMD'] as const) {
    assert.equal(parseDate('2026-02-30', order), '2026-02-30');
    assert.equal(parseTimestamp('2026-02-30 12:30:00', order), '2026-02-30T12:30:00');
  }
});

test('native field conversion migrates compat date text to ISO and refuses invalid values atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-retype-'));
  try {
    for (const mode of ['native', 'compat'] as const) {
      const path = join(dir, `${mode}.sqlite`);
      createStore(path, { mode });
      const store = new Store(path, mode);
      try {
        for (const type of ['date', 'timestamp'] as const) {
          const table = type === 'date' ? 'Days' : 'Times';
          const suffix = type === 'timestamp' ? ' 12:30:00' : '';
          store.applyDesign([{ op: 'createTable', name: table, fields: [{ name: 'Value' }] }]);
          const inputs = ['10/16/2026' + suffix, '2026-10-17' + suffix, '', '  '];
          const ids = inputs.map((Value) => store.create(table, { Value }).recordId);
          const bad = store.create(table, { Value: 'soon' }).recordId;
          const retype = { op: 'updateField', table, field: 'Value', type } as const;
          const values = () => [...ids, bad].map((id) => store.get(table, id, 'iso').fieldData.Value);
          if (mode === 'native') {
            const before = values();
            for (const invalid of ['soon', '02/30/2026' + suffix, '2026-02-30' + suffix]) {
              store.update(table, bad, { Value: invalid });
              assert.throws(() => store.applyDesign([retype]), (e: { code?: number; message: string }) => e.code === 500 && /cannot be converted/.test(e.message));
              assert.equal(store.schema.tables.find((t) => t.name === table)!.fields[0].type, 'text');
              assert.deepEqual(values(), [...before.slice(0, -1), invalid], 'no partial data conversion');
            }
            store.update(table, bad, { Value: type === 'date' ? '2024-02-29' : '2024-02-29T09:15:00' });
          }
          store.applyDesign([retype]);
          assert.deepEqual(values(), [
            '2026-10-16' + suffix.replace(' ', 'T'), '2026-10-17' + suffix.replace(' ', 'T'), '', '',
            mode === 'compat' ? 'soon' : type === 'date' ? '2024-02-29' : '2024-02-29T09:15:00',
          ]);
          const db = new DatabaseSync(path, { readOnly: true });
          try {
            assert.deepEqual(db.prepare(`SELECT Value FROM "${table}" ORDER BY _fm_record_id`).all().map((r) => r.Value), values().map((v) => v === '' ? null : v), 'the stored column itself contains ISO or NULL');
          } finally { db.close(); }
        }
      } finally { store.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native writes refuse dates and timestamps that are not ISO 8601; compat keeps reading US dates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-writes-'));
  try {
    for (const mode of ['native', 'compat'] as const) {
      const path = join(dir, `${mode}.sqlite`);
      createStore(path, mode === 'native' ? { mode } : undefined);
      const store = new Store(path, mode);
      try {
        store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }, { name: 'When', type: 'timestamp' }] }]);
        const day = (id: number) => store.get('Events', id, 'iso').fieldData;
        if (mode === 'native') {
          const { recordId } = store.create('Events', { Day: '2026-10-16', When: '2026-10-16 12:30:00' });
          assert.deepEqual(day(recordId), { Day: '2026-10-16', When: '2026-10-16T12:30:00' });
          store.update('Events', recordId, { When: '2026-10-17T08:00:00' });
          assert.equal(day(recordId).When, '2026-10-17T08:00:00');
          for (const bad of [{ Day: '10/16/2026' }, { Day: '2026-13-01' }, { Day: '2026-02-30' }, { Day: '2026-02-29' }, { Day: '2026-04-31' }, { Day: 'soon' }, { When: '10/16/2026 12:30:00' }, { When: '2026-02-30T12:30:00' }, { When: '2026-10-16' }, { When: '2026-10-16Tnoon' }] as Record<string, string>[]) {
            assert.throws(() => store.create('Events', bad), (e: { code?: number; message: string }) => e.code === 500 && /must be an ISO 8601/.test(e.message), JSON.stringify(bad));
            assert.throws(() => store.update('Events', recordId, bad), (e: { code?: number }) => e.code === 500, JSON.stringify(bad));
          }
          assert.throws(() => store.create('Events', { When: 'noon' }), /YYYY-MM-DDTHH:MM:SS/);
          assert.deepEqual(day(recordId), { Day: '2026-10-16', When: '2026-10-17T08:00:00' });
          store.update('Events', recordId, { Day: '', When: '' });
          assert.deepEqual(day(recordId), { Day: '', When: '' });
        } else {
          const { recordId } = store.create('Events', { Day: '10/16/2026', When: '10/16/2026 12:30:00' });
          assert.deepEqual(day(recordId), { Day: '2026-10-16', When: '2026-10-16T12:30:00' });
          store.update('Events', recordId, { Day: 'soon' });
          assert.equal(day(recordId).Day, 'soon');
        }
      } finally { store.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a native design change is checked on the fields it makes, so fields that already repeat or are global do not block it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-existing-'));
  try {
    const path = join(dir, 'old.sqlite');
    createStore(path);
    const store = new Store(path, 'old');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Things', fields: [{ name: 'Name' }, { name: 'Tags', options: { repetitions: 3 } }, { name: 'Shared', options: { global: true } }] }]);
      const native = { schema: store.schema, designs: store.designs(), fileMode: 'native' as const };
      const r = applyOps(native, [{ op: 'createField', table: 'Things', name: 'Note' }, { op: 'updateField', table: 'Things', field: 'Tags', name: 'Labels' }]);
      assert.deepEqual(r.state.schema.tables[0].fields.map((f) => f.name), ['Name', 'Labels', 'Shared', 'Note']);
      assert.throws(() => applyOps(native, [{ op: 'createField', table: 'Things', name: 'More', options: { repetitions: 2 } }]), /array or JSON/);
      assert.throws(() => applyOps(native, [{ op: 'updateField', table: 'Things', field: 'Name', options: { global: true } }]), /settings table/);
      assert.throws(() => applyOps(native, [{ op: 'updateField', table: 'Things', field: 'Shared', options: { repetitions: 2 } }]), /array or JSON/);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a native file is never converted again, even with a .fmp12 of its name beside it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-reconvert-'));
  try {
    const path = join(dir, 'Native.openhbam.sqlite');
    const fmp12 = join(dir, 'Native.fmp12');
    createStore(path, { mode: 'native' });
    writeFileSync(fmp12, 'not a FileMaker file');
    assert.deepEqual(reconvertCheck(path, fmp12), { version: 1, current: reconvertCheck(path, fmp12).current, outdated: false, native: true });
    for (const opts of [{}, { force: true }, { force: true, dryRun: true }]) {
      await assert.rejects(reconvert(path, fmp12, opts), (e: Error) => e.message === NATIVE_REFUSAL, JSON.stringify(opts));
    }
    assert.deepEqual(readdirSync(dir).filter((f) => f.includes('reconvert')), [], 'nothing was converted or backed up');
    const store = new Store(path, 'Native');
    try { assert.equal(store.fileMode, 'native'); } finally { store.close(); }
    assert.ok(existsSync(path));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
