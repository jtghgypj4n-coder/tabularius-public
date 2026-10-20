import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeStepParams, scriptStepName, scriptText, undecodedOptionError, type FieldRef, type Script, type ScriptStep, type StepParams } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store, type FieldData, type PrivilegeDefinition } from '@tabularius/store';
import { runScript, ScriptEngine } from '../src/index.ts';
import { xlsx } from '../src/xlsx.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-'));
  createStore(join(dir, 'Target.sqlite'));
  const store = new Store(join(dir, 'Target.sqlite'), 'Target');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [
    { name: 'Code', type: 'text' }, { name: 'Region', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Note', type: 'text' },
    { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '10', increment: 1 } } } },
    { name: 'Stamp', type: 'text', options: { autoEnter: { value: 'modificationAccountName' } } },
    { name: 'Default', type: 'text', options: { autoEnter: { data: 'default' } } },
    { name: 'Auto', type: 'text', calculation: 'Name & "!"', options: { autoEnter: { calculation: true, replaceExisting: true } } },
    { name: 'Computed', type: 'text', kind: 'calculation', calculation: 'Name & "?"' },
  ] }]);
  const field = (name: string): FieldRef => ({
    tableOccurrence: { id: store.schema.tableOccurrences.find((t) => t.name === 'People')!.id, name: 'People' },
    field: { id: store.schema.tables.find((t) => t.name === 'People')!.fields.find((f) => f.name === name)!.id, name },
  });
  const mapping = (names: string[], matches: string[] = []): NonNullable<StepParams['fieldMapping']> => names.map((name) => ({
    field: field(name), import: !matches.includes(name), ...(matches.includes(name) ? { match: true } : {}),
  }));
  const step = (params: StepParams): ScriptStep => ({ stepId: 35, name: 'Import Records', enabled: true, params });
  const run = (params: StepParams, opts: Parameters<typeof runScript>[2] = {}, before: ScriptStep[] = []) => runScript(store, {
    id: 9999, name: 'Import', steps: [...before, step({ filePaths: ['data.csv'], fieldMapping: mapping(['Code', 'Region', 'Name', 'Note']), ...params })],
  } as Script, { layout: 'People', documents: dir, ...opts });
  const add = (data: FieldData) => store.create('People', data, { performAutoEnter: false }).recordId;
  const data = (id: number) => store.get('People', id).fieldData;
  const close = () => { store.close(); rmSync(dir, { recursive: true }); };
  return { dir, store, field, mapping, run, add, data, close };
}

test('Import Records Add creates rows and makes only imported records the found set', async () => {
  const s = setup();
  try {
    const original = s.add({ Code: 'old', Name: 'original' });
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,Ada,\nB,East,Bob,hello\n');
    const r = await s.run({ importAction: 'add' }, { foundSet: [original] });
    assert.equal(r.error, 0);
    assert.equal(s.store.findIds('People').length, 3);
    assert.deepEqual(r.foundSet, [original + 1, original + 2]);
    assert.equal(s.data(original).Name, 'original');
    assert.equal(s.data(original + 1).Name, 'Ada');
  } finally { s.close(); }
});

test('Import Records Replace updates the found set by order, starts at its first record and clears blanks', async () => {
  const s = setup();
  try {
    const a = s.add({ Code: 'A', Name: 'first', Note: 'keep' });
    const outside = s.add({ Code: 'B', Name: 'outside', Note: 'outside' });
    const c = s.add({ Code: 'C', Name: 'third', Note: 'clear' });
    writeFileSync(join(s.dir, 'data.csv'), 'new third,\nnew first,\nignored,\n');
    const r = await s.run({ importAction: 'replace', fieldMapping: [
      { field: s.field('Name'), import: true }, { field: s.field('Note'), import: false },
    ] }, { foundSet: [c, a] }, [{ stepId: 16, name: 'Go to Record/Request/Page', enabled: true, params: { location: 'last' } }]);
    assert.equal(r.error, 0);
    assert.deepEqual(r.foundSet, [c, a]);
    assert.equal(s.store.findIds('People').length, 3);
    assert.equal(s.data(c).Name, 'new third');
    assert.equal(s.data(a).Name, 'new first');
    assert.equal(s.data(outside).Name, 'outside');
    assert.equal(s.data(c).Note, 'clear', 'unmapped fields are retained');
    writeFileSync(join(s.dir, 'data.csv'), ',\n');
    const clear = await s.run({ importAction: 'replace', fieldMapping: s.mapping(['Name', 'Note']) }, { foundSet: [c, a] });
    assert.equal(clear.error, 0);
    assert.deepEqual(clear.foundSet, [c], 'extra target records are not imported');
    assert.equal(s.data(c).Name, '');
    assert.equal(s.data(c).Note, '');
    assert.equal(s.data(a).Name, 'new first');
  } finally { s.close(); }
});

test('Import Records Replace optionally adds source rows beyond the found set, including an empty found set', async () => {
  const s = setup();
  try {
    const a = s.add({ Name: 'old' });
    writeFileSync(join(s.dir, 'data.csv'), 'first\nsecond\n');
    const params: StepParams = { importAction: 'replace', addRemaining: true, fieldMapping: s.mapping(['Name']) };
    const r = await s.run(params, { foundSet: [a] });
    assert.equal(r.error, 0);
    assert.deepEqual(r.foundSet, [a, a + 1]);
    assert.equal(s.data(a).Name, 'first');
    assert.equal(s.data(a + 1).Name, 'second');
    const none = await s.run({ ...params, addRemaining: false }, { foundSet: [] });
    assert.equal(none.error, 0);
    assert.deepEqual(none.foundSet, []);
    assert.equal(s.store.findIds('People').length, 2);
    const added = await s.run(params, { foundSet: [] });
    assert.equal(added.error, 0);
    assert.equal(added.foundCount, 2);
    assert.equal(s.store.findIds('People').length, 4);
  } finally { s.close(); }
});

