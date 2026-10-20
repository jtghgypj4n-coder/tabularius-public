// Stored text calculations keep the formatting their formula gives (TextStyleAdd, TextColor...), as unstored ones
// show it: on their own record and in a related field, following the formula's inputs as they change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('stored text calculations keep the formatting their formula gives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-stored-calc-styles-'));
  const path = join(dir, 'Calc.sqlite');
  createStore(path);
  const s = new Store(path, 'Calc');
  try {
    s.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
      { op: 'createField', table: 'Customers', name: 'Badge', kind: 'calculation', calculation: 'Name & If ( Id > 1 ; " " & TextStyleAdd ( "vip" ; Bold ) )' },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Customers', predicates: [{ left: 'CustomerId', right: 'Id' }] },
    ] as never);
    const to = (n: string) => s.schema.tableOccurrences.find((t) => t.name === n)!;
    const fid = (t: string, n: string) => s.schema.tables.find((x) => x.name === t)!.fields.find((f) => f.name === n)!.id;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const cell = (id: number, t: string, n: string, top: number) => ({ id, kind: 'field', type: 1, anchors, style: {}, bounds: { top, left: 20, bottom: top + 20, right: 200 },
      field: { tableOccurrenceId: to(t).id, fieldId: fid(t, n), tableOccurrence: t, field: n, display: 'edit', repetitions: 1 } });
    s.applyDesign([{ op: 'updateLayout', layout: 'Orders', design: { objects: [cell(101, 'Orders', 'CustomerId', 20), cell(102, 'Customers', 'Badge', 50)] } }] as never);

    const ada = s.create('Customers', { Id: 2, Name: 'Ada' }).recordId;
    const bold = [{ start: 4, end: 7, style: 256 }];
    const rec = s.get('Customers', ada);
    assert.equal(rec.fieldData.Badge, 'Ada vip');
    assert.deepEqual(rec.styles?.Badge, bold, 'kept when the record is created');

    // It follows the formula's inputs.
    s.update('Customers', ada, { Name: 'Adah' });
    assert.deepEqual(s.get('Customers', ada).styles?.Badge, [{ start: 5, end: 8, style: 256 }]);
    s.update('Customers', ada, { Id: 1 });
    assert.equal(s.get('Customers', ada).fieldData.Badge, 'Adah');
    assert.equal(s.get('Customers', ada).styles?.Badge, undefined, 'none once the formula gives none');
    s.update('Customers', ada, { Id: 2 });
    assert.deepEqual(s.get('Customers', ada).styles?.Badge, [{ start: 5, end: 8, style: 256 }]);

    // In a related field too.
    const order = s.create('Orders', { CustomerId: 2 }).recordId;
    assert.deepEqual(s.get('Orders', order).styles?.['Customers::Badge'], [{ start: 5, end: 8, style: 256 }]);

    // A duplicate computes its own.
    const copy = s.duplicate('Customers', ada).recordId;
    assert.deepEqual(s.get('Customers', copy).styles?.Badge, [{ start: 5, end: 8, style: 256 }]);

    // A design change computes it again for every record, formatting included.
    s.applyDesign([{ op: 'updateField', table: 'Customers', field: 'Badge', calculation: 'TextStyleAdd ( Name ; Italic )' }] as never);
    assert.deepEqual(s.get('Customers', ada).styles?.Badge, [{ start: 0, end: 4, style: 512 }]);
    s.applyDesign([{ op: 'updateField', table: 'Customers', field: 'Badge', calculation: 'Name' }] as never);
    assert.equal(s.get('Customers', ada).styles?.Badge, undefined);
    s.applyDesign([{ op: 'createField', table: 'Customers', name: 'Shout', kind: 'calculation', calculation: 'TextStyleAdd ( Name ; Bold )' }] as never);
    assert.deepEqual(s.get('Customers', copy).styles?.Shout, [{ start: 0, end: 4, style: 256 }], 'a new field, on records already there');

    // Users still can't format a calculation themselves.
    assert.throws(() => s.update('Customers', ada, { Badge: 'x' }, undefined, { styles: { Badge: bold } }));
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
