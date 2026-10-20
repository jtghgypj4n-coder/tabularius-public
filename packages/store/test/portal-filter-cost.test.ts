// A portal filter is worked out for every related record. One that runs an
// ExecuteSQL query (or reads a summary) reads the file's data version once
// for the request, not once a record, and still sees a change made since.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import * as trace from '../src/trace.ts';

test('a portal filter running ExecuteSQL costs a few statements, not one a related record, and sees changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-portal-filter-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    store.shareResults();
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Kids', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Kind', type: 'text' }] },
      { op: 'createTable', name: 'Settings', fields: [{ name: 'Shown', type: 'text' }] },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
    ] as never);
    store.create('Parents', { Id: '1' });
    store.create('Settings', { Shown: 'a' });
    for (let i = 0; i < 300; i++) store.create('Kids', { ParentId: '1', Kind: i % 3 ? 'a' : 'b' });
    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const layout = store.design('Parents')!;
    const portal = {
      id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ('Kids'), tableOccurrence: 'Kids', rows: 4, initialRow: 1, filter: 'Kind = ExecuteSQL ( "SELECT Shown FROM Settings" ; "" ; "" )' }, children: [],
    };
    store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...layout.objects, portal] } as never }]);
    const id = Number(store.find('Parents', { limit: 1 }).records[0].recordId);
    const rows = () => store.get('Parents', id, 'us', { Kids: { limit: 500 } }).portalData!.Kids.length;
    assert.equal(rows(), 200);
    const before = trace.statements;
    assert.equal(rows(), 200);
    const ran = trace.statements - before;
    assert.ok(ran < 20, `${ran} statements for a filter over 300 related records`);
    store.update('Settings', store.find('Settings', { limit: 1 }).records[0].recordId, { Shown: 'b' });
    assert.equal(rows(), 100, 'a change since is seen');
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ExecuteSQL query run after another process changed the data works its calculated columns out at the new version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-version-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const a = new Store(path, 'Shop');
  let b: Store | undefined;
  try {
    a.shareResults();
    a.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Qty', type: 'number' }] },
      { op: 'createField', table: 'Orders', name: 'cTotal', type: 'number', kind: 'calculation', calculation: 'Qty * 2', options: { unstored: true } },
    ] as never);
    const id = a.create('Orders', { Qty: '1' }).recordId;
    b = new Store(path, 'Shop');
    b.shareResults();
    // A request that read the data version early (its pass keeps it), then another process changes the record.
    assert.deepEqual(a.calc.executeSQL('SELECT cTotal FROM Orders', [], undefined, a.calc.newPass()).map((r) => r.map((v) => String((v as { value: unknown }).value))), [['2']]);
    const pass = a.calc.newPass();
    a.calc.passStamp(pass);
    b.update('Orders', id, { Qty: '5' });
    const rows = a.calc.executeSQL('SELECT Qty, cTotal FROM Orders WHERE Qty > 0', [], undefined, pass).map((r) => r.map((v) => String((v as { value: unknown }).value)));
    assert.deepEqual(rows, [['5', '10']], 'the calculation agrees with the row it was read with');
  } finally {
    a.close();
    b?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a portal showing an ExecuteSQL calculation reads the data version once for the record, not once a row, and sees changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-portal-sql-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const lines: string[] = [];
  process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    store.shareResults();
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Kids', fields: [{ name: 'ParentId', type: 'number' }] },
      { op: 'createTable', name: 'Settings', fields: [{ name: 'Shown', type: 'text' }] },
      { op: 'createField', table: 'Kids', name: 'cSql', type: 'text', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT Shown FROM Settings" ; "" ; "" )', options: { unstored: true } },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
    ] as never);
    store.create('Parents', { Id: '1' });
    const setting = store.create('Settings', { Shown: 'a' }).recordId;
    for (let i = 0; i < 30; i++) store.create('Kids', { ParentId: '1' });
    const occ = store.schema.tableOccurrences.find((t) => t.name === 'Kids')!.id;
    const layout = store.design('Parents')!;
    const field = { id: 901, kind: 'field', type: 5, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 210, left: 20, bottom: 230, right: 200 }, style: {}, field: { field: 'cSql', fieldId: 0, tableOccurrence: 'Kids', tableOccurrenceId: occ } };
    const portal = {
      id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ, tableOccurrence: 'Kids', rows: 4, initialRow: 1 }, children: [field],
    };
    store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...layout.objects, portal] } as never }]);
    const id = Number(store.find('Parents', { limit: 1 }).records[0].recordId);
    const shown = () => store.get('Parents', id, 'us', { Kids: { limit: 50 } }).portalData!.Kids.map((r) => r['Kids::cSql']);
    shown();
    lines.length = 0;
    assert.deepEqual(new Set(shown()), new Set(['a']));
    const versions = lines.filter((l) => l.includes('versionNumber') && l.includes('executeSQL')).length;
    assert.ok(versions <= 3, `${versions} data version reads for 30 portal rows`);
    store.update('Settings', setting, { Shown: 'b' });
    assert.deepEqual(new Set(shown()), new Set(['b']), 'a change since is seen');
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