for (const addRemaining of [false, true]) test(`Import Records Update uses all match fields and scopes matches to the found set (add remaining ${addRemaining})`, async () => {
  const s = setup();
  try {
    const a = s.add({ Code: 'A', Region: 'West', Name: 'first', Note: 'clear' });
    const b = s.add({ Code: 'A', Region: 'East', Name: 'other region' });
    const outside = s.add({ Code: 'B', Region: 'West', Name: 'outside' });
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,new,\nB,West,added,note\nC,North,unmatched,\n');
    const r = await s.run({ importAction: 'update', addRemaining, fieldMapping: s.mapping(['Code', 'Region', 'Name', 'Note'], ['Code', 'Region']) }, { foundSet: [b, a] });
    assert.equal(r.error, 0);
    assert.equal(s.data(a).Name, 'new');
    assert.equal(s.data(a).Note, '');
    assert.equal(s.data(b).Name, 'other region');
    assert.equal(s.data(outside).Name, 'outside', 'a matching record outside the found set is untouched');
    assert.deepEqual(r.foundSet, addRemaining ? [a, outside + 1, outside + 2] : [a]);
    assert.equal(s.store.findIds('People').length, addRemaining ? 5 : 3);
    if (addRemaining) {
      assert.equal(s.data(outside + 1).Code, 'B', 'match fields are imported into new records');
      assert.equal(s.data(outside + 1).Region, 'West');
    }
  } finally { s.close(); }
});

test('Import Records Update updates every duplicate target with the last source match and excludes empty keys', async () => {
  const s = setup();
  try {
    const a = s.add({ Code: 'A', Region: 'West', Name: 'first' });
    const b = s.add({ Code: 'A', Region: 'West', Name: 'duplicate' });
    const blank = s.add({ Name: 'empty key' });
    const partial = s.add({ Code: 'A', Name: 'partial key' });
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,first update\nA,West,last update\n,,must not add\nA,,partial update\n');
    const r = await s.run({ importAction: 'update', addRemaining: true, fieldMapping: s.mapping(['Code', 'Region', 'Name'], ['Code', 'Region']) });
    assert.equal(r.error, 0);
    assert.deepEqual(r.foundSet, [a, b, partial], 'each updated record appears once');
    assert.equal(s.data(a).Name, 'last update');
    assert.equal(s.data(b).Name, 'last update');
    assert.equal(s.data(blank).Name, 'empty key');
    assert.equal(s.data(partial).Name, 'partial update');
    assert.equal(s.store.findIds('People').length, 4);
  } finally { s.close(); }
});

test('Import Records Update requires match fields before writing anything', async () => {
  const s = setup();
  try {
    const a = s.add({ Code: 'A', Name: 'old' });
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,new\n');
    const r = await s.run({ importAction: 'update', addRemaining: true });
    assert.equal(r.error, 400);
    assert.equal(s.data(a).Name, 'old');
    assert.equal(s.store.findIds('People').length, 1);
  } finally { s.close(); }
});

test('Import Records text parses actions, mappings, match fields and options and round-trips them', async () => {
  const s = setup();
  try {
    const text = 'Import Records [ With dialog: Off ; Table: People ; Source: “data.csv” ; Comma-Separated Values ; Update ; Fields: People::Code, People::Region, People::Name, Don\'t Import ; Match fields: People::Code, People::Region ; Add remaining data as new records: On ; Perform auto-enter options: Off ]';
    const parsed = parseScriptText(text, s.store.schema)[0];
    const params = parsed.params!;
    assert.equal(params.importAction, 'update');
    assert.equal(params.performAutoEnter, false);
    assert.deepEqual(params.fieldMapping?.map((m) => [m.import, !!m.match]), [[false, true], [false, true], [true, false], [false, false]]);
    assert.equal(scriptText([{ stepId: 35, name: 'Import Records', enabled: true, params }]), text);
    const a = s.add({ Code: 'A', Region: 'West', Name: 'old' });
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,new,skip\n');
    assert.equal((await s.run(params)).error, 0);
    assert.equal(s.data(a).Name, 'new');
    for (const [option, action] of [['Add', 'add'], ['Replace', 'replace'], ['Update existing records in found set', 'replace'], ['Update matching records in found set', 'update']]) {
      assert.equal(parseScriptText(`Import Records [ Source: "data.csv" ; ${option} ]`, s.store.schema)[0].params?.importAction, action);
    }
  } finally { s.close(); }
});

