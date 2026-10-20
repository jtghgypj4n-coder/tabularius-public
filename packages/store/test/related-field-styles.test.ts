// Formatting a related field outside a portal ("TO::Field", the web client's Format menu or a Data API PATCH's
// "styles"): the first related record keeps it, as FileMaker writes the value there, and it shows on both records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('styles on a related field go to the related record, beside the record\'s own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-styles-'));
  createStore(join(dir, 'S.sqlite'));
  const s = new Store(join(dir, 'S.sqlite'), 'S');
  try {
    s.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
      { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }] },
      { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    ] as never);
    const to = (n: string) => s.schema.tableOccurrences.find((t) => t.name === n)!;
    const fid = (t: string, n: string) => s.schema.tables.find((x) => x.name === t)!.fields.find((f) => f.name === n)!.id;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const cell = (id: number, t: string, n: string, top: number) => ({ id, kind: 'field', type: 1, anchors, style: {}, bounds: { top, left: 20, bottom: top + 20, right: 200 },
      field: { tableOccurrenceId: to(t).id, fieldId: fid(t, n), tableOccurrence: t, field: n, display: 'edit', repetitions: 1 } });
    s.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [cell(101, 'Customers', 'Name', 20), cell(102, 'Orders', 'Item', 50)] } }] as never);
    const ada = s.create('Customers', { Id: 1, Name: 'Ada' }).recordId;
    const tea = s.create('Orders', { CustomerId: 1, Item: 'Tea' }).recordId;
    const bold = [{ start: 0, end: 3, style: 1 }];
    const italic = [{ start: 0, end: 2, style: 2 }];
    s.update('Customers', ada, { Name: 'Ada', 'Orders::Item': 'Tea' }, undefined, { styles: { Name: italic, 'Orders::Item': bold } });
    const rec = s.get('Customers', ada);
    assert.deepEqual(rec.styles?.['Orders::Item'], bold);
    assert.deepEqual(rec.styles?.Name, italic);
    // The order keeps it on its own record.
    assert.deepEqual(s.get('Orders', tea).styles?.Item, bold);
    // Only the related field's formatting: the record's own stays as it was.
    s.update('Customers', ada, { 'Orders::Item': 'Tea' }, undefined, { styles: { 'Orders::Item': [] } });
    assert.equal(s.get('Orders', tea).styles?.Item, undefined);
    assert.deepEqual(s.get('Customers', ada).styles?.Name, italic);
    // Formatting needs the field's value in the same write.
    assert.throws(() => s.update('Customers', ada, { Name: 'Ada' }, undefined, { styles: { 'Orders::Item': bold } }));
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
