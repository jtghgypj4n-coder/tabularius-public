// Design functions answer from the file's design, as FileMaker's do: FieldType, FieldComment, FieldNames and FieldIDs
// (fields placed on a layout), FieldStyle, FieldRepetitions and FieldBounds, LayoutObjectNames, RelationInfo,
// ValueListIDs, GetNextSerialValue and GetBaseTableName. Also SetRecursion, ExecuteSQLe, GetTokenCount and the
// Get ( ) options that had no answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-design-fns-'));
  createStore(join(dir, 'C.sqlite'));
  store = new Store(join(dir, 'C.sqlite'), 'C');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [
      { name: 'id', type: 'number', options: { autoEnter: { serial: { next: '100', increment: 5 } }, index: { value: true } } },
      { name: 'Name', type: 'text', comment: 'Full name' },
      { name: 'Phones', type: 'text', options: { repetitions: 3 } },
      { name: 'Today', type: 'date', options: { global: true } },
      { name: 'Label', kind: 'calculation', type: 'text', calculation: 'Name & "!"', options: { unstored: true } },
      { name: 'Photo', type: 'container' },
    ] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'id', type: 'number' }, { name: 'CustomerID', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createValueList', name: 'Kinds', values: ['a', 'b'] },
  ] as never);
  store.applyDesign([{ op: 'createRelationship', left: 'Customers', right: 'Invoices', predicates: [{ left: 'id', right: 'CustomerID' }], rightCreate: true, rightDelete: true }] as never);
  const s = store.schema;
  const to = (n: string) => s.tableOccurrences.find((t) => t.name === n)!.id;
  const fid = (t: string, n: string) => s.tables.find((x) => x.name === t)!.fields.find((f) => f.name === n)!.id;
  const kinds = s.valueLists.find((v) => v.name === 'Kinds')!.id;
  const base = { anchors: { left: true, top: true, right: false, bottom: false }, style: {} };
  const field = (id: number, table: string, name: string, bounds: object, extra: object = {}) => ({
    ...base, id, kind: 'field', type: 1, bounds,
    field: { tableOccurrenceId: to(table), tableOccurrence: table, fieldId: fid(table, name), field: name, display: 'edit', repetitions: 1, ...extra },
  });
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [
    { ...field(1, 'Customers', 'Name', { left: 36, top: 48, right: 295, bottom: 65 }), name: 'nameField' },
    field(2, 'Customers', 'Phones', { left: 36, top: 70, right: 200, bottom: 130 }, { repetitions: 2, display: 'radio', valueListId: kinds }),
    field(3, 'Customers', 'id', { left: 300, top: 48, right: 340, bottom: 65 }, { display: 'popup', valueList: 'Kinds' }),
    { ...base, id: 10, kind: 'tab-control', type: 11, name: 'tabs', bounds: { left: 20, top: 150, right: 500, bottom: 400 }, children: [
      { ...base, id: 11, kind: 'tab-panel', type: 12, name: 'First', bounds: { left: 20, top: 170, right: 500, bottom: 400 }, children: [
        { ...base, id: 12, kind: 'portal', type: 9, name: 'lines', bounds: { left: 30, top: 180, right: 400, bottom: 300 },
          portal: { tableOccurrenceId: to('Invoices'), tableOccurrence: 'Invoices', rows: 3, initialRow: 1 },
          children: [{ ...field(13, 'Invoices', 'Total', { left: 30, top: 180, right: 100, bottom: 197 }), name: 'total' }] },
      ] },
      { ...base, id: 14, kind: 'tab-panel', type: 12, bounds: { left: 20, top: 170, right: 500, bottom: 400 }, children: [] },
    ] },
    { ...base, id: 15, kind: 'text', type: 2, name: 'title', text: 'Customers', bounds: { left: 0, top: 0, right: 100, bottom: 20 } },
  ] } } as never]);
  for (let i = 1; i <= 3; i++) store.create('Customers', { Name: `c${i}` });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const run = async (formula: string, layout = 'Customers') => {
  const text = `Exit Script [ Text Result: ${formula} ]`;
  const script = { id: 9999, name: 'test', steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })) } as Script;
  const r = await runScript(store, script, { layout });
  assert.equal(r.error, 0, `${formula}: error ${r.error}`);
  return r.result;
};