for (const performAutoEnter of [false, true]) test(`Import Records respects perform auto-enter ${performAutoEnter} on adds and updates, preserving calculations and validation`, async () => {
  const s = setup();
  try {
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,Ada\n');
    const r = await s.run({ performAutoEnter }, { account: 'Importer' });
    assert.equal(r.error, 0);
    const id = r.foundSet![0];
    const row = s.data(id);
    assert.equal(row.Serial, performAutoEnter ? 10 : '');
    assert.equal(row.Stamp, performAutoEnter ? 'Importer' : '');
    assert.equal(row.Default, performAutoEnter ? 'default' : '');
    assert.equal(row.Auto, performAutoEnter ? 'Ada!' : '');
    assert.equal(row.Computed, 'Ada?');
    s.store.update('People', id, { Stamp: 'preserved' }, undefined, { performAutoEnter: false });
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,Bob\n');
    const update = await s.run({ importAction: 'update', performAutoEnter, fieldMapping: s.mapping(['Code', 'Region', 'Name'], ['Code', 'Region']) }, { account: 'Updater' });
    assert.equal(update.error, 0);
    assert.equal(s.data(id).Stamp, performAutoEnter ? 'Updater' : 'preserved');
    assert.equal(s.data(id).Auto, performAutoEnter ? 'Bob!' : '');
    assert.equal(s.data(id).Computed, 'Bob?');
    s.store.applyDesign([{ op: 'updateField', table: 'People', field: 'Name', options: { validation: { always: true, notEmpty: true } } }]);
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,\n');
    const invalid = await s.run({ importAction: 'replace', performAutoEnter }, { foundSet: [id] });
    assert.equal(invalid.error, 509);
    assert.equal(s.data(id).Name, 'Bob', 'suppression does not suppress validation');
    assert.equal(s.store.findIds('People').length, 1);
  } finally { s.close(); }
});

for (const importAction of ['add', 'replace', 'update'] as const) test(`Import Records ${importAction} skips a duplicate unique field but keeps the row's other fields`, async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'updateField', table: 'People', field: 'Code', options: { validation: { always: true, unique: true } } }]);
    const taken = s.add({ Code: 'A', Name: 'taken' });
    const target = s.add({ Code: 'B', Name: 'before' });
    writeFileSync(join(s.dir, 'data.csv'), importAction === 'update' ? 'B,A,after\n' : 'A,after\n');
    const fieldMapping = importAction === 'update'
      ? [{ field: s.field('Code'), import: false, match: true }, { field: s.field('Code'), import: true }, { field: s.field('Name'), import: true }]
      : s.mapping(['Code', 'Name']);
    const r = await s.run({ importAction, fieldMapping }, { foundSet: [target] });
    assert.equal(r.error, 504);
    const changed = importAction === 'add' ? target + 1 : target;
    assert.deepEqual(r.foundSet, [changed]);
    assert.equal(s.data(changed).Name, 'after');
    assert.equal(s.data(changed).Code, importAction === 'add' ? '' : 'B');
    assert.equal(s.data(taken).Name, 'taken');
    assert.equal(s.store.get('People', changed).modId, importAction === 'add' ? 0 : 1);
  } finally { s.close(); }
});

test('Import Records continues after a record-level validation failure in the middle of a file', async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'updateField', table: 'People', field: 'Name', options: { validation: { always: true, notEmpty: true } } }]);
    writeFileSync(join(s.dir, 'data.csv'), 'A,first\nB,\nC,last\n');
    const r = await s.run({ importAction: 'add', fieldMapping: s.mapping(['Code', 'Name']) });
    assert.equal(r.error, 509);
    assert.equal(s.store.findIds('People').length, 2);
    assert.deepEqual(r.foundSet?.map((id) => s.data(id).Name), ['first', 'last']);
  } finally { s.close(); }
});

test('Import Records enforces record edit/create rules and field access, including match-field visibility', async () => {
  const s = setup();
  try {
    const a = s.add({ Code: 'A', Region: 'West', Name: 'allowed' });
    const b = s.add({ Code: 'B', Region: 'East', Name: 'denied' });
    const definition: PrivilegeDefinition = {
      name: 'Importer', records: { view: true, edit: 'Region = "West"', create: false, delete: false, fields: { Code: 'viewOnly' } },
      layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
    };
    s.store.savePrivilegeSet(definition);
    s.store.setPassword('Clerk', 'pw', 'Importer');
    const opts = () => ({ account: 'Clerk', privileges: s.store.privileges('Clerk'), foundSet: [a, b] });
    writeFileSync(join(s.dir, 'data.csv'), 'A,new allowed\nB,new denied\nC,new row\n');
    const params: StepParams = { importAction: 'update', addRemaining: true, fieldMapping: s.mapping(['Code', 'Name'], ['Code']) };
    const r = await s.run(params, opts());
    assert.equal(r.error, 200);
    assert.equal(s.data(a).Name, 'new allowed', 'view-only fields may be used as match fields');
    assert.equal(s.data(b).Name, 'denied');
    assert.equal(s.store.findIds('People').length, 2);
    s.store.savePrivilegeSet({ ...definition, records: { ...definition.records, fields: { Name: 'viewOnly' } } });
    assert.equal((await s.run({ ...params, addRemaining: false }, opts())).error, 201);
    assert.equal(s.data(a).Name, 'new allowed');
    for (const level of ['none', 'masked'] as const) {
      s.store.savePrivilegeSet({ ...definition, records: { ...definition.records, fields: { Code: level } } });
      assert.equal((await s.run(params, opts())).error, 201);
      assert.equal(s.store.findIds('People').length, 2, 'hidden keys cannot become empty matches or additions');
    }
    s.store.savePrivilegeSet({ ...definition, records: { ...definition.records, fields: {} } });
    assert.equal((await s.run({ importAction: 'add' }, opts())).error, 200);
    assert.equal((await s.run({ importAction: 'replace', fieldMapping: s.mapping(['Name']) }, { ...opts(), foundSet: [b] })).error, 200);
    assert.equal(s.data(b).Name, 'denied');
  } finally { s.close(); }
});

