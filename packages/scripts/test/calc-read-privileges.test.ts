import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store, type PrivilegeDefinition } from '@tabularius/store';
import { runScript } from '../src/index.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calc-read-privileges-'));
  createStore(join(dir, 'Data.sqlite'));
  const store = new Store(join(dir, 'Data.sqlite'), 'Data');
  store.applyDesign([
    { op: 'createTable', name: 'Tasks', fields: [{ name: 'Key', type: 'number' }, { name: 'Title' }, { name: 'Secret', comment: 'private comment' }, { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '100', increment: 1 } } } }] },
    { op: 'createTable', name: 'Items', fields: [{ name: 'Key', type: 'number' }, { name: 'Title' }, { name: 'Secret' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Tasks', right: 'Items', predicates: [{ left: 'Key', right: 'Key' }] },
    { op: 'createValueList', name: 'Secrets', field: { occurrence: 'Tasks', field: 'Secret' } },
    { op: 'createValueList', name: 'Titles', field: { occurrence: 'Tasks', field: 'Title' } },
    { op: 'createValueList', name: 'Related', field: { occurrence: 'Items', field: 'Title', related: 'Tasks' } },
    { op: 'createValueList', name: 'Private list', values: ['PRIVATE-LIST'] },
    { op: 'createLayout', name: 'Private layout', occurrence: 'Tasks' },
    { op: 'createScript', name: 'Private script', text: 'Exit Script [ 1 ]' },
  ]);
  store.create('Tasks', { Key: 5, Title: 'public', Secret: 'TOPSECRET' });
  store.create('Tasks', { Key: 7, Title: 'HIDDEN-ROW', Secret: 'HIDDEN-SECRET' });
  store.create('Items', { Key: 5, Title: 'visible-item', Secret: 'ITEM-SECRET', Amount: 10 });
  store.create('Items', { Key: 5, Title: 'hidden-item', Secret: 'HIDDEN-ITEM-SECRET', Amount: 20 });
  store.create('Items', { Key: 10, Title: 'higher-item', Secret: 'HIGHER-SECRET', Amount: 30 });
  const layout = store.design('Private layout')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Private layout', design: { objects: layout.objects.map((o) => ({ ...o, name: `private-${o.id}` })) } }]);
  const reader: PrivilegeDefinition = {
    name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
    tables: {
      Tasks: { view: 'Title = "public"', edit: false, create: false, delete: false, fields: { Secret: 'none' } },
      Items: { view: 'Title <> "hidden-item"', edit: false, create: false, delete: false, fields: { Secret: 'none' } },
    },
    layouts: 'viewOnly', layoutAccess: { 'Private layout': { layout: 'none', records: 'none' } },
    scripts: 'viewOnly', scriptAccess: { 'Private script': 'none' },
    valueLists: 'viewOnly', valueListAccess: { 'Private list': 'none' }, extendedPrivileges: [],
  };
  store.savePrivilegeSet(reader);
  store.setPassword('Reader', 'pw', 'Reader');
  const run = (formula: string, fullAccess = false, opts: Parameters<typeof runScript>[2] = {}) => runScript(store, {
    id: 9999, name: 'Probe', fullAccess,
    steps: parseScriptText(`Set Error Capture [ On ]\nSet Variable [ $direct ; Value: Tasks::Secret ]\nExit Script [ Text Result: ${formula} ]`, store.schema)
      .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params })),
  }, { layout: 'Tasks', account: 'Reader', privileges: store.privileges('Reader'), ...opts });
  return { dir, store, reader, run, close: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

for (const [formula, expected] of [
  ['$direct & "|" & ValueListItems ( "" ; "Secrets" )', '|'],
  ['ValueListItems ( "" ; "Titles" )', 'public'],
  ['ValueListItems ( "" ; "Related" )', 'visible-item'],
  ['ValueListItems ( "" ; "Private list" )', ''],
] as const) {
  test(`script value-list privileges: ${formula}`, async () => {
    const s = setup();
    try {
      assert.equal((await s.run(formula)).result, expected);
      assert.notEqual((await s.run(formula, true)).result, expected, 'full access still reads the protected values');
    } finally { s.close(); }
  });
}

for (const [formula, expected] of [
  ['GetNthRecord ( Tasks::Secret ; 1 )', ''],
  ['GetNthRecord ( Secret ; 2 )', ''],
  ['GetField ( "Tasks::Secret" )', ''],
  ['Evaluate ( "Tasks::Secret" )', ''],
  ['GetRepetition ( Tasks::Secret ; 1 )', ''],
  ['GetNthRecord ( Items::Title ; 2 )', ''],
  ['List ( Items::Title )', 'visible-item'],
  ['List ( Items::Secret )', ''],
  ['Last ( Items::Title )', 'visible-item'],
  ['Lookup ( Items::Secret ; "fallback" )', 'fallback'],
  ['Sum ( Items::Amount )', '10'],
  ['Average ( Items::Amount )', '10'],
  ['Min ( Items::Amount )', '10'],
  ['Max ( Items::Amount )', '10'],
  ['Count ( Items::Title )', '1'],
  ['ExecuteSQL ( "SELECT Secret FROM Tasks" ; "" ; "" )', ''],
  ['ExecuteSQL ( "SELECT Title FROM Tasks" ; "" ; "" )', 'public'],
  ['ExecuteSQLe ( "SELECT Title FROM Items" ; "" ; "|" )', 'visible-item|higher-item'],
  ['Get ( TotalRecordCount ) & "|" & Get ( FoundCount ) & "|" & GetRecordIDsFromFoundSet ( 0 )', '1|1|1'],
] as const) {
  test(`script read sweep: ${formula}`, async () => {
    const s = setup();
    try { assert.equal((await s.run(formula)).result, expected); }
    finally { s.close(); }
  });
}

for (const formula of [
  'ValueListNames ( "" )', 'ValueListIDs ( "" )',
  'LayoutNames ( "" )', 'LayoutIDs ( "" )', 'ScriptNames ( "" )', 'ScriptIDs ( "" )',
  'FieldNames ( "" ; "Tasks" )', 'FieldIDs ( "" ; "Tasks" )',
  'FieldComment ( "" ; "Tasks::Secret" )', 'FieldType ( "" ; "Tasks::Secret" )',
  'FieldStyle ( "" ; "Tasks" ; "Secret" )', 'FieldBounds ( "" ; "Tasks" ; "Secret" )', 'FieldRepetitions ( "" ; "Tasks" ; "Secret" )',
  'GetBaseTableName ( Tasks::Secret )',
  'FieldNames ( "" ; "Private layout" )', 'LayoutObjectNames ( "" ; "Private layout" )',
]) {
  test(`design metadata uses script privileges: ${formula}`, async () => {
    const s = setup();
    try {
      const limited = (await s.run(formula)).result;
      const full = (await s.run(formula, true)).result;
      assert.notEqual(full, '', 'the unrestricted probe has metadata');
      assert.notEqual(limited, full, 'inaccessible metadata is excluded');
      assert.doesNotMatch(limited, /private|Private/);
      if (formula.startsWith('Field')) assert.doesNotMatch(limited, /Secret/);
    } finally { s.close(); }
  });
}

for (const formula of ['TableNames ( "" )', 'TableIDs ( "" )', 'BaseTableNames ( "" )', 'BaseTableIDs ( "" )', 'RelationInfo ( "" ; "Tasks" )']) {
  test(`design metadata excludes an inaccessible table: ${formula}`, async () => {
    const s = setup();
    try {
      s.store.savePrivilegeSet({ ...s.reader, tables: { ...s.reader.tables, Items: { ...s.reader.tables!.Items, view: false } } });
      assert.notEqual((await s.run(formula)).result, (await s.run(formula, true)).result);
      assert.doesNotMatch((await s.run(formula)).result, /Items/);
    } finally { s.close(); }
  });
}

test('GetNextSerialValue does not disclose a hidden field counter', async () => {
  const s = setup();
  try {
    s.store.savePrivilegeSet({ ...s.reader, tables: { ...s.reader.tables, Tasks: { ...s.reader.tables!.Tasks, fields: { Serial: 'none' } } } });
    assert.equal((await s.run('GetNextSerialValue ( "" ; "Tasks::Serial" )')).result, '');
    assert.equal((await s.run('GetNextSerialValue ( "" ; "Tasks::Serial" )', true)).result, '102');
  } finally { s.close(); }
});

test('LookupNext hides inaccessible target fields and target records', async () => {
  const s = setup();
  try {
    s.store.update('Tasks', 1, { Key: 7 });
    assert.equal((await s.run('LookupNext ( Items::Secret ; Higher )')).result, '');
    assert.equal((await s.run('LookupNext ( Items::Secret ; Higher )', true)).result, 'HIGHER-SECRET');
    s.store.savePrivilegeSet({ ...s.reader, tables: { ...s.reader.tables, Items: { ...s.reader.tables!.Items, view: 'Key < 10' } } });
    assert.equal((await s.run('LookupNext ( Items::Title ; Higher )')).result, '');
  } finally { s.close(); }
});

test('LookupNext cannot infer a hidden source match field from the nearest public row', async () => {
  const s = setup();
  try {
    s.store.update('Tasks', 1, { Key: 7 });
    s.store.savePrivilegeSet({ ...s.reader, tables: { ...s.reader.tables, Tasks: { ...s.reader.tables!.Tasks, fields: { Secret: 'none', Key: 'none' } } } });
    assert.equal((await s.run('LookupNext ( Items::Title ; Higher )')).result, '');
    assert.equal((await s.run('LookupNext ( Items::Title ; Higher )', true)).result, 'higher-item');
  } finally { s.close(); }
});

test('LookupNext cannot read through an inaccessible source record ID', async () => {
  const s = setup();
  try {
    const r = await s.run('LookupNext ( Items::Title ; Higher )', false, { foundSet: [2] });
    assert.doesNotMatch(r.result, /higher-item/);
    assert.equal(r.error, 200);
  } finally { s.close(); }
});

for (const formula of ['ValueListItems ( "" ; "Related" )', 'List ( Items::Title )']) {
  test(`relationship reads cannot infer a hidden source match field: ${formula}`, async () => {
    const s = setup();
    try {
      if (formula.startsWith('List')) {
        s.store.applyDesign([
          { op: 'deleteRelationship', relationship: s.store.schema.relationships[0].id },
          { op: 'createRelationship', left: 'Tasks', right: 'Items', predicates: [{ left: 'Key', right: 'Key', operator: '<' }] },
        ]);
      }
      s.store.savePrivilegeSet({ ...s.reader, tables: { ...s.reader.tables, Tasks: { ...s.reader.tables!.Tasks, fields: { Secret: 'none', Key: 'none' } } } });
      assert.equal((await s.run(formula)).result, '');
      assert.notEqual((await s.run(formula, true)).result, '');
    } finally { s.close(); }
  });
}

test('summary reads and GetSummary cannot bypass access to the summary field itself', async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'createField', table: 'Tasks', name: 'Total', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Key' } }]);
    s.store.savePrivilegeSet({ ...s.reader, tables: { ...s.reader.tables, Tasks: { ...s.reader.tables!.Tasks, fields: { Secret: 'none', Total: 'none' } } } });
    for (const formula of ['Tasks::Total', 'GetSummary ( Tasks::Total ; Tasks::Total )']) {
      assert.equal((await s.run(formula)).result, '');
      assert.equal((await s.run(formula, true)).result, '5', 'elevation retains the initial visible found set');
    }
  } finally { s.close(); }
});

