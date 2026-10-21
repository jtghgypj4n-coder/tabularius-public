import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

// The separation model: an interface file with no tables of its own and a data file. Design mode reads the data
// file's tables so a layout it generates for an occurrence of a data-file table has that table's fields, and a
// value list can take its values from a data-file field or be one of the data file's lists.
function twoFiles(run: (ui: Store, data: Store) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sep-'));
  try {
    createStore(join(dir, 'Data.sqlite'));
    createStore(join(dir, 'UI.sqlite'));
    const data = new Store(join(dir, 'Data.sqlite'), 'Data');
    const ui = new Store(join(dir, 'UI.sqlite'), 'UI');
    ui.resolveFile = (n) => (n.toLowerCase() === 'data' ? data : undefined);
    data.applyDesign([
      { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name', type: 'text' }, { name: 'City', type: 'text' }] },
      { op: 'createValueList', name: 'Cities', values: ['Oslo', 'Rome'] },
    ]);
    data.create('Contacts', { Name: 'Ann', City: 'Oslo' });
    data.create('Contacts', { Name: 'Bo', City: 'Rome' });
    ui.applyDesign([
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createOccurrence', name: 'Contacts', file: 'Data', externalTable: data.schema.tables[0].id },
    ]);
    run(ui, data);
    ui.close();
    data.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
}

const fieldNames = (ui: Store, layout: string) => {
  const d = ui.designs().layouts.find((l) => l.name === layout)!;
  return (d.objects ?? []).filter((o) => o.kind === 'field').map((o) => o.field!.field);
};

test('a layout generated for an occurrence from the data file has its fields, as a form and as a list', () => {
  twoFiles((ui, data) => {
    ui.applyDesign([
      { op: 'createLayout', name: 'Form', occurrence: 'Contacts' },
      { op: 'createLayout', name: 'List', occurrence: 'Contacts', design: { view: 'list' } },
    ]);
    assert.equal(ui.schema.tables.length, 0, 'the interface file holds no table of its own');
    assert.deepEqual(fieldNames(ui, 'Form'), ['Name', 'City']);
    assert.deepEqual(fieldNames(ui, 'List'), ['Name', 'City']);
    const rows = ui.find('Form', {}).records.map((r) => r.fieldData.Name);
    assert.deepEqual(rows.sort(), ['Ann', 'Bo']);
    assert.equal(data.schema.tables[0].fields.length, 2);
  });
});

test('an occurrence of a file that is not hosted still makes a layout, with no fields', () => {
  twoFiles((ui) => {
    ui.resolveFile = () => undefined;
    ui.applyDesign([{ op: 'createLayout', name: 'Form', occurrence: 'Contacts' }]);
    assert.deepEqual(fieldNames(ui, 'Form'), []);
  });
});

test('a value list takes its values from a data-file field', () => {
  twoFiles((ui, data) => {
    const city = data.schema.tables[0].fields.find((f) => f.name === 'City')!.id;
    ui.applyDesign([{ op: 'createValueList', name: 'Where', field: { occurrence: 'Contacts', field: city } }]);
    const vl = ui.schema.valueLists.find((v) => v.name === 'Where')!;
    assert.deepEqual(ui.valueListItems(vl.id).map((i) => i.value).sort(), ['Oslo', 'Rome']);
  });
});

test('a value list can be one of the data file\'s lists', () => {
  twoFiles((ui, data) => {
    const list = data.schema.valueLists.find((v) => v.name === 'Cities')!;
    ui.applyDesign([{ op: 'createValueList', name: 'Cities', external: { file: 'Data', valueList: list.id } }]);
    const vl = ui.schema.valueLists.find((v) => v.name === 'Cities')!;
    assert.deepEqual(vl.external, { dataSourceId: ui.schema.dataSources[0].id, valueListId: list.id });
    assert.deepEqual(ui.valueListItems(vl.id).map((i) => i.value), ['Oslo', 'Rome']);
    assert.throws(() => ui.applyDesign([{ op: 'createValueList', name: 'Bad', external: { file: 'Data', valueList: list.id }, values: ['x'] }]), /no values or field of its own/);
  });
});