for (const format of ['csv', 'tab', 'xlsx', 'xml', 'fmp12']) test(`Import Records keeps ${format} sources working for Add, Replace and Update`, async () => {
  const s = setup();
  let source: Store | undefined;
  try {
    const a = s.add({ Code: 'A', Region: 'West', Name: 'old' });
    let params: StepParams = { filePaths: [`data.${format}`], fieldMapping: s.mapping(['Code', 'Region', 'Name']) };
    if (format === 'csv') writeFileSync(join(s.dir, 'data.csv'), 'A,West,new\n');
    else if (format === 'tab') writeFileSync(join(s.dir, 'data.tab'), 'A\tWest\tnew\n');
    else if (format === 'xlsx') writeFileSync(join(s.dir, 'data.xlsx'), xlsx([['A', 'West', 'new']]));
    else if (format === 'xml') writeFileSync(join(s.dir, 'data.xml'), '<FMPXMLRESULT><RESULTSET><ROW><COL><DATA>A</DATA></COL><COL><DATA>West</DATA></COL><COL><DATA>new</DATA></COL></ROW></RESULTSET></FMPXMLRESULT>');
    else {
      createStore(join(s.dir, 'Source.sqlite'));
      source = new Store(join(s.dir, 'Source.sqlite'), 'Source');
      source.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Code' }, { name: 'Region' }, { name: 'Name' }] }]);
      source.create('Rows', { Code: 'A', Region: 'West', Name: 'new' });
      s.store.resolveFile = (name) => name === 'Source' ? source : undefined;
      params = { ...params, filePaths: ['Source.fmp12'], importFormat: 'FMPR', importSource: {
        tableOccurrenceId: source.schema.tableOccurrences.find((t) => t.name === 'Rows')!.id,
        fieldIds: source.schema.tables.find((t) => t.name === 'Rows')!.fields.map((f) => f.id),
      } };
    }
    assert.equal((await s.run({ ...params, importAction: 'replace' }, { foundSet: [a] })).error, 0);
    assert.equal(s.data(a).Name, 'new');
    s.store.update('People', a, { Name: 'old again' });
    assert.equal((await s.run({ ...params, importAction: 'update', fieldMapping: s.mapping(['Code', 'Region', 'Name'], ['Code', 'Region']) }, { foundSet: [a] })).error, 0);
    assert.equal(s.data(a).Name, 'new');
    const added = await s.run({ ...params, importAction: 'add' });
    assert.equal(added.error, 0);
    assert.deepEqual(added.foundSet, [a + 1]);
    assert.equal(s.data(a + 1).Name, 'new');
  } finally { source?.close(); s.close(); }
});

for (const date of ['2026-01-02', '1/2/2026']) test(`Import Records normalizes composite numeric and date match keys (${date})`, async () => {
  const s = setup();
  try {
    s.store.applyDesign([
      { op: 'createField', table: 'People', name: 'Number', type: 'number' },
      { op: 'createField', table: 'People', name: 'Date', type: 'date' },
    ]);
    const a = s.add({ Number: 123, Date: '2026-01-02', Name: 'old' });
    writeFileSync(join(s.dir, 'data.csv'), `00123,${date},updated\n124,${date},added\n`);
    const r = await s.run({ importAction: 'update', addRemaining: true, fieldMapping: s.mapping(['Number', 'Date', 'Name'], ['Number', 'Date']) });
    assert.equal(r.error, 0);
    assert.deepEqual(r.foundSet, [a, a + 1]);
    assert.equal(s.store.findIds('People').length, 2, 'a differently formatted key updates rather than duplicates');
    assert.equal(s.data(a).Name, 'updated');
    const added = s.store.get('People', a + 1, 'iso').fieldData;
    assert.equal(added.Number, 124);
    assert.equal(added.Date, '2026-01-02');
  } finally { s.close(); }
});

test('Import Records normalizes time and timestamp match keys and retains blank numeric keys', async () => {
  const s = setup();
  try {
    s.store.applyDesign([
      { op: 'createField', table: 'People', name: 'Number', type: 'number' },
      { op: 'createField', table: 'People', name: 'Time', type: 'time' },
      { op: 'createField', table: 'People', name: 'Timestamp', type: 'timestamp' },
    ]);
    const a = s.add({ Number: 0, Time: '13:02:00', Timestamp: '2026-01-02T13:02:00', Name: 'zero' });
    const b = s.add({ Time: '13:02:00', Timestamp: '2026-01-02T13:02:00', Name: 'blank' });
    writeFileSync(join(s.dir, 'data.csv'), '0,1:02 PM,1/2/2026 1:02 PM,new zero\n,13:02,2026-01-02T13:02:00,new blank\n');
    const r = await s.run({ importAction: 'update', addRemaining: true, fieldMapping: s.mapping(['Number', 'Time', 'Timestamp', 'Name'], ['Number', 'Time', 'Timestamp']) });
    assert.equal(r.error, 0);
    assert.deepEqual(r.foundSet, [a, b]);
    assert.equal(s.store.findIds('People').length, 2);
    assert.equal(s.data(a).Name, 'new zero');
    assert.equal(s.data(b).Name, 'new blank', 'empty numeric keys are distinct from zero');
  } finally { s.close(); }
});