test('FieldType gives storage, type, index and repetitions; FieldComment the comment', async () => {
  assert.equal(await run('FieldType ( "" ; "id" )'), 'Standard Number Indexed 1');
  assert.equal(await run('FieldType ( "C" ; "Customers::Phones" )'), 'Standard Text Unindexed 3');
  assert.equal(await run('FieldType ( "" ; "Today" )'), 'Global Date Unindexed 1');
  assert.equal(await run('FieldType ( "" ; "Label" )'), 'UnstoredCalc Text Unindexed 1');
  assert.equal(await run('FieldType ( "" ; "Photo" )'), 'Standard Container Unindexed 1');
  assert.equal(await run('FieldType ( "" ; "Invoices::Total" )'), 'Standard Number Unindexed 1');
  assert.equal(await run('FieldComment ( "C" ; "Customers::Name" )'), 'Full name');
  assert.equal(await run('FieldType ( "Elsewhere" ; "id" )'), '', 'a file that is not open');
});

test('FieldNames and FieldIDs list the fields on a layout, related ones qualified, or a table\'s fields', async () => {
  const s = store.schema;
  const to = s.tableOccurrences.find((t) => t.name === 'Invoices')!.id;
  const ids = (t: string, ...ns: string[]) => ns.map((n) => s.tables.find((x) => x.name === t)!.fields.find((f) => f.name === n)!.id);
  assert.equal(await run('FieldNames ( "C" ; "Customers" )'), 'Name\rPhones\rid\rInvoices::Total');
  assert.equal(await run('FieldIDs ( "C" ; "Customers" )'), [...ids('Customers', 'Name', 'Phones', 'id'), `${to}::${ids('Invoices', 'Total')[0]}`].join('\r'));
  assert.equal(await run('FieldNames ( "C" ; "Invoices::x" )'), '', 'no such layout or table');
  // A layout that doesn't exist, but a table occurrence of that name: its table's fields.
  store.applyDesign([{ op: 'deleteLayout', layout: 'Invoices' }] as never);
  assert.equal(await run('FieldNames ( "C" ; "Invoices" )'), 'id\rCustomerID\rTotal');
  assert.equal(await run('FieldNames ( "" ; "" )'), 'id\rName\rPhones\rToday\rLabel\rPhoto', 'the window\'s table');
});

test('FieldStyle, FieldRepetitions and FieldBounds describe a field on a layout', async () => {
  assert.equal(await run('FieldStyle ( "C" ; "Customers" ; "Name" )'), 'Standard');
  assert.equal(await run('FieldStyle ( "C" ; "Customers" ; "Phones" )'), 'RadioButton Kinds');
  assert.equal(await run('FieldStyle ( "C" ; "Customers" ; "id" )'), 'Popupmenu Kinds');
  assert.equal(await run('FieldRepetitions ( "C" ; "Customers" ; "Phones" )'), '2 vertical');
  assert.equal(await run('FieldRepetitions ( "C" ; "Customers" ; "Name" )'), '1 vertical');
  assert.equal(await run('FieldBounds ( "C" ; "Customers" ; "Name" )'), '36 48 295 65 0');
  assert.equal(await run('FieldBounds ( "C" ; "Customers" ; "Invoices::Total" )'), '30 180 100 197 0');
  assert.equal(await run('FieldBounds ( "C" ; "Customers" ; "Today" )'), '', 'not on the layout');
});

test('LayoutObjectNames lists named objects, with what a named tab, panel or portal holds between < and >', async () => {
  assert.equal(await run('LayoutObjectNames ( "C" ; "Customers" )'), ['nameField', 'tabs', '<', 'First', '<', 'lines', '<', 'total', '>', '>', '>', 'title'].join('\r'));
  assert.equal(await run('LayoutObjectNames ( "C" ; "" )'), '');
});

