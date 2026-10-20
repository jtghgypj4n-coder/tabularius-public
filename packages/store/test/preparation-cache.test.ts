import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';
import { markExecutionRefusal } from '../../calc/src/index.ts';

for (const failure of ['commit', 'refusal'] as const) test(`prepared related-file caches are discarded after a ${failure} failure`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-prepared-related-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  const a = open('A'), b = open('B');
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  b.resolveFile = (name) => name === 'A' ? a : undefined;
  a.applyDesign([{ op: 'createTable', name: 'A', fields: [{ name: 'Key', type: 'number' }, { name: 'Value', type: 'number' }] }]);
  b.applyDesign([
    { op: 'createTable', name: 'B', fields: [{ name: 'Key', type: 'number' }, { name: 'Note' }] },
    { op: 'createDataSource', name: 'A', paths: ['file:A'] },
    { op: 'createOccurrence', name: 'A', file: 'A', externalTable: a.schema.tables[0].id },
    { op: 'createRelationship', left: 'B', right: 'A', predicates: [{ left: 'Key', right: a.schema.tables[0].fields[0].id }] },
    { op: 'createField', table: 'B', name: 'Echo', type: 'number', kind: 'calculation', calculation: 'A::Value', options: { unstored: true } },
    { op: 'createField', table: 'B', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Echo' } },
    { op: 'createField', table: 'B', name: 'SummaryValue', type: 'number', kind: 'calculation', calculation: 'Total', options: { unstored: true } },
  ]);
  a.applyDesign([
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
    { op: 'createOccurrence', name: 'B', file: 'B', externalTable: b.schema.tables[0].id },
    { op: 'createRelationship', left: 'A', right: 'B', predicates: [{ left: 'Key', right: b.schema.tables[0].fields[0].id }] },
    { op: 'createField', table: 'A', name: 'Related', type: 'number', kind: 'calculation', calculation: 'B::SummaryValue', options: { unstored: true } },
    { op: 'createField', table: 'A', name: 'RelatedTotal', kind: 'summary', summary: { type: 'total', field: 'Related' } },
    { op: 'createField', table: 'A', name: 'Guard', type: 'number', kind: 'calculation', calculation: 'Value * 2', options: { unstored: true } },
    { op: 'createField', table: 'A', name: 'Incremental', kind: 'summary', summary: { type: 'total', field: 'Guard' } },
  ]);
  const aid = a.create('A', { Key: '1', Value: '3' }).recordId;
  const bid = b.create('B', { Key: '1', Note: 'original' }).recordId;
  a.shareResults();
  b.shareResults();
  assert.equal(a.warmSummaries('A'), 2);
  assert.equal(Number(b.get('B', bid).fieldData.SummaryValue), 3);
  // B's next read must recompute its warmed summary while A's write is still uncommitted.
  b.update('B', bid, { Note: 'invalidate' });
  const stamp = a.dataStamp(), bstamp = b.dataStamp();
  const error = new StoreError(212, 'failed after reading the related summary');
  if (failure === 'refusal') markExecutionRefusal(error);
  let pending = false;
  const bvalue = b.calc.value.bind(b.calc);
  t.mock.method(b.calc, 'value', (...args: Parameters<typeof bvalue>) => {
    const value = bvalue(...args);
    if (args[1].name === 'SummaryValue' && value.type === 'number' && value.value === 7) pending = true;
    return value;
  });
  if (failure === 'commit') {
    const exec = a.sql.exec.bind(a.sql);
    t.mock.method(a.sql, 'exec', (sql: string) => {
      if (sql === 'COMMIT') throw error;
      return exec(sql);
    });
  } else {
    const value = a.calc.value.bind(a.calc);
    t.mock.method(a.calc, 'value', (...args: Parameters<typeof value>) => {
      if (args[1].name === 'Guard' && pending) throw error;
      return value(...args);
    });
  }
  const puts = [a.results!, b.results!].map((results) => t.mock.method(results, 'put'));
  assert.throws(() => a.update('A', aid, { Value: '7' }), (e: unknown) => e === error);
  assert.equal(pending, true, 'the prepared evaluation read A\'s uncommitted value through B');
  assert.equal(a.sql.isTransaction, false);
  assert.equal(b.sql.isTransaction, false);
  assert.equal(a.dataStamp(), stamp);
  assert.equal(b.dataStamp(), bstamp);
  assert.equal(a.sql.prepare('SELECT Value FROM A').get()?.Value, 3);
  assert.deepEqual(puts.map((put) => put.mock.callCount()), [0, 0]);
  t.mock.restoreAll();
  const readB = () => {
    const data = b.get('B', bid).fieldData;
    return [data.Echo, data.Total, data.SummaryValue].map(Number);
  };
  assert.deepEqual(readB(), [3, 3, 3], 'B must not retain any value from the rolled-back write');
  // The preparation scope ends after failure; an ordinary successful write is still visible.
  a.update('A', aid, { Value: '11' });
  b.update('B', bid, { Note: 'invalidate again' });
  assert.deepEqual(readB(), [11, 11, 11]);
});