test('Import Records applies serial date conversion to Excel source keys only', async () => {
  const s = setup();
  let source: Store | undefined;
  try {
    s.store.applyDesign([{ op: 'createField', table: 'People', name: 'Date', type: 'date' }]);
    const a = s.add({ Date: '2026-10-12', Name: 'old date' });
    writeFileSync(join(s.dir, 'data.xlsx'), xlsx([[46307, 'Excel date']]));
    const params: StepParams = { importAction: 'update', addRemaining: true, fieldMapping: s.mapping(['Date', 'Name'], ['Date']) };
    const excel = await s.run({ ...params, filePaths: ['data.xlsx'] }, { foundSet: [a] });
    assert.equal(excel.error, 0);
    assert.deepEqual(excel.foundSet, [a]);
    assert.equal(s.data(a).Name, 'Excel date');

    createStore(join(s.dir, 'Source.sqlite'));
    source = new Store(join(s.dir, 'Source.sqlite'), 'Source');
    source.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Number', type: 'number' }, { name: 'Name' }] }]);
    source.create('Rows', { Number: 46307, Name: 'FileMaker number' });
    s.store.resolveFile = (name) => name === 'Source' ? source : undefined;
    const number = s.add({ Date: '46307', Name: 'numeric text' });
    const fm = await s.run({ ...params, importFormat: 'FMPR', filePaths: ['Source.fmp12'], importSource: {
      tableOccurrenceId: source.schema.tableOccurrences.find((t) => t.name === 'Rows')!.id,
      fieldIds: source.schema.tables.find((t) => t.name === 'Rows')!.fields.map((f) => f.id),
    } }, { foundSet: [a, number] });
    assert.equal(fm.error, 0);
    assert.deepEqual(fm.foundSet, [number], 'a hosted number is not an Excel date');
    assert.equal(s.data(a).Name, 'Excel date');
    assert.equal(s.data(number).Name, 'FileMaker number');
    assert.equal(s.store.findIds('People').length, 2);
  } finally { source?.close(); s.close(); }
});

// Claris (comma-separated, tab-separated and merge formats): "Values in repeating fields are separated by the group
// separator character." They go into the repetitions; that the ones the source has no value for are emptied on an
// update, and that a field of one repetition takes the first value, is inferred.
const GS = '\u001d';
for (const importAction of ['add', 'replace', 'update'] as const) test(`Import Records ${importAction} puts group-separated values into a repeating field's repetitions`, async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'updateField', table: 'People', field: 'Note', options: { repetitions: 3 } }]);
    const a = s.add({ Code: 'A', Name: 'old', Note: 'old1', 'Note(2)': 'old2', 'Note(3)': 'old3' });
    writeFileSync(join(s.dir, 'data.csv'), `A,new,"new1${GS}new2"\n`);
    const r = await s.run({ importAction, fieldMapping: s.mapping(['Code', 'Name', 'Note'], importAction === 'update' ? ['Code'] : []) }, { foundSet: [a] });
    assert.equal(r.error, 0);
    const id = importAction === 'add' ? s.store.findIds('People').find((x) => x !== a)! : a;
    const d = s.data(id);
    assert.equal(d.Name, 'new');
    assert.deepEqual([d.Note, d['Note(2)'], d['Note(3)'] ?? ''], ['new1', 'new2', '']);
    if (importAction === 'add') assert.equal(s.data(a)['Note(3)'], 'old3', 'the record already there is left alone');
    const skipped = await s.run({ importAction: 'replace', fieldMapping: [
      ...s.mapping(['Code', 'Name']), { field: s.field('Note'), import: false },
    ] }, { foundSet: [id] });
    assert.equal(skipped.error, 0, 'an unmapped repeating target is left alone');
    assert.equal(s.data(id)['Note(2)'], 'new2');
  } finally { s.close(); }
});

test('Import Records: a field of one repetition takes the first value; a repetition or a repeating match field is refused', async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'updateField', table: 'People', field: 'Note', options: { repetitions: 2 } }]);
    const a = s.add({ Code: 'A', Name: 'old', Note: 'old1', 'Note(2)': 'old2' });
    writeFileSync(join(s.dir, 'data.csv'), `"new${GS}ignored",n1\n`);
    assert.equal((await s.run({ importAction: 'replace', fieldMapping: s.mapping(['Name', 'Note']) }, { foundSet: [a] })).error, 0);
    assert.equal(s.data(a).Name, 'new');
    assert.deepEqual([s.data(a).Note, s.data(a)['Note(2)']], ['n1', '']);
    assert.equal((await s.run({ importAction: 'replace', fieldMapping: [
      { field: { ...s.field('Name'), repetition: 2 }, import: true },
    ] }, { foundSet: [a] })).error, 3);
    assert.equal((await s.run({ importAction: 'update', fieldMapping: s.mapping(['Note', 'Name'], ['Note']) })).error, 400, 'as for a container match field');
    assert.equal(s.data(a).Name, 'new');
  } finally { s.close(); }
});

test('Import Records takes a hosted source field\'s repetitions', async () => {
  const s = setup();
  let source: Store | undefined;
  try {
    createStore(join(s.dir, 'Source.sqlite'));
    source = new Store(join(s.dir, 'Source.sqlite'), 'Source');
    source.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Name' }, { name: 'Note', options: { repetitions: 3 } }] }]);
    source.create('Rows', { Name: 'new', Note: 'new1', 'Note(3)': 'new3' });
    s.store.resolveFile = (name) => name === 'Source' ? source : undefined;
    s.store.applyDesign([{ op: 'updateField', table: 'People', field: 'Note', options: { repetitions: 3 } }]);
    const a = s.add({ Name: 'old', Note: 'old note', 'Note(2)': 'old2' });
    const r = await s.run({ importAction: 'replace', importFormat: 'FMPR', filePaths: ['Source.fmp12'], fieldMapping: s.mapping(['Name', 'Note']), importSource: {
      tableOccurrenceId: source.schema.tableOccurrences.find((t) => t.name === 'Rows')!.id,
      fieldIds: source.schema.tables.find((t) => t.name === 'Rows')!.fields.map((f) => f.id),
    } }, { foundSet: [a] });
    assert.equal(r.error, 0);
    assert.deepEqual([s.data(a).Name, s.data(a).Note, s.data(a)['Note(2)'], s.data(a)['Note(3)']], ['new', 'new1', '', 'new3']);
  } finally { source?.close(); s.close(); }
});