test('RelationInfo describes each relationship of a table occurrence; ValueListIDs lists the lists', async () => {
  assert.equal(await run('RelationInfo ( "C" ; "Customers" )'), 'Source: C\rTable: Invoices\rOptions: Delete Create\rInvoices::CustomerID = Customers::id');
  assert.equal(await run('RelationInfo ( "C" ; "Invoices" )'), 'Source: C\rTable: Customers\rOptions: Create\rCustomers::id = Invoices::CustomerID');
  assert.equal(await run('ValueListIDs ( "C" )'), String(store.schema.valueLists[0].id));
});

test('GetNextSerialValue gives the next serial number without using it up; GetBaseTableName the table behind a field', async () => {
  assert.equal(await run('GetNextSerialValue ( "C" ; "Customers::id" )'), '115');
  assert.equal(await run('GetNextSerialValue ( "C" ; "id" )'), '115');
  assert.equal(await run('GetNextSerialValue ( "C" ; "Name" )'), '');
  assert.equal(await run('GetBaseTableName ( Invoices::Total ) & "|" & GetBaseTableName ( Name )'), 'Invoices|Customers');
});

test('SetRecursion limits custom function depth and While loops', async () => {
  assert.equal(await run('While ( [ i = 0 ] ; i < 10 ; [ i = i + 1 ] ; i )'), '10');
  assert.equal(await run('SetRecursion ( While ( [ i = 0 ] ; i < 10 ; [ i = i + 1 ] ; i ) ; 100 )'), '10');
  assert.equal(await run('EvaluationError ( Evaluate ( "SetRecursion ( While ( [ i = 0 ] ; i < 10 ; [ i = i + 1 ] ; i ) ; 5 )" ) )'), '1200', 'the recursion error, so the result is "?"');
});

test('ExecuteSQLe returns FileMaker\'s error text where ExecuteSQL gives "?"', async () => {
  assert.equal(await run('ExecuteSQLe ( "SELECT Name FROM Customers WHERE Name = ?" ; "" ; "" ; "c2" )'), 'c2');
  assert.equal(await run('ExecuteSQLe ( "SELECT Title FROM Customers WHERE id = 1" ; "" ; "" )'),
    '? ERROR: FQL0007/(1:7): The column named "Title" does not exist in any table in the column reference\'s scope.');
  assert.equal(await run('ExecuteSQLe ( "SELECT Name¶FROM Nowhere" ; "" ; "" )'), '? ERROR: FQL0002/(2:5): The table named "Nowhere" does not exist.');
  assert.match(await run('ExecuteSQLe ( "SELEC Name FROM Customers" ; "" ; "" )'), /^\? ERROR: FQL0001\/\(1:0\): There is an error in the syntax of the query\.$/);
});

test('GetTokenCount estimates tokens as Claris\'s example counts them', async () => {
  assert.equal(await run('GetTokenCount ( "Claris FileMaker" ) & "|" & GetTokenCount ( "" )'), '4|0');
});

test('Get ( ) options that had no answer', async () => {
  assert.equal(await run('Get ( ActiveRecordNumber ) & "|" & Get ( RecordNumber )'), '1|1');
  for (const p of ['PageCount', 'NetworkType', 'PrinterName', 'CacheFileName', 'CacheFilePath', 'ConnectionAttributes', 'RegionMonitorEvents', 'AccountGroupName']) {
    assert.equal(await run(`Get ( ${p} )`), '', p);
  }
});

test('a field\'s calculation gets the same answers as a script', () => {
  store.applyDesign([{ op: 'createField', table: 'Invoices', name: 'About', kind: 'calculation', type: 'text', options: { unstored: true },
    calculation: 'FieldType ( "" ; "Total" ) & "|" & FieldComment ( "" ; "Customers::Name" ) & "|" & GetNextSerialValue ( Get ( FileName ) ; "Customers::id" ) & "|" & FieldType ( "Elsewhere" ; "Total" )' },
    { op: 'createLayout', name: 'Invoices', occurrence: 'Invoices' }] as never);
  const id = store.create('Invoices', { Total: '5' }).recordId;
  assert.equal(store.get('Invoices', id).fieldData.About, 'Standard Number Unindexed 1|Full name|115|');
});
