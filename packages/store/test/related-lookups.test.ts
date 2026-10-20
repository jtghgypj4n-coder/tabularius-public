// A related-record lookup is asked once while the data is the same: a summary
// over a calculation that reads a related field (many orders, few customers)
// queries each customer once, not once per order, and a change is seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, relatedRows, Store } from '../src/index.ts';

test('explicit join flush requeries unchanged data across multi-hop and external stores without moving data versions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-flush-'));
  const open = (name: string) => { createStore(join(dir, name + '.sqlite')); return new Store(join(dir, name + '.sqlite'), name); };
  const root = open('Root');
  const data = open('Data');
  try {
    for (const s of [root, data]) s.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Key' }] },
      { op: 'createTable', name: 'Children', fields: [{ name: 'Key' }, { name: 'Name' }] },
      { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Key', right: 'Key' }] },
    ]);
    root.applyDesign([{ op: 'createOccurrence', name: 'Other', table: 'Children' }, { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createRelationship', left: 'Children', right: 'Other', predicates: [{ left: 'Key', right: 'Key' }] }]);
    root.schema.tableOccurrences.find((o) => o.name === 'Other')!.dataSourceId = root.schema.dataSources[0].id;
    root.resolveFile = (name) => name === 'Data' ? data : undefined;
    const id = root.create('Parents', { Key: 'key' }).recordId;
    root.create('Children', { Key: 'key', Name: 'local' });
    const other = data.create('Parents', { Key: 'key' }).recordId;
    data.create('Children', { Key: 'key', Name: 'external' });
    const queries = new Map<Store, number>();
    for (const s of [root, data]) {
      const lookup = s.calc.lookup.bind(s.calc);
      s.calc.lookup = ((pass, query, run) => lookup(pass, query, () => { queries.set(s, (queries.get(s) ?? 0) + 1); return run(); })) as typeof s.calc.lookup;
    }
    const read = () => {
      assert.equal(root.evaluate('Parents', 'Children::Name', id).value, 'local');
      assert.equal(root.evaluate('Parents', 'Other::Name', id).value, 'external');
      assert.equal(data.evaluate('Parents', 'Children::Name', other).value, 'external');
    };
    read();
    const before = new Map(queries);
    read();
    assert.deepEqual(queries, before);
    const stamps = [root.dataStamp(), data.dataStamp()];
    root.flushJoinResults();
    assert.deepEqual([root.dataStamp(), data.dataStamp()], stamps);
    read();
    for (const s of [root, data]) assert.ok(queries.get(s)! > before.get(s)!);
  } finally {
    root.close(); data.close(); rmSync(dir, { recursive: true });
  }
});