for (const rows of [100, 200, 400]) test(`prepared nested summaries reuse pass-local results with ${rows} rows`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-prepared-nested-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'number' }] },
    ...[1, 2, 3].flatMap((level) => [
      { op: 'createField', table: 'T', name: `Calc${level}`, type: 'number', kind: 'calculation', calculation: level === 1 ? 'Value * 2' : `Total${level - 1}`, options: { unstored: true } },
      { op: 'createField', table: 'T', name: `Total${level}`, kind: 'summary', summary: { type: 'total', field: `Calc${level}` } },
    ]),
  ] as never);
  for (let i = 0; i < rows; i++) store.create('T', { Value: '3' });
  store.shareResults();
  assert.equal(store.warmSummaries('T'), 3);
  let evaluations = 0;
  const value = store.calc.value;
  store.calc.value = function (...args: Parameters<typeof value>) {
    if (args[1].name === 'Value') evaluations++;
    return value.apply(this, args);
  };
  t.after(() => { store.calc.value = value; });
  const start = performance.now();
  store.update('T', 1, { Value: '7' });
  const elapsed = performance.now() - start;
  t.diagnostic(`${rows} rows: ${evaluations} source-field evaluations, ${elapsed.toFixed(1)} ms`);
  assert.ok(evaluations <= 12 * rows + 20, `${evaluations} source-field evaluations must stay linear in ${rows} rows`);
  assert.ok(elapsed < 2000, `prepared edit took ${elapsed.toFixed(1)} ms`);
  store.calc.value = value;
  const data = store.get('T', 1).fieldData;
  assert.equal(Number(data.Total1), 2 * (3 * rows + 4));
  assert.equal(Number(data.Total2), 2 * (3 * rows + 4) * rows);
  assert.equal(Number(data.Total3), 2 * (3 * rows + 4) * rows * rows);
});