test('related value lists cannot traverse an inaccessible intermediate record', async () => {
  const s = setup();
  try {
    s.store.applyDesign([
      { op: 'createTable', name: 'Ends', fields: [{ name: 'Key', type: 'number' }, { name: 'Title' }] },
      { op: 'createRelationship', left: 'Items', right: 'Ends', predicates: [{ left: 'Key', right: 'Key' }] },
      { op: 'createValueList', name: 'Via hidden', field: { occurrence: 'Ends', field: 'Title', related: 'Tasks' } },
    ]);
    s.store.update('Tasks', 1, { Key: 7 });
    s.store.create('Items', { Key: 7, Title: 'hidden-item' });
    s.store.create('Ends', { Key: 7, Title: 'at-end' });
    assert.equal((await s.run('ValueListItems ( "" ; "Via hidden" )')).result, '');
    assert.equal((await s.run('ValueListItems ( "" ; "Via hidden" )', true)).result, 'at-end');
  } finally { s.close(); }
});

test('unstored field calculations share metadata and per-list permission checks', async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'createField', table: 'Tasks', name: 'Meta', kind: 'calculation', options: { unstored: true },
      calculation: 'FieldComment ( "" ; "Tasks::Secret" ) & "|" & ValueListItems ( "" ; "Private list" ) & "|" & ValueListItems ( "" ; "Titles" )' }]);
    s.store.savePrivilegeSet({ ...s.reader, valueLists: 'none', valueListAccess: { Titles: 'viewOnly' } });
    assert.equal((await s.run('Tasks::Meta')).result, '||public');
    assert.match((await s.run('Tasks::Meta', true)).result, /^private comment\|PRIVATE-LIST\|/);
  } finally { s.close(); }
});

