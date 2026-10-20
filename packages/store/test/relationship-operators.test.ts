// FileMaker reads a comparative relationship "Left::a < Right::b" as left op
// right, from whichever side it is followed ("Values in the left match field
// are less than values in the right match field", Claris help, Relationships
// that use comparative operators). A period selector, FromDate ≤ Sales::Date
// and ToDate ≥ Sales::Date, relates the sales inside the period; each sale
// relates back to the periods that contain it. Calculations and portals agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('comparative relationships compare left op right, from either side, in calculations and portals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rel-ops-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Periods', fields: [{ name: 'Name', type: 'text' }, { name: 'FromDate', type: 'date' }, { name: 'ToDate', type: 'date' }, { name: 'Floor', type: 'number' }] },
      { op: 'createTable', name: 'Sales', fields: [{ name: 'Date', type: 'date' }, { name: 'Amount', type: 'number' }] },
      { op: 'createRelationship', left: 'Periods', right: 'Sales', predicates: [{ left: 'FromDate', right: 'Date', operator: '≤' }, { left: 'ToDate', right: 'Date', operator: '≥' }] },
      { op: 'createField', table: 'Periods', name: 'Total', type: 'number', kind: 'calculation', calculation: 'Sum ( Sales::Amount )', options: { unstored: true } },
      { op: 'createField', table: 'Sales', name: 'InPeriods', type: 'text', kind: 'calculation', calculation: 'List ( Periods::Name )', options: { unstored: true } },
    ] as never);
    store.create('Periods', { Name: 'March', FromDate: '3/1/2024', ToDate: '3/31/2024' });
    store.create('Periods', { Name: 'Q1', FromDate: '1/1/2024', ToDate: '3/31/2024' });
    for (const [d, a] of [['2/15/2024', '1'], ['3/10/2024', '10'], ['4/2/2024', '100']]) store.create('Sales', { Date: d, Amount: a });

    const periods = Object.fromEntries(store.find('Periods', { limit: 10 }).records.map((r) => [r.fieldData.Name, Number(r.fieldData.Total)]));
    assert.deepEqual(periods, { March: 10, Q1: 11 }, 'from the left: the sales inside each period');
    const sales = Object.fromEntries(store.find('Sales', { limit: 10 }).records.map((r) => [r.fieldData.Date, String(r.fieldData.InPeriods)]));
    assert.deepEqual(sales, { '02/15/2024': 'Q1', '03/10/2024': 'March\nQ1', '04/02/2024': '' }, 'from the right: the periods containing each sale');

    // A portal of the period's sales.
    const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const field = { tableOccurrenceId: occ('Sales'), fieldId: store.schema.tables.find((x) => x.name === 'Sales')!.fields.find((x) => x.name === 'Amount')!.id, tableOccurrence: 'Sales', field: 'Amount', display: 'edit', repetitions: 1 };
    const layout = store.design('Periods')!;
    const portal = { id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ('Sales'), tableOccurrence: 'Sales', rows: 4, initialRow: 1 },
      children: [{ id: 901, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 202, left: 22, bottom: 222, right: 120 }, style: {}, field }] };
    store.applyDesign([{ op: 'updateLayout', layout: 'Periods', design: { objects: [...layout.objects, portal] } as never }]);
    const q1 = store.find('Periods', { query: [{ Name: '==Q1' }], limit: 1 }).records[0];
    assert.deepEqual(store.get('Periods', Number(q1.recordId), 'us', { Sales: { limit: 10 } }).portalData!.Sales.map((r) => Number(r['Sales::Amount'])), [1, 10]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