test('Import Records puts repeating XML values (one DATA each) into the repetitions', async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'updateField', table: 'People', field: 'Note', options: { repetitions: 2 } }]);
    const a = s.add({ Name: 'old first' });
    const b = s.add({ Name: 'old second' });
    writeFileSync(join(s.dir, 'data.xml'), '<FMPXMLRESULT><RESULTSET><ROW><COL><DATA>first</DATA></COL><COL><DATA/><DATA>b2</DATA></COL></ROW><ROW><COL><DATA>second</DATA></COL><COL><DATA>c1</DATA><DATA>c2</DATA></COL></ROW></RESULTSET></FMPXMLRESULT>');
    const r = await s.run({ importAction: 'replace', filePaths: ['data.xml'], fieldMapping: s.mapping(['Name', 'Note']) }, { foundSet: [a, b] });
    assert.equal(r.error, 0);
    assert.deepEqual([s.data(a).Name, s.data(a).Note, s.data(a)['Note(2)']], ['first', '', 'b2']);
    assert.deepEqual([s.data(b).Name, s.data(b).Note, s.data(b)['Note(2)']], ['second', 'c1', 'c2']);
  } finally { s.close(); }
});

// Claris (merge format): "The first record is a header that lists the field names."
for (const how of ['by name', 'by format'] as const) test(`Import Records reads a merge file without its header row (${how})`, async () => {
  const s = setup();
  try {
    const file = how === 'by name' ? 'data.mer' : 'data.txt';
    writeFileSync(join(s.dir, file), '"Code","Name"\r\n"A","Ada"\r\n"B","Grace"\r\n');
    const r = await s.run({ importAction: 'add', filePaths: [file], fieldMapping: s.mapping(['Code', 'Name']), ...(how === 'by format' ? { importFormat: 'MRGE' } : {}) });
    assert.equal(r.error, 0);
    assert.deepEqual(s.store.findIds('People').map((id) => s.data(id).Name).sort(), ['Ada', 'Grace']);
  } finally { s.close(); }
});

for (const importAction of ['add', 'replace', 'update'] as const) test(`Import Records ${importAction} skips denied fields and imports permitted fields`, async () => {
  const s = setup();
  try {
    const a = s.add({ Code: 'A', Name: 'old', Note: 'locked' });
    s.store.savePrivilegeSet({
      name: 'Importer', records: { view: true, edit: true, create: true, delete: false, fields: { Note: 'viewOnly' } },
      layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
    });
    s.store.setPassword('Clerk', 'pw', 'Importer');
    writeFileSync(join(s.dir, 'data.csv'), 'A,new,overwrite locked\n');
    const r = await s.run({ importAction, fieldMapping: s.mapping(['Code', 'Name', 'Note'], importAction === 'update' ? ['Code'] : []) }, {
      account: 'Clerk', privileges: s.store.privileges('Clerk'),
    });
    assert.equal(r.error, 201, 'a skipped field is still reported');
    const imported = importAction === 'add' ? a + 1 : a;
    assert.deepEqual(r.foundSet, [imported]);
    assert.equal(s.data(imported).Name, 'new');
    assert.equal(s.data(a).Note, 'locked');
    if (importAction === 'add') assert.equal(s.data(imported).Note, '');
  } finally { s.close(); }
});

test('Import Records skips hidden and masked non-match fields without blocking editable fields', async () => {
  const s = setup();
  try {
    const a = s.add({ Name: 'old', Note: 'secret' });
    s.store.setPassword('Clerk', 'pw');
    writeFileSync(join(s.dir, 'data.csv'), 'new,overwrite secret\n');
    for (const level of ['none', 'masked'] as const) {
      s.store.savePrivilegeSet({
        name: 'Importer', records: { view: true, edit: true, create: false, delete: false, fields: { Note: level } },
        layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
      });
      s.store.setPassword('Clerk', 'pw', 'Importer');
      const r = await s.run({ importAction: 'replace', fieldMapping: s.mapping(['Name', 'Note']) }, { account: 'Clerk', privileges: s.store.privileges('Clerk'), trace: true });
      assert.equal(r.error, 201);
      assert.equal(s.data(a).Name, 'new');
      assert.equal(s.data(a).Note, 'secret');
      assert.doesNotMatch(r.trace!.find((t) => t.error === 201)!.message!, /secret/);
      s.store.update('People', a, { Name: 'old' });
    }
  } finally { s.close(); }
});

