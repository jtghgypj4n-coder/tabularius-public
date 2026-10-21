// Patterns about data and scripts: separation model, navigation by parameter, server-side scripts, ExecuteSQL, auto-enter
// and lookups, Evaluate, repeating fields, recursive functions, found-set steps, loops, variable scope, import and export,
// Insert Calculated Result, Go to Related Record.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '../../../store/src/index.ts';
import { pass, partial, unverified, type Pattern, type Workbench } from './framework.ts';

type Table = Store['schema']['tables'][number];
const table = (s: Store, name: string): Table => s.schema.tables.find((t) => t.name === name)!;
const fieldId = (s: Store, tableName: string, field: string): number => table(s, tableName).fields.find((f) => f.name === field)!.id;

/** Customers and their orders, related on Customers::Id = Orders::CustomerId. */
function shop(t: Workbench, name = 'Shop'): Store {
  const s = t.file(name);
  s.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [
      { name: 'Id', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
      { name: 'Name' }, { name: 'City' }, { name: 'Status' },
    ] },
    { op: 'createTable', name: 'Orders', fields: [
      { name: 'Id', type: 'number', options: { autoEnter: { serial: { next: '1000', increment: 1 } } } },
      { name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' },
    ] },
  ]);
  s.applyDesign([{ op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: fieldId(s, 'Customers', 'Id'), right: fieldId(s, 'Orders', 'CustomerId') }] }]);
  for (const [n, c] of [['Ann', 'Oslo'], ['Bo', 'Rome'], ['Cy', 'Oslo'], ['Di', 'Paris']]) s.create('Customers', { Name: n, City: c, Status: 'open' });
  for (const [c, a] of [[1, 10], [1, 20], [2, 5], [3, 7], [3, 8], [3, 9]]) s.create('Orders', { CustomerId: c, Amount: a });
  return s;
}

const lines = (...steps: string[]) => steps.join('\n');

