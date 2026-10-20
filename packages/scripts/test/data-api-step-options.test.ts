// Execute FileMaker Data API: options.prohibitmode decides whether fields that
// prohibit modification can be written (entrymode doesn't), and an update's
// fieldData.deleteRelated removes portal rows, as the Data API's PATCH does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { executeDataApi } from '../src/data-api-step.ts';

test('Execute FileMaker Data API: prohibitmode, entrymode and deleteRelated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dapi-step-'));
  try {
    createStore(join(dir, 'D.sqlite'));
    const store = new Store(join(dir, 'D.sqlite'), 'D');
    store.applyDesign([
      { op: 'createTable', name: 'Invoices', fields: [{ name: 'Id', type: 'number' }, { name: 'Stamp', options: { autoEnter: { data: 'web', prohibitModification: true } } },
        { name: 'Qty', options: { validation: { type: 'number' } } }, { name: 'Code', options: { validation: { type: 'number', always: true } } }] },
      { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceId', type: 'number' }, { name: 'Item' }] },
      { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Id', right: 'InvoiceId' }] },
    ] as never);
    const layout = store.design('Invoices')!;
    const portal = { id: 900, kind: 'portal', type: 3, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {}, portal: { tableOccurrenceId: store.schema.tableOccurrences[1].id, tableOccurrence: 'Lines', rows: 3, initialRow: 1 }, children: [] };
    store.applyDesign([{ op: 'updateLayout', layout: 'Invoices', design: { objects: [...layout.objects, portal] } as never }]);
    const inv = store.create('Invoices', { Id: '1' }).recordId;
    const a = store.create('Lines', { InvoiceId: '1', Item: 'a' }).recordId;
    store.create('Lines', { InvoiceId: '1', Item: 'b' });
    store.create('Invoices', { Id: '2' });
    const other = store.create('Lines', { InvoiceId: '2', Item: 'other' }).recordId;
    const call = (body: object) => JSON.parse(executeDataApi(store, JSON.stringify(body), {}).json).messages[0].code;
    const update = (fieldData: object, options?: object) => call({ action: 'update', layouts: 'Invoices', recordId: inv, fieldData, ...(options ? { options } : {}) });
    const stamp = () => store.get('Invoices', inv).fieldData.Stamp;

    assert.equal(update({ Stamp: 'x' }), '201');
    assert.equal(update({ Stamp: 'x' }, { entrymode: 'script' }), '201', 'entrymode is about validation, not prohibit modification');
    assert.equal(stamp(), 'web');
    assert.equal(update({ Stamp: 'x' }, { prohibitmode: 'script' }), '0');
    assert.equal(stamp(), 'x');
    assert.equal(update({ Stamp: 'y' }, { prohibitmode: 'yes' }), '1708');
    // entrymode "script" skips validation "only during data entry", not validation set to Always.
    assert.equal(update({ Qty: 'two' }), '502');
    assert.equal(update({ Qty: 'two' }, { entrymode: 'script' }), '0');
    assert.equal(update({ Code: 'two' }, { entrymode: 'script' }), '502');

    const items = () => store.query('SELECT Item FROM Lines ORDER BY _fm_record_id').map((r) => r.Item);
    // Another invoice's line isn't a row of this one's portal, to delete or to edit.
    assert.equal(update({ deleteRelated: `Lines.${other}` }), '101');
    assert.equal(call({ action: 'update', layouts: 'Invoices', recordId: inv, portalData: { Lines: [{ recordId: other, 'Lines::Item': 'x' }] } }), '101');
    // A stale modId, or a field write that fails, leaves the portal rows as they were.
    assert.equal(call({ action: 'update', layouts: 'Invoices', recordId: inv, modId: 999, fieldData: { deleteRelated: `Lines.${a}` } }), '306');
    assert.equal(update({ deleteRelated: `Lines.${a}`, Stamp: 'z' }), '201');
    assert.deepEqual(items(), ['a', 'b', 'other']);
    assert.equal(update({ deleteRelated: `Lines.${a}` }), '0');
    assert.deepEqual(items(), ['b', 'other']);
    assert.equal(update({ deleteRelated: 'Lines' }), '102');
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