for (const cache of ['allowed records', 'sorted found set', 'record count'] as const) {
  for (const failure of ['commit', 'disabled account', 'success'] as const) test(`prepared ${cache}: ${failure === 'success' ? 'publish after commit' : `discard after ${failure} failure`}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-prepared-store-'));
    const open = (name: string) => {
      const path = join(dir, `${name}.sqlite`);
      createStore(path);
      return new Store(path, name);
    };
    const a = open('A'), b = open('B'), identity = open('Identity');
    t.after(() => { a.close(); b.close(); identity.close(); rmSync(dir, { recursive: true, force: true }); });
    identity.setPassword('Admin', 'admin-secret', '[Full Access]');
    identity.setPassword('Worker', 'secret', '[Full Access]');
    a.applyDesign([{ op: 'createTable', name: 'A', fields: [{ name: 'Key', type: 'number' }, { name: 'Value', type: 'number' }] }]);
    const aid = a.create('A', { Key: '1', Value: '3' }).recordId;
    b.resolveFile = (name) => name === 'A' ? a : undefined;
    b.applyDesign([
      { op: 'createTable', name: 'B', fields: [{ name: 'Key', type: 'number' }] },
      { op: 'createDataSource', name: 'A', paths: ['file:A'] },
      { op: 'createOccurrence', name: 'A', file: 'A', externalTable: a.schema.tables[0].id },
      { op: 'createRelationship', left: 'B', right: 'A', predicates: [{ left: 'Key', right: a.schema.tables[0].fields[0].id }] },
    ]);
    const bid = b.create('B', { Key: '1' }).recordId;
    b.savePrivilegeSet({ name: 'Limited', records: { view: 'A::Value = 7', edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: ['fmrest'] });
    b.setPassword('Worker', 'secret', 'Limited');
    const privileges = b.privileges('Worker');
    const sort = [{ fieldName: 'Value', sortOrder: 'ascend' }];
    if (cache === 'sorted found set') {
      // Exercise the large-found-set path, including real on-disk transaction rollback.
      a.sql.exec('BEGIN');
      const insert = a.sql.prepare('INSERT INTO A (_fm_record_id, _fm_mod_id, Key, Value) VALUES (?, 0, 1, ?)');
      for (let id = 2; id <= 2000; id++) insert.run(id, id + 3);
      a.sql.exec('COMMIT');
    }
    let pending = false;
    let refusal: unknown;
    const fail = () => {
      identity.setAccountActive('Worker', false);
      try { identity.requireActiveAccount('Worker'); }
      catch (e) {
        assert.ok(e instanceof StoreError);
        assert.equal(e.code, 212);
        markExecutionRefusal(e);
        refusal = e;
        throw e;
      }
      assert.fail('the disabled account must refuse execution');
    };
    const read = () => cache === 'allowed records'
      ? b.find('B', { privileges }).records.map((r) => r.recordId)
      : a.find({ ...a.layout('A'), fields: a.layout('A').fields.filter((f) => f.name === 'Value') }, { sort, limit: 1 }).records.map((r) => r.recordId);
    a.plugin = (name) => name.toLowerCase() === 'probe' ? { min: 0, call: () => {
      let ids: number[] = [];
      if (Number(a.sql.prepare('SELECT Value FROM A WHERE _fm_record_id = ?').get(cache === 'sorted found set' ? 2000 : aid)?.Value) === (cache === 'sorted found set' ? 0 : 7)) {
        ids = read();
        assert.deepEqual(ids, [cache === 'allowed records' ? bid : 2000]);
        pending = true;
        if (failure === 'disabled account') fail();
      }
      return { type: 'number', value: ids.length };
    } } : undefined;
    a.applyDesign([
      { op: 'createField', table: 'A', name: 'Probe', type: 'number', kind: 'calculation', calculation: cache === 'record count' ? 'If ( Value = 7 ; Get ( TotalRecordCount ) ; 0 )' : 'Probe()', options: { unstored: true } },
      { op: 'createField', table: 'A', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Probe' } },
    ]);
    a.shareResults();
    b.shareResults();
    assert.equal(a.warmSummaries('A'), 1);
    if (cache === 'record count') {
      const value = a.calc.value.bind(a.calc);
      t.mock.method(a.calc, 'value', (...args: Parameters<typeof value>) => {
        const result = value(...args);
        if (args[1].name === 'Probe' && result.type === 'number' && result.value === 2) {
          pending = true;
          if (failure === 'disabled account') fail();
        }
        return result;
      });
    }
    const error = new Error('COMMIT failed');
    if (failure === 'commit') {
      const exec = a.sql.exec.bind(a.sql);
      t.mock.method(a.sql, 'exec', (sql: string) => { if (sql === 'COMMIT') throw error; return exec(sql); });
    }
    const stamp = a.dataStamp(), token = a.writeToken(), btoken = b.writeToken();
    const edit = () => cache === 'record count' ? a.create('A', { Value: '7' }) : a.update('A', cache === 'sorted found set' ? 2000 : aid, { Value: cache === 'sorted found set' ? '0' : '7' });
    if (failure === 'success') {
      edit();
      assert.equal(pending, true);
      assert.equal(a.sql.isTransaction, false);
      const scans = b.allowedScans;
      // A second read must reuse the committed result rather than discarding every preparation cache.
      const prepare = a.sql.prepare.bind(a.sql);
      let sorts = 0;
      t.mock.method(a.sql, 'prepare', (sql: string) => {
        if (/SELECT _fm_record_id AS id .* ORDER BY/.test(sql)) sorts++;
        return prepare(sql);
      });
      if (cache === 'record count') {
        assert.equal(a.recordCount('A'), 2);
        assert.equal(a.find('A', { limit: 0 }).totalCount, 2);
      } else {
        assert.deepEqual(read(), [cache === 'allowed records' ? bid : 2000]);
        assert.equal(b.allowedScans, scans, 'the prepared allowed IDs were published');
        assert.equal(sorts, 0, 'the prepared sorted IDs were published');
      }
      return;
    }
    assert.throws(edit, (e: unknown) => e === (failure === 'commit' ? error : refusal));
    assert.equal(pending, true, 'the cache read observed the pending write');
    assert.equal(a.sql.isTransaction, false);
    assert.equal(b.sql.isTransaction, false);
    assert.equal(a.dataStamp(), stamp);
    t.mock.restoreAll();
    if (cache === 'allowed records') {
      assert.equal(b.canView('B', bid, privileges), false, 'a fresh rule evaluation denies access');
      assert.deepEqual(read(), [], 'find must not return data allowed only before rollback');
    } else if (cache === 'sorted found set') {
      assert.equal(a.sql.prepare('SELECT _fm_record_id FROM A ORDER BY Value, _fm_record_id LIMIT 1').get()?._fm_record_id, 1);
      assert.deepEqual(read(), [1], 'the page must use the committed ordering');
    } else {
      assert.equal(a.sql.prepare('SELECT count(*) AS n FROM A').get()?.n, 1);
      assert.equal(a.recordCount('A'), 1);
      const found = a.find('A');
      assert.equal(found.totalCount, 1);
      assert.equal(found.foundCount, 1);
      assert.equal(found.records.length, 1);
    }
    assert.equal(a.writeToken(), token, 'the cache token must return to its pre-write value');
    assert.equal(b.writeToken(), btoken);
    if (cache !== 'allowed records') {
      // Reuse the failed write's data version with a different change. Pending cache entries
      // must not become valid again when the counter next reaches that version.
      a.update('A', cache === 'sorted found set' ? 2 : aid, { Value: '11' });
      if (cache === 'sorted found set') assert.deepEqual(read(), [1]);
      else assert.equal(a.recordCount('A'), 1);
    }
  });
}


test('rollback-aware cache tokens still invalidate rules after a privilege assignment changes', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-prepared-security-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
  const id = store.create('T', { Value: 'secret' }).recordId;
  for (const name of ['Allowed', 'Denied']) store.savePrivilegeSet({
    name, records: { view: 'PatternCount ( Get ( AccountExtendedPrivileges ) ; "fmrest" )', edit: true, create: true, delete: true },
    layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: name === 'Allowed' ? ['fmrest'] : [],
  });
  store.setPassword('Worker', 'secret', 'Allowed');
  const ids = () => store.find('T', { privileges: store.privileges('Worker') }).records.map((r) => r.recordId);
  assert.deepEqual(ids(), [id]);
  const token = store.writeToken();
  store.sql.exec('BEGIN');
  store.setAccountPrivilegeSet('Worker', 'Denied');
  assert.notEqual(store.writeToken(), token);
  store.sql.exec('ROLLBACK');
  assert.equal(store.writeToken(), token, 'security changes must follow rollback too');
  store.setAccountPrivilegeSet('Worker', 'Denied');
  assert.notEqual(store.writeToken(), token);
  assert.equal(store.canView('T', id, store.privileges('Worker')), false);
  assert.deepEqual(ids(), [], 'the same rule must be reevaluated after the account changes sets');
});

for (const cache of ['privilege invalidation', 'relationship index'] as const) {
  for (const failure of ['commit', 'disabled account', 'success'] as const) test(`prepared ${cache} survives ${failure}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-prepared-invalidation-'));
    const open = (name: string) => {
      const path = join(dir, `${name}.sqlite`);
      createStore(path);
      return new Store(path, name);
    };
    const a = open('A'), b = open('B'), identity = open('Identity');
    t.after(() => { a.close(); b.close(); identity.close(); rmSync(dir, { recursive: true, force: true }); });
    identity.setPassword('Admin', 'admin-secret', '[Full Access]');
    identity.setPassword('Worker', 'secret', '[Full Access]');
    b.applyDesign([{ op: 'createTable', name: 'B', fields: [{ name: 'Value' }] }]);
    const secret = b.create('B', { Value: 'secret' }).recordId;
    b.savePrivilegeSet({ name: 'Denied', records: { view: false, edit: false, create: false, delete: false }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [] });
    b.setPassword('Admin', 'admin-secret', '[Full Access]');
    b.setPassword('Worker', 'secret', '[Full Access]');
    const read = () => b.find('B', { privileges: b.privileges('Worker') }).records.map((r) => r.recordId);
    assert.equal(b.privileges('Worker').full, true);
    assert.deepEqual(read(), [secret]);
    const version = b.sql.prepare('PRAGMA data_version').get()?.data_version;
    a.applyDesign([
      { op: 'createTable', name: 'A', fields: [{ name: 'Key', type: 'number' }, { name: 'Value', type: 'number' }] },
      { op: 'createTable', name: 'U', fields: [{ name: 'Key', type: 'number' }, { name: 'Value', type: 'number' }] },
      { op: 'createRelationship', left: 'A', right: 'U', predicates: [{ left: 'Key', right: 'Key' }] },
      { op: 'createField', table: 'A', name: 'Probe', type: 'number', kind: 'calculation', calculation: cache === 'relationship index' ? 'If ( Value = 7 ; U::Value + Probe() ; 0 )' : 'If ( Value = 7 ; Probe() ; 0 )', options: { unstored: true } },
      { op: 'createField', table: 'A', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Probe' } },
    ]);
    const id = a.create('A', { Key: '1', Value: '3' }).recordId;
    a.create('U', { Key: '1', Value: '11' });
    a.shareResults();
    assert.equal(a.warmSummaries('A'), 1);
    const u = a.schema.tables.find((table) => table.name === 'U')!;
    const key = u.fields.find((field) => field.name === 'Key')!;
    const index = `_fm_match_${u.id}_${key.id}`;
    const hasIndex = () => !!a.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index);
    assert.equal(hasIndex(), false, 'warming the conditional calculation must not create the index');
    let pending = false, refusal: unknown;
    a.plugin = (name) => name.toLowerCase() === 'probe' ? { min: 0, call: () => {
      pending = true;
      assert.equal(a.sql.isTransaction, true, 'the plug-in runs during edit preparation');
      if (cache === 'privilege invalidation') {
        assert.equal(b.privileges('Worker').full, true, 'preparation first copies the warmed privileges');
        b.setAccountPrivilegeSet('Worker', 'Denied');
        assert.equal(b.sql.isTransaction, false, 'B commits independently of A');
        // Success also checks that an unread, invalidated preparation copy cannot be published.
        if (failure !== 'success') assert.throws(read, (e: unknown) => e instanceof StoreError && e.code === 200, 'the preparation sees the new privileges');
      } else assert.equal(hasIndex(), true, 'the conditional related read creates its first index inside A');
      if (failure === 'disabled account') {
        identity.setAccountActive('Worker', false);
        try { identity.requireActiveAccount('Worker'); }
        catch (e) {
          assert.ok(e instanceof StoreError);
          assert.equal(e.code, 212);
          markExecutionRefusal(e);
          refusal = e;
          throw e;
        }
        assert.fail('the disabled account must refuse execution');
      }
      return { type: 'number', value: 1 };
    } } : undefined;
    const error = new Error('COMMIT failed');
    if (failure === 'commit') {
      const exec = a.sql.exec.bind(a.sql);
      t.mock.method(a.sql, 'exec', (sql: string) => { if (sql === 'COMMIT') throw error; return exec(sql); });
    }
    const token = a.writeToken();
    if (failure === 'success') a.update('A', id, { Value: '7' });
    else assert.throws(() => a.update('A', id, { Value: '7' }), (e: unknown) => e === (failure === 'commit' ? error : refusal));
    assert.equal(pending, true);
    assert.equal(a.sql.isTransaction, false);
    assert.equal(b.sql.isTransaction, false);
    assert.equal(a.sql.prepare('SELECT Value FROM A').get()?.Value, failure === 'success' ? 7 : 3);
    if (failure !== 'success') assert.equal(a.writeToken(), token);
    t.mock.restoreAll();
    if (cache === 'privilege invalidation') {
      assert.equal(b.accountPrivilegeSet('Worker'), 'Denied', 'A cannot roll back B\'s committed reassignment');
      assert.equal(b.sql.prepare('PRAGMA data_version').get()?.data_version, version, 'same-connection commits do not advance data_version');
      assert.throws(read, (e: unknown) => e instanceof StoreError && e.code === 200, 'find must not expose the secret after A finishes');
      assert.equal(b.privileges('Worker').full, false);
      const now = Date.now();
      t.mock.method(Date, 'now', () => now + 1000);
      assert.throws(read, (e: unknown) => e instanceof StoreError && e.code === 200, 'the half-second recheck must also retain the committed denial');
      if (failure !== 'success') {
        a.update('A', id, { Value: '11' });
        assert.throws(read, (e: unknown) => e instanceof StoreError && e.code === 200, 'a later edit cannot revive discarded privileges');
      }
    } else {
      assert.equal(hasIndex(), failure === 'success', 'SQLite rolls back only the failed edit\'s index');
      a.calc.ensureIndex(u, key);
      const plan = a.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM U WHERE Key = ? ORDER BY _fm_record_id').all(1);
      assert.ok(plan.some((row) => String(row.detail).includes(index)), JSON.stringify(plan));
      assert.equal(hasIndex(), true, 'the first lookup after rollback must rebuild the index');
    }
  });
}