for (const revert of [true, false]) test(`Import Records skipped-field errors retain transaction rollback behaviour (${revert})`, async () => {
  const s = setup();
  try {
    const a = s.add({ Name: 'old', Note: 'locked' });
    s.store.savePrivilegeSet({
      name: 'Importer', records: { view: true, edit: true, create: false, delete: false, fields: { Note: 'viewOnly' } },
      layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
    });
    s.store.setPassword('Clerk', 'pw', 'Importer');
    writeFileSync(join(s.dir, 'data.csv'), 'new,overwrite locked\n');
    const steps = parseScriptText(`Set Error Capture [ On ]\nSet Revert Transaction on Error [ ${revert ? 'On' : 'Off'} ]\nOpen Transaction\nImport Records [ Source: "data.csv" ; Replace ; Fields: People::Name, People::Note ]\nCommit Transaction`, s.store.schema)
      .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params }));
    const r = await runScript(s.store, { id: 9998, name: 'Transaction import', steps } as Script, { layout: 'People', documents: s.dir, account: 'Clerk', privileges: s.store.privileges('Clerk'), trace: true });
    assert.equal(r.trace!.find((t) => t.line.startsWith('Import Records'))!.error, 201);
    assert.equal(s.data(a).Name, revert ? 'old' : 'new');
    assert.equal(s.data(a).Note, 'locked');
  } finally { s.close(); }
});

const IMPORT_DETAIL = 'Import Records cannot run because its Add/Update/Replace mode is unspecified or not decoded. Specify the mode explicitly and review match fields, add-remaining, and auto-enter options. No records were imported.';
const binaryImport = () => decodeStepParams(35, new Uint8Array(28), undefined, {
  formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined,
  tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined,
})!;

for (const source of ['missing.csv', 'data.csv', 'Source.fmp12']) test(`Undecoded binary import mode refuses before source access or writes (${source})`, async (t) => {
  const s = setup();
  try {
    const id = s.add({ Code: 'original', Name: 'unchanged' });
    writeFileSync(join(s.dir, 'data.csv'), 'new,West,imported\n');
    let sourceAccess = 0;
    s.store.resolveFile = () => { sourceAccess++; throw new Error('Source must not be accessed'); };
    // The file-source readers must not run for even an existing source.
    const readers = ScriptEngine.prototype as unknown as { documentFile(): never; fileMakerRows(): never };
    for (const method of ['documentFile', 'fileMakerRows'] as const) t.mock.method(readers, method, () => { sourceAccess++; throw new Error('Source must not be accessed'); });
    const steps = parseScriptText([
      'Set Field [ People::Name ; "pending" ]',
      'Set Variable [ $open ; Value: Get ( RecordOpenState ) ]',
      `Import Records [ Source: "${source}" ; Mode: Undecoded ]`,
      'Set Variable [ $status ; Value: Get ( LastError ) & "/" & Get ( LastErrorDetail ) & "/" & ( Get ( RecordOpenState ) = $open ) ]',
      'Revert Record/Request [ With dialog: Off ]',
      'Exit Script [ Result: $status ]',
    ].join('\n'), s.store.schema).map((sp) => ({ stepId: sp.stepId!, name: scriptStepName(sp.stepId!), enabled: true, params: sp.params }));
    steps[2].params = { ...steps[2].params, ...binaryImport(), filePaths: [source], ...(source.endsWith('fmp12') ? { importFormat: 'FMPR' } : {}) };
    const result = await runScript(s.store, { id: 9900, name: 'Refused import', steps }, { layout: 'People', documents: s.dir, foundSet: [id], trace: true });
    assert.equal(result.result, `3/${IMPORT_DETAIL}/1`);
    assert.equal(result.trace!.find((t) => t.error === 3)!.message, IMPORT_DETAIL);
    assert.equal(sourceAccess, 0);
    assert.deepEqual(result.foundSet, [id]);
    assert.deepEqual(s.store.findIds('People'), [id]);
    assert.equal(s.data(id).Name, 'unchanged', 'the refused step did not commit the pending edit');
    const created = s.store.create('People', { Name: 'after' });
    assert.equal(s.data(created.recordId).Serial, 10, 'no serial number was consumed');
  } finally { s.close(); }
});

test('Undecoded binary import error 3 does not roll back or unwind an open transaction', async () => {
  const s = setup();
  try {
    const id = s.add({ Name: 'original' });
    const steps = parseScriptText([
      'Open Transaction', 'Set Field [ People::Name ; "kept" ]',
      'Import Records [ Source: "missing.csv" ; Mode: Undecoded ]',
      'Set Variable [ $status ; Value: Get ( LastError ) & "/" & Get ( TransactionOpenState ) ]',
      'Commit Transaction', 'Exit Script [ Result: $status ]',
    ].join('\n'), s.store.schema).map((sp) => ({ stepId: sp.stepId!, name: scriptStepName(sp.stepId!), enabled: true, params: sp.params }));
    const result = await runScript(s.store, { id: 9901, name: 'Transaction import', steps }, { layout: 'People', documents: s.dir, foundSet: [id] });
    assert.equal(result.result, '3/1');
    assert.equal(s.data(id).Name, 'kept');
  } finally { s.close(); }
});

for (const mode of ['invalid', '', null, 1]) test(`Invalid structured import mode refuses before a missing source (${JSON.stringify(mode)})`, async () => {
  const s = setup();
  try {
    const result = await s.run({ importAction: mode as StepParams['importAction'], filePaths: ['missing.csv'] }, { trace: true });
    assert.equal(result.error, 3);
    assert.equal(result.trace!.find((t) => t.error === 3)!.message, IMPORT_DETAIL);
    assert.deepEqual(s.store.findIds('People'), []);
  } finally { s.close(); }
});