test('external value lists and field metadata retain destination privileges during local elevation', async () => {
  const s = setup();
  createStore(join(s.dir, 'Other.sqlite'));
  const other = new Store(join(s.dir, 'Other.sqlite'), 'Other');
  try {
    other.applyDesign([
      { op: 'createTable', name: 'Remote', fields: [{ name: 'Public' }, { name: 'Secret' }] },
      { op: 'createValueList', name: 'Remote secrets', field: { occurrence: 'Remote', field: 'Secret' } },
    ]);
    other.create('Remote', { Public: 'remote-public', Secret: 'REMOTE-SECRET' });
    other.savePrivilegeSet({ ...s.reader, tables: {}, records: { ...s.reader.records, fields: { Secret: 'none' } } });
    other.setPassword('Reader', 'pw', 'Reader');
    s.store.applyDesign([{ op: 'createDataSource', name: 'Other', paths: ['file:Other'] }]);
    s.store.resolveFile = (name) => name === 'Other' ? other : undefined;
    s.store.applyDesign([
      { op: 'createOccurrence', name: 'RemoteItems', file: 'Other', externalTable: other.schema.tables[0].id },
      { op: 'createValueList', name: 'Remote fields', values: [] },
      { op: 'createValueList', name: 'Remote alias', values: [] },
    ]);
    // Imported files can contain these lists; the design editor cannot author them yet.
    s.store.schema.valueLists.find((v) => v.name === 'Remote fields')!.field = {
      occurrenceId: s.store.schema.tableOccurrences.find((t) => t.name === 'RemoteItems')!.id,
      fieldId: other.schema.tables[0].fields.find((f) => f.name === 'Secret')!.id,
    };
    s.store.schema.valueLists.find((v) => v.name === 'Remote alias')!.external = {
      dataSourceId: s.store.schema.dataSources[0].id, valueListId: other.schema.valueLists[0].id,
    };
    const formula = 'ValueListItems ( "" ; "Remote fields" ) & "|" & ValueListItems ( "" ; "Remote alias" ) & "|" & FieldNames ( "" ; "RemoteItems" )';
    for (const full of [false, true]) assert.equal((await s.run(formula, full)).result, '||Public');
    other.setPassword('Reader', 'pw', '[Full Access]');
    assert.equal((await s.run(formula, true)).result, 'REMOTE-SECRET|REMOTE-SECRET|Public\rSecret');
  } finally { other.close(); s.close(); }
});
