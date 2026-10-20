// A record showing fields of records two relationships away (Parent → Kid →
// Item) costs a few statements a relationship the first time, and none on a
// warm read while the data is the same; a change since is still seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import * as trace from '../src/trace.ts';

test('fields two relationships away are read once a path, and not again on a warm read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-path-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const lines: string[] = [];
  process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    const items = ['A', 'B', 'C', 'D', 'E'];
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Kids', fields: [{ name: 'Id', type: 'number' }, { name: 'ParentId', type: 'number' }, { name: 'Code', type: 'text' }] },
      { op: 'createTable', name: 'Items', fields: [{ name: 'KidId', type: 'number' }, { name: 'Code', type: 'text' }, { name: 'Name', type: 'text' }] },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
      ...items.flatMap((x) => [
        { op: 'createOccurrence', name: `Items ${x}`, table: 'Items' },
        { op: 'createRelationship', left: 'Kids', right: `Items ${x}`, predicates: [{ left: 'Code', right: 'Code' }] },
      ]),
      ...items.flatMap((x) => ['Name', 'Code'].map((f) => (
        { op: 'createField', table: 'Parents', name: `c${x}${f}`, type: 'text', kind: 'calculation', calculation: `Items ${x}::${f}`, options: { unstored: true } }
      ))),
    ] as never);
    for (let p = 1; p <= 10; p++) {
      store.create('Parents', { Id: String(p) });
      for (let k = 0; k < 3; k++) store.create('Kids', { Id: String(p * 10 + k), ParentId: String(p), Code: `k${p}` });
      store.create('Items', { KidId: String(p), Code: `k${p}`, Name: `item ${p}` });
    }
    const read = () => store.find('Parents', { limit: 10 }).records.map((r) => String(r.fieldData.cCName));
    lines.length = 0;
    let before = trace.statements;
    assert.deepEqual(read(), Array.from({ length: 10 }, (_, i) => `item ${i + 1}`));
    const cold = trace.statements - before;
    const hops = lines.filter((l) => l.includes('CROSS JOIN')).length;
    assert.ok(hops <= 10, `${hops} join queries for 10 records each showing 5 occurrences down one path`);
    before = trace.statements;
    lines.length = 0;
    assert.deepEqual(read(), Array.from({ length: 10 }, (_, i) => `item ${i + 1}`));
    const warm = trace.statements - before;
    assert.ok(warm <= 25, `${warm} statements on a warm read (cold read: ${cold})`);
    store.update('Items', store.find('Items', { limit: 1 }).records[0].recordId, { Name: 'changed' });
    assert.equal(read()[0], 'changed', 'a change since is seen');
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a middle relationship reads only its match fields, and a portal total read with the record is not worked out again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-wide-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const lines: string[] = [];
  process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      // Kids::Code is a number and Items::Code text, so the hop from Kids goes record by record.
      { op: 'createTable', name: 'Kids', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Code', type: 'number' }, { name: 'Notes', type: 'text' }] },
      { op: 'createTable', name: 'Items', fields: [{ name: 'Code', type: 'text' }, { name: 'Name', type: 'text' }] },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
      { op: 'createRelationship', left: 'Kids', right: 'Items', predicates: [{ left: 'Code', right: 'Code' }] },
    ] as never);
    store.create('Parents', { Id: '1' });
    for (let k = 0; k < 5; k++) store.create('Kids', { ParentId: '1', Code: String(k), Notes: 'x'.repeat(10_000) });
    for (let k = 0; k < 5; k++) for (let n = 0; n < 3; n++) store.create('Items', { Code: String(k), Name: n ? 'b' : 'a' });
    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const layout = store.design('Parents')!;
    const portal = {
      id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ('Items'), tableOccurrence: 'Items', rows: 4, initialRow: 1, filter: 'Items::Name = "a"' }, children: [],
    };
    store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...layout.objects, portal] } as never }]);
    const id = Number(store.find('Parents', { limit: 1 }).records[0].recordId);
    lines.length = 0;
    const rec = store.get('Parents', id, 'us', { Items: { limit: 2 } });
    assert.equal(rec.portalData!.Items.length, 2);
    const wide = lines.filter((l) => l.includes('SELECT * ') && l.includes('relatedIds'));
    assert.deepEqual(wide, [], 'the middle records are read with their match field only');
    const before = trace.statements;
    assert.deepEqual(store.portalCounts('Parents', id, undefined, rec), { Items: 5 });
    assert.equal(trace.statements - before, 0, 'the total read with the record is used');
    assert.deepEqual(store.portalCounts('Parents', id), { Items: 5 }, 'and agrees with working it out');
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a portal filter reads the fields it names, not whole related records, and still sees related fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-filter-cols-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const lines: string[] = [];
  process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Kids', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Kind', type: 'text' }, { name: 'ColourId', type: 'number' }, { name: 'Notes', type: 'text' }] },
      { op: 'createTable', name: 'Colours', fields: [{ name: 'Id', type: 'number' }, { name: 'Name', type: 'text' }] },
      { op: 'createField', table: 'Kids', name: 'cLive', type: 'text', kind: 'calculation', calculation: 'Kind & Get ( CurrentTime )', options: { unstored: true } },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
      { op: 'createRelationship', left: 'Kids', right: 'Colours', predicates: [{ left: 'ColourId', right: 'Id' }] },
    ] as never);
    store.create('Parents', { Id: '1' });
    store.create('Colours', { Id: '1', Name: 'red' });
    store.create('Colours', { Id: '2', Name: 'blue' });
    for (let i = 0; i < 30; i++) store.create('Kids', { ParentId: '1', Kind: i % 3 ? 'a' : 'b', ColourId: String(1 + (i % 2)), Notes: 'x'.repeat(5_000) });
    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const id = Number(store.find('Parents', { limit: 1 }).records[0].recordId);
    const withFilter = (filter: string) => {
      const layout = store.design('Parents')!;
      const portal = {
        id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
        portal: { tableOccurrenceId: occ('Kids'), tableOccurrence: 'Kids', rows: 4, initialRow: 1, filter }, children: [],
      };
      store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...layout.objects.filter((o) => o.id !== 900), portal] } as never }]);
      lines.length = 0;
      return store.get('Parents', id, 'us', { Kids: { limit: 100 } }).portalData!.Kids;
    };
    const whole = () => lines.filter((l) => l.includes('SELECT * ') && l.includes('portalRows')).length;
    // Kind a (20 of 30) and red (every other one): 10.
    assert.equal(withFilter('Kind = "a" and Colours::Name = "red"').length, 10);
    assert.equal(whole(), 1, 'only the page shown is read whole');
    // A field worked out from others: the fields its formula names, and the same answer.
    assert.equal(withFilter('Left ( cLive ; 1 ) = "b"').length, 10);
    assert.equal(whole(), 1);
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a portal filter naming a summary, or calling a function past a comment, still reads every column it needs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-filter-whole-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Kids', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Kind', type: 'text' }, { name: 'Amount', type: 'number' }] },
      { op: 'createField', table: 'Kids', name: 'sFrac', kind: 'summary', summary: { type: 'fractionOfTotal', field: 'Amount' } },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
    ] as never);
    store.create('Parents', { Id: '1' });
    for (let i = 0; i < 4; i++) store.create('Kids', { ParentId: '1', Kind: 'a', Amount: String(i + 1) });
    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const id = Number(store.find('Parents', { limit: 1 }).records[0].recordId);
    const withFilter = (filter: string) => {
      const layout = store.design('Parents')!;
      const portal = {
        id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
        portal: { tableOccurrenceId: occ('Kids'), tableOccurrence: 'Kids', rows: 4, initialRow: 1, filter }, children: [],
      };
      store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...layout.objects.filter((o) => o.id !== 900), portal] } as never }]);
      return store.get('Parents', id, 'us', { Kids: { limit: 100 } }).portalData!.Kids.length;
    };
    assert.equal(withFilter('sFrac > 0.25'), 2, 'a fraction of the total reads the record\'s own amount');
    assert.equal(withFilter('Evaluate ( "Amo" & "unt" ) > 2'), 2);
    assert.equal(withFilter('Evaluate /*x*/ ( "Amo" & "unt" ) > 2'), 2);
    assert.equal(withFilter('GetField /**/ ( "Amo" & "unt" ) > 2'), 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a portal reads the columns its rows show, not whole related records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-portal-cols-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const lines: string[] = [];
  process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write;
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Kids', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Kind', type: 'text' }, { name: 'ColourId', type: 'number' }, { name: 'Notes', type: 'text' }] },
      { op: 'createTable', name: 'Colours', fields: [{ name: 'Id', type: 'number' }, { name: 'Name', type: 'text' }] },
      { op: 'createField', table: 'Kids', name: 'cLabel', type: 'text', kind: 'calculation', calculation: 'Kind & "-" & Colours::Name', options: { unstored: true } },
      { op: 'createRelationship', left: 'Parents', right: 'Kids', predicates: [{ left: 'Id', right: 'ParentId' }] },
      { op: 'createRelationship', left: 'Kids', right: 'Colours', predicates: [{ left: 'ColourId', right: 'Id' }] },
    ] as never);
    store.create('Parents', { Id: '1' });
    store.create('Colours', { Id: '1', Name: 'red' });
    for (let i = 0; i < 5; i++) store.create('Kids', { ParentId: '1', Kind: `k${i}`, ColourId: '1', Notes: 'x'.repeat(5_000) });
    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const layout = store.design('Parents')!;
    const field = (id: number, name: string) => ({ id, kind: 'field', type: 5, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 210, left: 20, bottom: 230, right: 200 }, style: {}, field: { field: name, fieldId: 0, tableOccurrence: 'Kids', tableOccurrenceId: occ('Kids') } });
    const portal = {
      id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ('Kids'), tableOccurrence: 'Kids', rows: 4, initialRow: 1 }, children: [field(901, 'Kind'), field(902, 'cLabel')],
    };
    store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...layout.objects, portal] } as never }]);
    const id = Number(store.find('Parents', { limit: 1 }).records[0].recordId);
    lines.length = 0;
    const rows = store.get('Parents', id, 'us', { Kids: { limit: 10 } }).portalData!.Kids;
    assert.deepEqual(rows.map((r) => r['Kids::cLabel']), ['k0-red', 'k1-red', 'k2-red', 'k3-red', 'k4-red']);
    assert.ok(rows.every((r) => r.recordId && r.modId !== undefined));
    assert.deepEqual(lines.filter((l) => l.includes('SELECT * ') && l.includes('portalRows')), [], 'the rows are read with the columns they show');
    // A related field on the layout itself (the first related record) is read the same way.
    store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...layout.objects, portal, { ...field(904, 'Kind'), id: 904 }] } as never }]);
    lines.length = 0;
    assert.equal(store.get('Parents', id, 'us', { Kids: { limit: 10 } }).fieldData['Kids::Kind'], 'k0');
    assert.deepEqual(lines.filter((l) => l.includes('SELECT * ') && l.includes('addRelated')), [], 'the related field reads the columns it shows');
    // The columns are kept per design: a formula changed to name another field reads that one.
    store.applyDesign([{ op: 'updateField', table: 'Kids', field: 'cLabel', calculation: 'Left ( Notes ; 2 )' }] as never);
    assert.deepEqual(store.get('Parents', id, 'us', { Kids: { limit: 10 } }).portalData!.Kids.map((r) => r['Kids::cLabel']), ['xx', 'xx', 'xx', 'xx', 'xx']);
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