test('Authored text, structured and bare imports keep implicit Add', async () => {
  const s = setup();
  try {
    writeFileSync(join(s.dir, 'data.csv'), 'A,West,Ada\n');
    const text = parseScriptText('Import Records [ Source: "data.csv" ; Fields: People::Code, People::Region, People::Name ]', s.store.schema)[0];
    assert.equal(text.params?.importAction, undefined);
    assert.equal(undecodedOptionError(35, text.params), undefined);
    assert.equal(undecodedOptionError(35), undefined);
    const authored = await s.run(text.params!);
    assert.equal(authored.error, 0);
    assert.equal(s.data(authored.foundSet![0]).Name, 'Ada');
    assert.equal((await s.run({})).error, 0);
    const bare = await runScript(s.store, { id: 9902, name: 'Bare import', steps: [{ stepId: 35, name: 'Import Records', enabled: true }] }, { layout: 'People', documents: s.dir });
    assert.notEqual(bare.error, 3, 'the ordinary missing-source error is retained for a bare authored import');
    assert.equal(s.store.findIds('People').length, 2);
  } finally { s.close(); }
});

for (const create of [false, true]) for (const importAction of ['add', 'update', 'replace'] as const) for (const addRemaining of [false, true]) {
  test(`Import Records ${importAction}: create=${create}, edit=false, addRemaining=${addRemaining} checks before reading source rows`, async (t) => {
    const s = setup();
    try {
      s.store.savePrivilegeSet({
        name: 'Import coarse', records: { view: true, edit: true, create: true, delete: false },
        tables: { People: { view: true, edit: false, create, delete: false } },
        layouts: 'modifiable', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: [],
      });
      s.store.setPassword('Clerk', 'pw', 'Import coarse');
      writeFileSync(join(s.dir, 'data.csv'), 'A,West,Ada,hello\n');
      const sources = ScriptEngine.prototype as unknown as { textRows: (...args: unknown[]) => unknown };
      const spy = t.mock.method(sources, 'textRows');
      const allowed = create && (importAction === 'add' || addRemaining);
      const r = await s.run({ importAction, addRemaining, fieldMapping: s.mapping(['Code', 'Region', 'Name', 'Note'], importAction === 'update' ? ['Code'] : []) }, {
        account: 'Clerk', privileges: s.store.privileges('Clerk'),
      });
      assert.equal(spy.mock.callCount(), allowed ? 1 : 0, 'denied imports never read or parse the source');
      assert.equal(r.error, allowed ? 0 : 200);
      assert.equal(s.store.findIds('People').length, allowed ? 1 : 0);
    } finally { s.close(); }
  });
}

for (const importAction of ['update', 'replace'] as const) test(`Import Records ${importAction}: create-only with add remaining skips matched records and adds unmatched rows`, async () => {
  const s = setup();
  try {
    s.store.savePrivilegeSet({
      name: 'Creator', records: { view: true, create: true, edit: false, delete: false },
      layouts: 'modifiable', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: [],
    });
    s.store.setPassword('Clerk', 'pw', 'Creator');
    const id = s.add({ Code: 'A', Name: 'Before' });
    writeFileSync(join(s.dir, 'data.csv'), 'A,Denied\nB,Added\n');
    const result = await s.run({
      importAction, addRemaining: true, fieldMapping: s.mapping(['Code', 'Name'], importAction === 'update' ? ['Code'] : []),
    }, { account: 'Clerk', privileges: s.store.privileges('Clerk'), foundSet: [id] });
    assert.equal(result.error, 200, 'matched records report the per-record access denial');
    assert.equal(s.data(id).Name, 'Before');
    assert.equal(s.store.findIds('People').length, 2);
    assert.equal(result.foundSet!.length, 1);
    assert.equal(s.data(result.foundSet![0]).Code, 'B');
    assert.equal(s.data(result.foundSet![0]).Name, 'Added');
  } finally { s.close(); }
});

for (const source of ['file', 'folder', 'hosted'] as const) test(`Import Records: missing ${source} reports 100 before a privilege denial without reading rows`, async (t) => {
  const s = setup();
  try {
    s.store.savePrivilegeSet({
      name: 'Viewer', records: { view: true, create: false, edit: false, delete: false },
      layouts: 'modifiable', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: [],
    });
    s.store.setPassword('Clerk', 'pw', 'Viewer');
    const readers = ScriptEngine.prototype as unknown as { textRows(): never; folderRows(): never; fileMakerRows(): never };
    const spies = (['textRows', 'folderRows', 'fileMakerRows'] as const).map((method) => t.mock.method(readers, method));
    const result = await s.run({
      filePaths: [source === 'hosted' ? 'Missing.fmp12' : 'missing.csv'],
      ...(source === 'folder' ? { importFolder: { kind: 'text' as const } } : {}),
      ...(source === 'hosted' ? { importFormat: 'FMPR' } : {}),
    }, { account: 'Clerk', privileges: s.store.privileges('Clerk') });
    assert.equal(result.error, 100);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
    assert.deepEqual(s.store.findIds('People'), []);
  } finally { s.close(); }
});

for (const create of [false, true]) test(`Import Records: existing empty file checks privileges before reading (create=${create})`, async (t) => {
  const s = setup();
  try {
    s.store.savePrivilegeSet({
      name: 'Importer', records: { view: true, create, edit: false, delete: false },
      layouts: 'modifiable', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: [],
    });
    s.store.setPassword('Clerk', 'pw', 'Importer');
    writeFileSync(join(s.dir, 'data.csv'), '');
    const readers = ScriptEngine.prototype as unknown as { textRows(): never };
    const spy = t.mock.method(readers, 'textRows');
    const result = await s.run({}, { account: 'Clerk', privileges: s.store.privileges('Clerk') });
    assert.equal(result.error, create ? 731 : 200);
    assert.equal(spy.mock.callCount(), create ? 1 : 0);
    assert.deepEqual(s.store.findIds('People'), []);
  } finally { s.close(); }
});