export const DATA_PATTERNS: Pattern[] = [
  {
    id: 'separation-model',
    title: 'Separation model',
    what: 'A user-interface file with no data of its own, whose layouts and scripts work on tables in a data file through an external data source.',
    claris: ['Managing external data sources', 'Working with external tables', 'Perform Script script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const data = t.file('Data');
        data.applyDesign([
          { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }, { name: 'City' }] },
          { op: 'createScript', name: 'Echo', text: 'Exit Script [ Text Result: "data:" & Get ( ScriptParameter ) & ":" & Get ( ScriptName ) ]' },
        ]);
        data.create('Contacts', { Name: 'Ann', City: 'Oslo' });
        data.create('Contacts', { Name: 'Bo', City: 'Rome' });
        const ui = t.file('UI');
        ui.applyDesign([{ op: 'createDataSource', name: 'Data', paths: ['file:Data'] }]);
        t.link();
        ui.applyDesign([
          { op: 'createOccurrence', name: 'Contacts', file: 'Data', externalTable: table(data, 'Contacts').id },
          { op: 'createLayout', name: 'People', occurrence: 'Contacts' },
        ]);
        assert.equal(ui.schema.tables.length, 0, 'the interface file holds no table of its own');
        const r = await t.run(ui, lines(
          'Go to Layout [ “People” ]',
          'Show All Records',
          'New Record/Request',
          'Set Field [ Contacts::Name ; "Cy" ]',
          'Commit Records/Requests [ With dialog: Off ]',
          'Set Variable [ $n ; Value: Get ( FoundCount ) ]',
          'Perform Script [ Specified: By name ; "Data::Echo" ; Parameter: $n ]',
          'Exit Script [ Text Result: $n & "|" & Get ( ScriptResult ) ]',
        ), { layout: 'People' });
        assert.equal(r.error, 0);
        assert.equal(r.result, '3|data:3:Echo', 'a record made through the interface file is in the data file, and a script in the data file is performed by name');
        assert.equal(data.findIds('Contacts').length, 3);
        return pass();
      },
    },
    dataApi: {
      expected: 'pass',
      async run(t) {
        const data = t.file('Data');
        data.applyDesign([{ op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }] }]);
        data.create('Contacts', { Name: 'Ann' });
        const ui = t.file('UI');
        ui.applyDesign([{ op: 'createDataSource', name: 'Data', paths: ['file:Data'] }]);
        t.link();
        ui.applyDesign([
          { op: 'createOccurrence', name: 'Contacts', file: 'Data', externalTable: table(data, 'Contacts').id },
          { op: 'createLayout', name: 'Generated', occurrence: 'Contacts' },
        ], { readOtherFile: () => true }); // the account designing the interface file may design the data file too
        const occurrence = ui.schema.tableOccurrences.find((o) => o.name === 'Contacts')!;
        ui.applyDesign([{ op: 'createLayout', name: 'Placed', occurrence: 'Contacts', design: { objects: [{
          id: 1, kind: 'field', type: 1, bounds: { top: 10, left: 10, bottom: 30, right: 200 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
          field: { tableOccurrenceId: occurrence.id, fieldId: fieldId(data, 'Contacts', 'Name'), tableOccurrence: 'Contacts', field: 'Name', display: 'edit', repetitions: 1 },
        }] as never } }]);
        const api = await t.api('UI');
        const placed = await api.get('/layouts/Placed/records');
        assert.equal(placed.code, '0', placed.message);
        assert.deepEqual(placed.response.data.map((d: any) => d.fieldData.Name), ['Ann'], 'with the field placed, the interface file serves the data file\'s records');
        const generated = await api.get('/layouts/Generated/records');
        assert.deepEqual(generated.response.data.map((d: any) => d.fieldData.Name), ['Ann'], 'a layout design mode generates for the data file\'s table has its fields');
        return pass();
      },
    },
  },
  {
    id: 'navigation-json',
    title: 'Global-field navigation and JSON script parameters',
    what: 'A global field holds where the user is going, and one navigation script reads a JSON script parameter (layout, action, data) to go there and remember the history.',
    claris: ['JSONGetElement function', 'JSONSetElement function', 'Go to Layout script step', 'Set Variable script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([
          { op: 'createField', table: 'Customers', name: 'gTarget', options: { global: true } },
          { op: 'createScript', name: 'Navigate', text: lines(
            'Set Variable [ $layout ; Value: JSONGetElement ( Get ( ScriptParameter ) ; "layout" ) ]',
            'Set Variable [ $id ; Value: JSONGetElement ( Get ( ScriptParameter ) ; "id" ) ]',
            'Set Field [ Customers::gTarget ; $layout ]',
            'Go to Layout [ Layout Name: Customers::gTarget ]',
            'Set Variable [ $$history ; Value: List ( $$history ; Get ( LayoutName ) ) ]',
            'If [ not IsEmpty ( $id ) ]',
            'Enter Find Mode [ Pause: Off ]',
            'Set Field [ Customers::Id ; $id ]',
            'Perform Find [ ]',
            'End If',
            'Exit Script [ Text Result: Get ( LayoutName ) & "|" & Get ( FoundCount ) & "|" & Customers::Name & "|" & ValueCount ( $$history ) ]',
          ) },
        ]);
        const p = (layout: string, id?: number) => `JSONSetElement ( "{}" ; [ "layout" ; "${layout}" ; JSONString ]${id ? `; [ "id" ; ${id} ; JSONNumber ]` : ''} )`;
        const first = await t.run(s, `Perform Script [ “Navigate” ; Parameter: ${p('Customers', 2)} ]\nSet Variable [ $one ; Value: Get ( ScriptResult ) ]\nPerform Script [ “Navigate” ; Parameter: ${p('Orders')} ]\nExit Script [ Text Result: $one & "/" & Get ( ScriptResult ) ]`, { layout: 'Customers' });
        assert.equal(first.error, 0, JSON.stringify(first));
        assert.equal(first.result, 'Customers|1|Bo|1/Orders|6|Ann|2', 'the global field names the layout, the JSON parameter carries the record to find, the history grows across calls');
        return pass();
      },
    },
    dataApi: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([{ op: 'createScript', name: 'Describe', text: 'Exit Script [ Text Result: JSONGetElement ( Get ( ScriptParameter ) ; "layout" ) & ":" & JSONGetElement ( Get ( ScriptParameter ) ; "args.n" ) ]' }]);
        const api = await t.api('Shop');
        const r = await api.get(`/layouts/Customers/script/Describe?script.param=${encodeURIComponent('{"layout":"Orders","args":{"n":5}}')}`);
        assert.equal(r.code, '0', r.message);
        assert.equal(r.response.scriptResult, 'Orders:5', 'a JSON script parameter reaches the script through the Data API');
        assert.equal(r.response.scriptError, '0');
        return pass();
      },
    },
  },
  {
    id: 'script-on-server',
    title: 'Perform Script on Server with a result',
    what: 'A script hands work to the server with a parameter, waits, and reads the result and error back.',
    claris: ['Perform Script on Server script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([
          { op: 'createScript', name: 'Total', text: 'Exit Script [ Text Result: Get ( ScriptParameter ) & ":" & Get ( ScriptName ) ]' },
          { op: 'createScript', name: 'Broken', text: lines('Set Error Capture [ On ]', 'Go to Layout [ Layout Name: "Nowhere" ]', 'Exit Script [ Text Result: Get ( LastError ) ]') },
        ]);
        const queue = { ran: 0, run(job: () => Promise<unknown>) { this.ran++; return job(); } };
        const r = await t.run(s, lines(
          'Perform Script on Server [ “Total” ; Parameter: "sum" ; Wait for completion: On ]',
          'Set Variable [ $ok ; Value: Get ( ScriptResult ) & "/" & Get ( LastError ) ]',
          'Perform Script on Server [ “Broken” ; Wait for completion: On ]',
          'Exit Script [ Text Result: $ok & "|" & Get ( ScriptResult ) ]',
        ), { layout: 'Customers', serverQueue: queue as never });
        assert.equal(r.result, 'sum:Total/0|105', 'the result and the error come back; the server script has its own error state');
        assert.equal(queue.ran, 2, 'both ran through the server queue');
        return pass();
      },
    },
    dataApi: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([
          { op: 'createScript', name: 'Total', text: 'Exit Script [ Text Result: Get ( ScriptParameter ) & ":" & Get ( ScriptName ) ]' },
          { op: 'createScript', name: 'Caller', text: lines('Perform Script on Server [ “Total” ; Parameter: "sum" ]', 'Exit Script [ Text Result: Get ( ScriptResult ) ]') },
        ]);
        const api = await t.api('Shop');
        const r = await api.get('/layouts/Customers/script/Caller');
        assert.equal(r.code, '0', r.message);
        assert.equal(r.response.scriptResult, 'sum:Total', 'the Data API caller got what the server script returned');
        return pass();
      },
    },
  },
  {
    id: 'executesql-report',
    title: 'ExecuteSQL reports with joins',
    what: 'A calculation or script builds a report with ExecuteSQL: a join, a total per group and a sort, with a parameter in the query.',
    claris: ['ExecuteSQL function', 'FileMaker SQL Reference: SELECT, JOIN, GROUP BY, ORDER BY'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        const r = await t.run(s, 'Exit Script [ Text Result: ExecuteSQL ( "SELECT c.Name, SUM(o.Amount), COUNT(*) FROM Customers c JOIN Orders o ON o.CustomerId = c.Id WHERE o.Amount > ? GROUP BY c.Name ORDER BY c.Name DESC" ; "," ; "¶" ; 5 ) ]', { layout: 'Customers' });
        assert.equal(r.error, 0);
        assert.equal(r.result, 'Cy,24,3\rAnn,30,2', 'an inner join drops Bo (his one order is 5, not above 5) and Di (no orders); totals and counts per customer, sorted descending');
        const left = await t.run(s, 'Exit Script [ Text Result: ExecuteSQL ( "SELECT c.Name, COUNT(o.Id) FROM Customers c LEFT OUTER JOIN Orders o ON o.CustomerId = c.Id GROUP BY c.Name ORDER BY c.Name" ; "," ; "¶" ) ]', { layout: 'Customers' });
        assert.equal(left.result, 'Ann,2\rBo,1\rCy,3\rDi,0', 'a left outer join keeps the customer with no orders');
        return pass();
      },
    },
    dataApi: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([{ op: 'createScript', name: 'Report', text: 'Exit Script [ Text Result: ExecuteSQL ( "SELECT c.City, SUM(o.Amount) FROM Customers c JOIN Orders o ON o.CustomerId = c.Id GROUP BY c.City ORDER BY c.City" ; "=" ; ";" ) ]' }]);
        const api = await t.api('Shop');
        const r = await api.get('/layouts/Customers/script/Report');
        assert.equal(r.response.scriptResult, 'Oslo=54;Rome=5', 'the same report through the Data API');
        return pass();
      },
    },
  },
  {
    id: 'auto-enter-lookup-serial',
    title: 'Auto-enter lookups and serial numbers',
    what: 'A new record gets its next serial number and copies a value from a related record when the key is set.',
    claris: ['Entering data automatically: serial numbers, looked-up value', 'Lookup auto-enter'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([
          { op: 'createRelationship', left: 'Orders', right: 'Customers', predicates: [{ left: fieldId(s, 'Orders', 'CustomerId'), right: fieldId(s, 'Customers', 'Id') }] },
        ]);
        s.applyDesign([{ op: 'createField', table: 'Orders', name: 'CustName', options: { autoEnter: { lookup: { occurrenceId: s.schema.tableOccurrences.find((o) => o.name === 'Customers')!.id, fieldId: fieldId(s, 'Customers', 'Name') } } } }]);
        const r = await t.run(s, lines(
          'Go to Layout [ “Orders” ]',
          'New Record/Request',
          'Set Field [ Orders::CustomerId ; 2 ]',
          'Commit Records/Requests [ With dialog: Off ]',
          'Set Variable [ $first ; Value: Orders::Id & "/" & Orders::CustName ]',
          'New Record/Request',
          'Exit Script [ Text Result: $first & "|" & Orders::Id & "|" & Orders::CustName ]',
        ), { layout: 'Customers' });
        assert.equal(r.error, 0);
        assert.equal(r.result, '1006/Bo|1007|', 'serials continue from 1000; the lookup fills in when the key is entered and stays empty when no key was');
        return pass();
      },
    },
    dataApi: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([{ op: 'createRelationship', left: 'Orders', right: 'Customers', predicates: [{ left: fieldId(s, 'Orders', 'CustomerId'), right: fieldId(s, 'Customers', 'Id') }] }]);
        s.applyDesign([{ op: 'createField', table: 'Orders', name: 'CustName', options: { autoEnter: { lookup: { occurrenceId: s.schema.tableOccurrences.find((o) => o.name === 'Customers')!.id, fieldId: fieldId(s, 'Customers', 'Name') } } } }]);
        const api = await t.api('Shop');
        const made = await api.post('/layouts/Orders/records', { fieldData: { CustomerId: 3 } });
        assert.equal(made.code, '0', made.message);
        const got = await api.get(`/layouts/Orders/records/${made.response.recordId}`);
        assert.deepEqual([got.response.data[0].fieldData.Id, got.response.data[0].fieldData.CustName], [1006, 'Cy'], 'a record made through the API gets its serial and its lookup');
        return pass();
      },
    },
  },
  {
    id: 'evaluate-dynamic-fields',
    title: 'Evaluate and dynamic field names',
    what: 'A script or calculation reads or sets a field chosen at run time, by Evaluate, GetField and Set Field by Name.',
    claris: ['Evaluate function', 'GetField function', 'Set Field by Name script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        const r = await t.run(s, lines(
          'Go to Layout [ “Customers” ]',
          'Go to Record/Request/Page [ First ]',
          'Set Variable [ $name ; Value: "Customers::City" ]',
          'Set Field by Name [ "Customers::Status" ; Evaluate ( "Name & \\" \\" & City" ) ]',
          'Set Variable [ $a ; Value: Evaluate ( $name ) ]',
          'Set Variable [ $b ; Value: GetField ( "Name" ) ]',
          'Set Variable [ $c ; Value: Evaluate ( "Upper ( " & $name & " )" ) ]',
          'Set Variable [ $d ; Value: Evaluate ( "1 +" ) ]',
          'Exit Script [ Text Result: $a & "|" & $b & "|" & $c & "|" & $d & "|" & Customers::Status ]',
        ), { layout: 'Customers' });
        assert.equal(r.result, 'Oslo|Ann|OSLO|?|Ann Oslo', 'a field named in text is read, a name can build a formula, and a formula that does not parse gives the error mark');
        return pass();
      },
    },
  },
  {
    id: 'repeating-fields',
    title: 'Repeating fields',
    what: 'A field with several repetitions is set and read by repetition number in scripts and calculations.',
    claris: ['Repeating fields', 'GetRepetition function', 'Set Field script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([{ op: 'createField', table: 'Orders', name: 'Qty', type: 'number', options: { repetitions: 3 } }]);
        const r = await t.run(s, lines(
          'Go to Layout [ “Orders” ]',
          'New Record/Request',
          'Set Field [ Orders::Qty ; 7 ]',
          'Set Field [ Orders::Qty[3] ; 9 ]',
          'Exit Script [ Text Result: GetRepetition ( Orders::Qty ; 1 ) & "," & GetRepetition ( Orders::Qty ; 2 ) & "," & GetRepetition ( Orders::Qty ; 3 ) & "|" & Orders::Qty[3] & "|" & Sum ( Orders::Qty ) ]',
        ), { layout: 'Customers' });
        assert.equal(r.error, 0);
        assert.equal(r.result, '7,,9|9|16', 'repetitions are separate values; Sum adds them all');
        return pass();
      },
    },
    dataApi: {
      expected: 'unverified',
      note: 'Repetitions are written and read as Field(n), with the first as the plain field name. The Claris Data API guide page on repeating fields was not available to compare the naming with.',
      async run(t) {
        const s = shop(t);
        s.applyDesign([{ op: 'createField', table: 'Orders', name: 'Qty', type: 'number', options: { repetitions: 3 } }]);
        const api = await t.api('Shop');
        const made = await api.post('/layouts/Orders/records', { fieldData: { CustomerId: 1, 'Qty(1)': 4, 'Qty(3)': 6 } });
        assert.equal(made.code, '0', made.message);
        const got = await api.get(`/layouts/Orders/records/${made.response.recordId}`);
        const d = got.response.data[0].fieldData;
        assert.deepEqual([d.Qty, d['Qty(2)'], d['Qty(3)']], [4, '', 6], 'the first repetition has the field\'s plain name, the others Field(n)');
        return unverified('repetition 1 is named without a number and later ones as Field(n); the Claris Data API guide page on repeating fields was not available to compare the naming');
      },
    },
  },
  {
    id: 'recursive-custom-function',
    title: 'Recursive custom functions',
    what: 'A custom function that calls itself, with a stop condition and an accumulator.',
    claris: ['About custom functions', 'Creating recursive custom functions'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([
          { op: 'createCustomFunction', name: 'Fact', parameters: ['n'], formula: 'If ( n ≤ 1 ; 1 ; n * Fact ( n - 1 ) )' },
          { op: 'createCustomFunction', name: 'Join', parameters: ['list', 'sep', 'acc'], formula: 'If ( IsEmpty ( list ) ; acc ; Join ( RightValues ( list ; ValueCount ( list ) - 1 ) ; sep ; acc & If ( IsEmpty ( acc ) ; "" ; sep ) & LeftValues ( list ; 1 ) ) )' },
        ]);
        const r = await t.run(s, 'Exit Script [ Text Result: Fact ( 6 ) & "|" & Substitute ( Join ( "a¶b¶c" ; "-" ; "" ) ; "¶" ; "" ) ]', { layout: 'Customers' });
        assert.equal(r.error, 0);
        assert.equal(r.result, '720|a-b-c');
        // Claris: a recursive function that never stops is cut off by the calculation engine's limit, with a blank or "?" result.
        s.applyDesign([{ op: 'createCustomFunction', name: 'Forever', parameters: ['n'], formula: 'Forever ( n + 1 )' }]);
        const loop = await t.run(s, 'Exit Script [ Text Result: Forever ( 1 ) ]', { layout: 'Customers' });
        assert.ok(loop.result === '?' || loop.result === '', `a function that never stops is cut off (got "${loop.result}")`);
        return pass();
      },
    },
  },
  {
    id: 'found-set-steps',
    title: 'Found-set manipulation: Constrain, Extend, Omit',
    what: 'A script narrows, widens and trims the found set with Constrain Found Set, Extend Found Set, Omit Record and Omit Multiple Records.',
    claris: ['Constrain Found Set script step', 'Extend Found Set script step', 'Omit Record script step', 'Omit Multiple Records script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        const found = (field: string, value: string, step: string) => `Enter Find Mode [ Pause: Off ]\nSet Field [ Customers::${field} ; "${value}" ]\n${step}`;
        const r = await t.run(s, lines(
          'Go to Layout [ “Customers” ]',
          found('City', 'Oslo', 'Perform Find [ ]'),
          'Set Variable [ $oslo ; Value: Get ( FoundCount ) ]',
          found('Name', 'Cy', 'Constrain Found Set [ Restore ]'),
          'Set Variable [ $constrained ; Value: Get ( FoundCount ) & Customers::Name ]',
          found('Name', 'Di', 'Extend Found Set [ Restore ]'),
          'Set Variable [ $extended ; Value: Get ( FoundCount ) ]',
          'Show All Records',
          'Go to Record/Request/Page [ First ]',
          'Omit Record',
          'Omit Multiple Records [ 2 ]',
          'Exit Script [ Text Result: $oslo & "|" & $constrained & "|" & $extended & "|" & Get ( FoundCount ) & "|" & Customers::Name ]',
        ), { layout: 'Customers' });
        assert.equal(r.error, 0);
        assert.equal(r.result, '2|1Cy|2|1|Di', 'Oslo has two; constrained to Cy one; extended with Di two; of four, one omitted then two more leaves one');
        return pass();
      },
    },
    dataApi: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        const api = await t.api('Shop');
        const r = await api.post('/layouts/Customers/_find', { query: [{ City: 'Oslo' }, { Name: 'Di' }, { Name: 'Cy', omit: 'true' }] });
        assert.equal(r.code, '0', r.message);
        assert.deepEqual(r.response.data.map((d: any) => d.fieldData.Name).sort(), ['Ann', 'Di'], 'requests are or-ed together and an omit request takes records out, as the Find requests of a found set do');
        void s;
        return pass();
      },
    },
  },
  {
    id: 'loop-error-capture',
    title: 'Loop and Exit Loop If with error capture',
    what: 'A loop walks the found set, exits on a condition, and reads Get ( LastError ) with error capture on.',
    claris: ['Loop script step', 'Exit Loop If script step', 'Set Error Capture script step', 'Get ( LastError ) function'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        const r = await t.run(s, lines(
          'Go to Layout [ “Customers” ]',
          'Show All Records',
          'Set Error Capture [ On ]',
          'Set Variable [ $n ; Value: 0 ]',
          'Go to Record/Request/Page [ First ]',
          'Loop',
          'Set Variable [ $n ; Value: $n + 1 ]',
          'Set Variable [ $names ; Value: List ( $names ; Customers::Name ) ]',
          'Go to Record/Request/Page [ Next ]',
          'Exit Loop If [ Get ( LastError ) <> 0 or $n > 10 ]',
          'End Loop',
          'Set Variable [ $afterLoop ; Value: Get ( LastError ) ]',
          'Go to Layout [ Layout Name: "Nowhere" ]',
          'Exit Script [ Text Result: $n & "|" & Substitute ( $names ; "¶" ; "," ) & "|" & $afterLoop & "|" & Get ( LastError ) ]',
        ), { layout: 'Customers' });
        assert.equal(r.result.split('|').slice(0, 2).join('|'), '4|Ann,Bo,Cy,Di', 'the loop visits each record once and leaves when there is no next record');
        assert.equal(r.result.split('|')[3], '105', 'with error capture on, a step that fails sets the error and the script goes on');
        assert.ok(['0', '101'].includes(r.result.split('|')[2]), `Go to Record Next on the last record gives error 0 or 101 (got ${r.result.split('|')[2]})`);
        return pass();
      },
    },
  },
  {
    id: 'variable-scope',
    title: 'Set Variable scoping across Perform Script',
    what: 'Local ($) variables belong to one script, global ($$) variables to the file; a sub-script gets a parameter and returns a result.',
    claris: ['Using variables', 'Set Variable script step', 'Perform Script script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([{ op: 'createScript', name: 'Child', text: lines(
          'Set Variable [ $y ; Value: "child" ]',
          'Set Variable [ $$fromChild ; Value: $x & "<" & Get ( ScriptParameter ) ]',
          'Set Variable [ $x ; Value: "changed" ]',
          'Exit Script [ Text Result: $y ]',
        ) }]);
        const r = await t.run(s, lines(
          'Set Variable [ $x ; Value: "outer" ]',
          'Set Variable [ $$g ; Value: "global" ]',
          'Perform Script [ “Child” ; Parameter: "p" ]',
          'Exit Script [ Text Result: $x & "|" & $y & "|" & $$g & "|" & $$fromChild & "|" & Get ( ScriptResult ) ]',
        ), { layout: 'Customers' });
        assert.equal(r.error, 0);
        assert.equal(r.result, 'outer||global|<p|child', 'the parent keeps its $x, never sees the child\'s $y, the child could not see $x, the global is visible to both, and the result comes back');
        return pass();
      },
    },
  },
  {
    id: 'import-export-roundtrip',
    title: 'Import and export round trip',
    what: 'Records are exported to a CSV file and imported back into a new table, with field mapping.',
    claris: ['Export Records script step', 'Import Records script step', 'Export and import data formats'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        s.applyDesign([{ op: 'createTable', name: 'Copy', fields: [{ name: 'Name' }, { name: 'City' }] }]);
        const out = await t.run(s, lines(
          'Go to Layout [ “Customers” ]',
          'Show All Records',
          'Export Records [ With dialog: Off ; “people.csv” ; Unicode (UTF-8) ; Fields: Customers::Name, Customers::City ]',
          'Exit Script [ Text Result: Get ( LastError ) ]',
        ), { layout: 'Customers', documents: t.dir });
        assert.equal(out.result, '0');
        const csv = readFileSync(join(t.dir, 'people.csv'), 'utf8');
        assert.match(csv, /"Ann","Oslo"/);
        assert.equal(csv.split('\r\n').filter(Boolean).length, 4);
        writeFileSync(join(t.dir, 'extra.csv'), '"Eve","Bern"\r\n');
        const back = await t.run(s, lines(
          'Go to Layout [ “Copy” ]',
          'Import Records [ With dialog: Off ; “people.csv” ; Add ; Mac Roman ]',
          'Exit Script [ Text Result: Get ( LastError ) & "|" & Get ( FoundCount ) ]',
        ), { layout: 'Customers', documents: t.dir });
        assert.equal(back.error, 0, JSON.stringify(back));
        assert.equal(back.result.split('|')[0], '0');
        assert.equal(s.findIds('Copy').length, 4, 'every exported record came back');
        assert.deepEqual(s.get('Copy', s.findIds('Copy')[0]).fieldData, { Name: 'Ann', City: 'Oslo' });
        return pass();
      },
    },
  },
  {
    id: 'insert-calculated-result',
    title: 'Insert Calculated Result',
    what: 'A script writes a calculated value into a field, with and without selecting the field first.',
    claris: ['Insert Calculated Result script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        const r = await t.run(s, lines(
          'Go to Layout [ “Customers” ]',
          'Go to Record/Request/Page [ First ]',
          'Go to Field [ Customers::Status ]',
          'Insert Calculated Result [ Select ; Customers::Status ; "calc " & Customers::Name ]',
          'Set Variable [ $a ; Value: Customers::Status ]',
          'Insert Calculated Result [ Customers::City ; Upper ( Customers::City ) ]',
          'Commit Records/Requests [ With dialog: Off ]',
          'Exit Script [ Text Result: $a & "|" & Customers::City ]',
        ), { layout: 'Customers' });
        assert.equal(r.error, 0);
        assert.equal(r.result, 'calc Ann|OsloOSLO', 'without Select the result is inserted into the field\'s text, after what is there; with Select it replaces the contents');
        return pass();
      },
    },
  },
  {
    id: 'go-to-related-record',
    title: 'Go to Related Record with match records',
    what: 'A script jumps from a customer to their orders, or from a found set of customers to all their orders, on a layout of the related table.',
    claris: ['Go to Related Record script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = shop(t);
        const go = (...before: string[]) => t.run(s, lines(
          'Go to Layout [ “Customers” ]', 'Show All Records', ...before,
          'Exit Script [ Text Result: Get ( FoundCount ) & "|" & Get ( LayoutTableName ) & "|" & Get ( LastError ) ]',
        ), { layout: 'Customers' });
        const related = 'Go to Related Record [ Show only related records ; From table: “Orders” ; Using layout: “Orders” ]';
        assert.equal((await go('Go to Record/Request/Page [ First ]', related)).result, '2|Orders|0', 'the first customer has two orders');
        assert.equal((await go('Go to Record/Request/Page [ Last ]', related)).result, '4|Customers|101', 'a customer with no orders: error 101 and the window stays where it was');
        assert.equal((await go('Omit Record', 'Go to Record/Request/Page [ First ]', 'Go to Related Record [ Show only related records ; Match all records in current found set ; From table: “Orders” ; Using layout: “Orders” ]')).result,
          '4|Orders|0', 'match all records in the found set: the orders of the three customers left in it');
        return pass();
      },
    },
  },
];
