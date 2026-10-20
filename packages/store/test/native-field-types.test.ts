import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../src/index.ts';

test('native scalar fields write, read, validate, find, sort and calculate without changing compat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-types-'));
  try {
    const path = join(dir, 'native.sqlite');
    createStore(path, { mode: 'native' });
    const store = new Store(path, 'native');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
        { name: 'Flag', type: 'boolean' }, { name: 'Count', type: 'integer' }, { name: 'Price', type: 'decimal' },
        { name: 'Payload', type: 'json' }, { name: 'Key', type: 'uuid' },
        { name: 'Generated', type: 'uuid', calculation: 'Get ( UUID )', options: { autoEnter: { calculation: true } } },
      ] }]);
      const key = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
      const first = store.create('Items', { Flag: 'true', Count: '-12', Price: '00012.3400', Payload: '{"z":1,"a":{"b":2,"a":1}}', Key: key }).recordId;
      const second = store.create('Items', { Flag: '0', Count: '3', Price: '-900719925474099312345.01', Payload: '[true,null]', Key: '00000000-0000-0000-0000-000000000001' }).recordId;
      const third = store.create('Items', { Flag: '1', Count: '4', Price: '0.3', Payload: '{}', Key: '00000000-0000-0000-0000-000000000002' }).recordId;
      const a = store.get('Items', first, 'iso').fieldData;
      assert.deepEqual([a.Flag, a.Count, a.Price, a.Payload, a.Key], [1, -12, '12.34', '{"a":{"a":1,"b":2},"z":1}', key.toLowerCase()]);
      assert.match(String(a.Generated), /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      assert.equal(store.evaluate('Items', 'GetAsText ( Price )', first).value, '12.34');
      assert.equal(store.evaluate('Items', 'GetAsText ( Price + 0.2 )', third).value, '0.5');
      assert.equal(store.evaluate('Items', 'GetAsText ( 0.1 + 0.2 )', first).value, '0.3');
      assert.equal(store.evaluate('Items', 'GetAsNumber ( Count )', first).value, '-12');
      assert.equal(store.evaluate('Items', 'GetAsNumber ( Flag )', first).value, '1');
      assert.equal(store.evaluate('Items', 'GetAsText ( Payload )', first).value, a.Payload);
      assert.equal(store.evaluate('Items', 'GetAsText ( Key )', first).value, a.Key);
      assert.deepEqual(store.findIds('Items', { query: [{ Price: '<0' }] }), [second]);
      assert.deepEqual(store.findIds('Items', { query: [{ Price: '0.3' }] }), [third]);
      assert.deepEqual(store.findIds('Items', { query: [{ Flag: 'true' }] }), [first, third]);
      assert.deepEqual(store.findIds('Items', { query: [{ Count: '-12...3' }] }), [first, second]);
      assert.deepEqual(store.findIds('Items', { query: [{ Payload: '{"a":{"a":1,"b":2},"z":1}' }] }), [first]);
      assert.deepEqual(store.findIds('Items', { query: [{ Key: key }] }), [first]);
      assert.deepEqual(store.sortIds('Items', [first, second, third], [{ fieldName: 'Price', sortOrder: 'ascend' }]), [second, third, first]);
      assert.deepEqual(store.sortIds('Items', [first, second, third], [{ fieldName: 'Count', sortOrder: 'ascend' }]), [first, second, third]);
      assert.deepEqual(store.sortIds('Items', [first, second, third], [{ fieldName: 'Flag', sortOrder: 'ascend' }]), [second, first, third]);
      assert.deepEqual(store.sortIds('Items', [first, second, third], [{ fieldName: 'Key', sortOrder: 'ascend' }]), [second, third, first]);
      assert.deepEqual(store.sortIds('Items', [first, second, third], [{ fieldName: 'Payload', sortOrder: 'ascend' }]), [second, first, third]);
      assert.deepEqual(store.select('SELECT Price FROM Items WHERE Price > 1 ORDER BY Price').rows, [[12.34]]);
      assert.deepEqual(store.select('SELECT SUM(Price), AVG(Price) FROM Items WHERE Price > 0').rows, [[12.64, 6.32]]);
      assert.equal(store.evaluate('Items', 'ExecuteSQL ( "SELECT Price FROM Items WHERE Price > 1" ; "" ; "" )', first).value, '12.34');
      assert.equal(store.evaluate('Items', 'If ( Price > 10 ; Price + 1 ; 0 )', first).value, '13.34');
      assert.equal(store.evaluate('Items', 'If ( Price > 1 ; 1 ; 0 )', third).value, '0');
      assert.equal(store.create('Items', { Price: 0.1 }).recordId > 0, true);
      assert.throws(() => store.create('Items', { Price: 0.12345678901234566 }), /decimal string/);
      assert.equal(store.get('Items', store.create('Items', { Payload: '{"big":900719925474099312345678901,"a":1.2300}' }).recordId).fieldData.Payload, '{"a":1.2300,"big":900719925474099312345678901}');
      assert.throws(() => store.create('Items', { Payload: '{"a":1,"\\u0061":2}' }), /valid json/);
      assert.throws(() => store.create('Items', { Payload: `"${'x'.repeat(1024 * 1024)}"` }), /size/);
      assert.throws(() => store.findIds('Items', { query: [{ Price: '1e1' }] }), /Exponent literals/);
      assert.throws(() => store.findIds('Items', { query: [{ Payload: '>1' }] }), /Range operators/);
      assert.deepEqual(store.findIds('Items', { query: [{ Payload: '[true,null]' }] }), [second]);
      assert.deepEqual(store.findIds('Items', { query: [{ Payload: '*' }] }).slice(0, 3), [first, second, third]);
      assert.equal(store.get('Items', store.create('Items', { Price: '.5' }).recordId).fieldData.Price, '0.5');
      assert.equal(store.get('Items', store.create('Items', { Price: '5.' }).recordId).fieldData.Price, '5');
      assert.throws(() => store.create('Items', { Payload: '"' + 'x'.repeat(1024 * 1024) + '"' }), /size/i);
      assert.throws(() => store.create('Items', { Payload: '['.repeat(140) + '0' + ']'.repeat(140) }), /depth/i);
      assert.throws(() => store.findIds('Items', { query: [{ Payload: 'true*' }] }), /valid complete JSON/);
      for (const bad of [
        { Flag: 'yes' }, { Flag: '2' }, { Count: '1.5' }, { Count: '9007199254740992' },
        { Price: '1e3' }, { Price: `0.${'1'.repeat(31)}` }, { Payload: '{bad}' }, { Key: 'bad-uuid' },
      ] as Record<string, string>[]) assert.throws(() => store.create('Items', bad), (e: { code?: number }) => e.code === 500, JSON.stringify(bad));
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        const raw = db.prepare('SELECT Flag, Count, Price, Payload, Key FROM Items WHERE _fm_record_id = ?').get(first) as Record<string, unknown>;
        assert.deepEqual({ ...raw }, { Flag: 1, Count: -12, Price: '12.34', Payload: a.Payload, Key: a.Key });
      } finally { db.close(); }
      store.applyDesign([{ op: 'createTable', name: 'Retype', fields: [{ name: 'Value' }] }]);
      const convertible = store.create('Retype', { Value: '001.2300' }).recordId;
      const invalid = store.create('Retype', { Value: 'bad' }).recordId;
      assert.throws(() => store.applyDesign([{ op: 'updateField', table: 'Retype', field: 'Value', type: 'decimal' }]), (e: { code?: number }) => e.code === 500);
      assert.equal(store.get('Retype', convertible).fieldData.Value, '001.2300', 'failed conversion did not change rows');
      store.update('Retype', invalid, { Value: '0.2' });
      store.applyDesign([{ op: 'updateField', table: 'Retype', field: 'Value', type: 'decimal' }]);
      assert.equal(store.get('Retype', convertible).fieldData.Value, '1.23');
    } finally { store.close(); }

    const compatPath = join(dir, 'compat.sqlite');
    createStore(compatPath);
    const compat = new Store(compatPath, 'compat');
    try {
      for (const type of ['boolean', 'integer', 'decimal', 'json', 'uuid'] as const) {
        assert.throws(() => compat.applyDesign([{ op: 'createTable', name: 'Bad', fields: [{ name: 'Value', type }] }]), /available only in native files/);
      }
      compat.applyDesign([{ op: 'createTable', name: 'Good', fields: [{ name: 'Value' }] }]);
      for (const type of ['boolean', 'integer', 'decimal', 'json', 'uuid'] as const) {
        assert.throws(() => compat.applyDesign([{ op: 'updateField', table: 'Good', field: 'Value', type }]), /available only in native files/);
      }
    } finally { compat.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native relationship predicates compare UUIDs case insensitively and decimals numerically', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-rel-'));
  try {
    const path = join(dir, 'native.sqlite');
    createStore(path, { mode: 'native' });
    const store = new Store(path, 'native');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Parents', fields: [{ name: 'Key' }, { name: 'Amount', type: 'decimal' }, { name: 'Limit', type: 'decimal' }] },
        { op: 'createTable', name: 'Children', fields: [{ name: 'Uuid', type: 'uuid' }, { name: 'Amount', type: 'decimal' }] },
        { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'Uuid' }] },
        { op: 'createOccurrence', name: 'DecimalEqual', table: 'Children' },
        { op: 'createRelationship', left: 'Parents', right: 'DecimalEqual', predicates: [{ left: 'Amount', right: 'Amount' }] },
        { op: 'createOccurrence', name: 'DecimalRange', table: 'Children' },
        { op: 'createRelationship', left: 'Parents', right: 'DecimalRange', predicates: [{ left: 'Limit', operator: '<', right: 'Amount' }] },
      ]);
      store.create('Children', { Uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', Amount: '10' });
      const id = store.create('Parents', { Key: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', Amount: '10.0', Limit: '9' }).recordId;
      assert.equal(store.evaluate('Parents', 'Count ( Children::Uuid )', id).value, '1');
      assert.equal(store.evaluate('Parents', 'Count ( DecimalEqual::Amount )', id).value, '1');
      assert.equal(store.evaluate('Parents', 'Count ( DecimalRange::Amount )', id).value, '1');
      store.create('Children', { Amount: '900719925474099312345.02' });
      const big = store.create('Parents', { Amount: '900719925474099312345.02', Limit: '900719925474099312345.01' }).recordId;
      assert.equal(store.evaluate('Parents', 'Count ( DecimalEqual::Amount )', big).value, '1');
      assert.equal(store.evaluate('Parents', 'Count ( DecimalRange::Amount )', big).value, '1');
      const plan = (sql: string, param: string) => (store.sql.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(param) as { detail: string }[]).map((r) => r.detail).join(' ');
      assert.match(plan('SELECT _fm_record_id FROM Children WHERE Uuid = lower(?)', 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'), /_fm_match_.*Uuid|_fm_match_\d+_\d+/i);
      assert.match(plan('SELECT _fm_record_id FROM Children WHERE Amount = ?', '10'), /_fm_match_\d+_\d+/);
      assert.match(plan('SELECT _fm_record_id FROM Children WHERE fm_decimal_key(Amount) > fm_decimal_key(?)', '9'), /_fm_match_\d+_\d+_range/);
      for (let i = 0; i < 3000; i++) store.create('Children', { Uuid: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, Amount: String(i) });
      const started = performance.now();
      for (let i = 0; i < 50; i++) store.evaluate('Parents', 'Count ( Children::Uuid )', id);
      const lookupMs = performance.now() - started;
      assert.ok(lookupMs < 1500, '50 indexed relationship lookups should finish under 1.5 s');
      t.diagnostic(`50 indexed relationship lookups: ${lookupMs.toFixed(1)} ms`);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