for (const shared of [false, true]) test(`a related lookup is asked once per key while the data is the same${shared ? ' (results shared, summed in a read transaction)' : ''}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-lookups-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  try {
    createStore(path);
    const setup = new Store(path, 'Shop');
    setup.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Rate', type: 'number' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'CustomerId', type: 'number' }, { name: 'Total', type: 'number' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Customers', predicates: [{ left: 'CustomerId', right: 'Id' }] },
      { op: 'createField', table: 'Orders', name: 'Due', type: 'number', kind: 'calculation', calculation: 'Total * Customers::Rate', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'sDue', kind: 'summary', summary: { type: 'total', field: 'Due' } },
    ] as never);
    setup.close();
    const sql = new DatabaseSync(path);
    sql.exec('BEGIN');
    for (let i = 1; i <= 10; i++) sql.prepare('INSERT INTO Customers (Id, Rate) VALUES (?, ?)').run(i, i);
    for (let i = 1; i <= 2000; i++) sql.prepare('INSERT INTO Orders (Id, CustomerId, Total) VALUES (?, ?, ?)').run(i, (i % 10) + 1, 1);
    sql.exec('COMMIT');
    sql.close();

    process.env.TABULARIUS_TRACE_SQL = '1';
    const store = new Store(path, 'Shop');
    if (shared) store.shareResults();
    const write = process.stderr.write;
    let lookups = 0;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      if (/firstRelated/.test(String(chunk))) lookups++;
      return true;
    }) as typeof process.stderr.write;
    try {
      const total = () => Number(store.find('Orders', { limit: 1 }).records[0].fieldData.sDue);
      assert.equal(total(), 200 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10));
      assert.ok(lookups <= 15, `${lookups} lookups`); // 10 customers, not 2000 orders
      // A change to a customer is seen.
      const c = store.find('Customers', { limit: 1, query: [{ Id: '==1' }] }).records[0];
      store.update('Customers', c.recordId, { Rate: '101' });
      assert.equal(total(), 200 * (101 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10));
    } finally {
      process.stderr.write = write;
      delete process.env.TABULARIUS_TRACE_SQL;
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a related lookup on a wide table selects only its keys and requested columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-wide-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const store = new Store(path, 'Shop');
  const write = process.stderr.write;
  let lines = '';
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Kids', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Shown' }, ...Array.from({ length: 200 }, (_, i) => ({ name: `Extra${i}` }))] },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
    ] as never);
    const parent = store.create('Parents', { Id: '7' });
    store.create('Kids', { ParentId: '7', Shown: 'visible' });
    const from = store.schema.tableOccurrences.find((o) => o.name === 'Parents')!.id;
    const to = store.schema.tableOccurrences.find((o) => o.name === 'Kids')!.id;
    process.stderr.write = ((chunk: string | Uint8Array) => { lines += String(chunk); return true; }) as typeof process.stderr.write;
    const row = store.row(store.layout('Parents'), parent.recordId);
    const result = relatedRows(store, from, row, to, { cols: ['Shown'] });
    assert.equal(result?.rows[0].Shown, 'visible');
    const page = lines.split('\n').find((line) => /SELECT x, x, x FROM x WHERE/.test(line) && /relatedRows/.test(line));
    assert.ok(page, lines);
    assert.doesNotMatch(page, /SELECT \* /);
    assert.match(page, /SELECT x, x, x FROM x/); // id, join key and requested field: no wide projection
    assert.ok(!/x, x, x, x FROM x/.test(page), page);
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a related record with a large field is not kept, and what is kept is counted by its size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-lookups-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  try {
    createStore(path);
    const setup = new Store(path, 'Shop');
    setup.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name', type: 'text' }, { name: 'Notes', type: 'text' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'CustomerId', type: 'number' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Customers', predicates: [{ left: 'CustomerId', right: 'Id' }] },
      { op: 'createField', table: 'Orders', name: 'CName', type: 'text', kind: 'calculation', calculation: 'Customers::Name', options: { unstored: true } },
    ] as never);
    setup.close();
    const sql = new DatabaseSync(path);
    sql.exec('BEGIN');
    // Half the customers carry 200 KB of notes.
    for (let i = 1; i <= 100; i++) sql.prepare('INSERT INTO Customers (Id, Name, Notes) VALUES (?, ?, ?)').run(i, `C${i}`, i % 2 ? 'x'.repeat(200_000) : 'short');
    for (let i = 1; i <= 100; i++) sql.prepare('INSERT INTO Orders (Id, CustomerId) VALUES (?, ?)').run(i, i);
    sql.exec('COMMIT');
    sql.close();
    const store = new Store(path, 'Shop');
    try {
      const recs = store.find('Orders', { limit: 100 }).records;
      assert.equal(recs[5].fieldData.CName, 'C6');
      assert.equal(recs[6].fieldData.CName, 'C7');
      const calc = store.calc as unknown as { lookups: Map<string, unknown>; lookupBytes: { bytes: number } };
      let kept = 0;
      for (const [k, v] of calc.lookups) kept += 2 * k.length + 2 * JSON.stringify(v ?? null).length;
      assert.ok(calc.lookups.size > 0 && calc.lookups.size <= 50, `${calc.lookups.size} kept`);
      assert.ok(kept < 64 * 1024 * 50, `${kept} bytes kept`);
      assert.ok(calc.lookupBytes.bytes * 2 >= kept / 2, `${calc.lookupBytes.bytes} counted for ${kept}`);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
