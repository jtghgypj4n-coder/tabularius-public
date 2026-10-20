import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, importTables, notionMarkdownSheet, parseNumber, planImportTables, Store, type SheetInput } from '../src/index.ts';

let dir: string;
let n = 0;
const fresh = () => {
  const path = join(dir, `T${++n}.sqlite`);
  createStore(path);
  return new Store(path, `T${n}`);
};
before(() => { dir = mkdtempSync(join(tmpdir(), 'tabularius-import-tables-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

const people: SheetInput = {
  name: 'People',
  rows: [
    ['Name', 'Age', 'Joined', 'Active', 'Seen at', 'Salary', 'Zip', 'Team', 'Skills', 'ID'],
    ['Ann', '31', '2024-02-03', 'checked', '2024-02-03 10:30', '$1,200.50', '01234', 'Red', 'a, b', 'x1'],
    ['Bob', '', '2024-02-04', '', '2024-02-04T09:00:00Z', '900', '02134', 'Blue', 'b', 'x2'],
    ['Cy', '44', '2024-03-05', 'checked', '2024-03-05 14:00', '1,000', '90210', 'Red', 'a, c', 'x3'],
    ['Di', '27', '2024-04-06', '', '2024-04-06 08:15', '$75', '10001', 'Red', 'a', 'x4'],
    ['Ed', '50', '2024-05-07', 'checked', '2024-05-07 23:59', '60', '30301', 'Blue', 'c', 'x5'],
    ['Flo', '39', '2024-06-08', '', '2024-06-08 00:00', '1', '60601', 'Red', 'a, b, c', 'x6'],
    ['Gus', '61', '2024-07-09', 'checked', '2024-07-09 12:00', '2', '77001', 'Blue', 'b', 'x7'],
    ['Hal', '18', '2024-08-10', '', '2024-08-10 18:45', '3', '85001', 'Red', 'a', 'x8'],
  ],
};

test('types are worked out from the data and codes with leading zeros stay text', () => {
  const plan = planImportTables([people]);
  const kinds = Object.fromEntries(plan.sheets[0].columns.map((c) => [c.header, c.kind]));
  assert.deepEqual(kinds, { Name: 'text', Age: 'number', Joined: 'date', Active: 'checkbox', 'Seen at': 'timestamp', Salary: 'number', Zip: 'text', Team: 'select', Skills: 'multi', ID: 'text' });
  assert.equal(plan.sheets[0].columns.find((c) => c.header === 'ID')!.name, 'ID 2', 'a column called ID makes way for the key');
  assert.match(plan.notes.join('\n'), /Formulas are not translated/);
  assert.equal(parseNumber('$1,200.50'), 1200.5);
  assert.equal(parseNumber('007'), undefined);
  assert.equal(parseNumber('1,2'), undefined);
});

test('an override beats the inference, and a bad one is refused', () => {
  const plan = planImportTables([people], { overrides: { People: { Age: 'text', Zip: 'number', Team: 'skip' } } });
  const kinds = Object.fromEntries(plan.sheets[0].columns.map((c) => [c.header, c.kind]));
  assert.equal(kinds.Age, 'text');
  assert.equal(kinds.Team, 'skip');
  assert.throws(() => planImportTables([people], { overrides: { People: { Age: 'banana' as never } } }), /not a column kind/);
  assert.throws(() => planImportTables([people], { overrides: { People: { Age: 'link:Nowhere' } } }), /not among the sheets/);
});

test('the records arrive typed, with value lists and the checkbox as 0 and 1', () => {
  const store = fresh();
  try {
    const plan = planImportTables([people]);
    const report = importTables(store, [people], plan);
    assert.equal(report.tables, 1);
    assert.equal(report.rows, 8);
    assert.equal(report.valueLists, 2);
    assert.equal(report.zonesDropped, 1);
    const t = store.schema.tables.find((x) => x.name === 'People')!;
    assert.deepEqual(t.fields.map((f) => [f.name, f.type]), [['ID', 'number'], ['Name', 'text'], ['Age', 'number'], ['Joined', 'date'], ['Active', 'number'], ['Seen at', 'timestamp'], ['Salary', 'number'], ['Zip', 'text'], ['Team', 'text'], ['Skills', 'text'], ['ID 2', 'text']]);
    const rows = store.select('SELECT "ID", "Name", "Age", "Joined", "Active", "Seen at", "Salary", "Zip", "Skills" FROM "People" ORDER BY "ID"').rows;
    assert.deepEqual(rows[0], [1, 'Ann', 31, '2024-02-03', 1, '2024-02-03T10:30:00', 1200.5, '01234', 'a\nb']);
    assert.deepEqual(rows[1].slice(2, 6), [null, '2024-02-04', 0, '2024-02-04T09:00:00']);
    assert.deepEqual(store.schema.valueLists.map((v) => [v.name, v.values]), [['People Team', ['Red', 'Blue']], ['People Skills', ['a', 'b', 'c']]]);
    // New records carry on from the key.
    assert.equal(store.create('People', { Name: 'New' }).recordId, 9);
    assert.equal(store.select('SELECT "ID" FROM "People" WHERE "Name" = \'New\'').rows[0][0], 9);
  } finally { store.close(); }
});

test('a column of linked records becomes a join table, two relationships and a portal', () => {
  const projects: SheetInput = { name: 'Projects', rows: [['Name', 'Owner'], ['Apollo', 'Ann'], ['Borealis', 'Bob'], ['Cirrus', 'Ann']] };
  const tasks: SheetInput = {
    name: 'Tasks',
    rows: [
      ['Task', 'Project', 'Notes'],
      ['Design', 'Apollo', 'x'],
      ['Build', 'Apollo, Borealis', 'y'],
      ['Ship', 'Borealis (https://www.notion.so/Borealis-0123456789abcdef0123456789abcdef)', 'z'],
      ['Idle', '', ''],
    ],
  };
  const plan = planImportTables([projects, tasks]);
  const col = plan.sheets[1].columns[1];
  assert.deepEqual([col.kind, col.target], ['link', 'Projects']);
  const store = fresh();
  try {
    const report = importTables(store, [projects, tasks], plan);
    assert.equal(report.joinTables, 1);
    assert.equal(report.links, 4);
    assert.equal(report.portals, 1);
    assert.deepEqual(store.schema.tables.map((t) => t.name), ['Projects', 'Tasks', 'Tasks Project']);
    assert.deepEqual(store.schema.tables[1].fields.map((f) => f.name), ['ID', 'Task', 'Notes'], 'the linked column is no longer text');
    const joined = store.select('SELECT t."Task", p."Name" FROM "Tasks" t JOIN "Tasks Project" j ON j."Tasks ID" = t."ID" JOIN "Projects" p ON p."ID" = j."Projects ID" ORDER BY t."ID", p."ID"').rows;
    assert.deepEqual(joined, [['Design', 'Apollo'], ['Build', 'Apollo'], ['Build', 'Borealis'], ['Ship', 'Borealis']]);
    assert.equal(store.schema.relationships.length, 2);
    // The related records are reachable from the record: Build's projects.
    const id = Number((store.select('SELECT _fm_record_id FROM "Tasks" WHERE "Task" = \'Build\'').rows[0][0]));
    assert.equal(store.evaluate('Tasks', 'ValueCount ( List ( Tasks Project::Projects name ) )', id).value, '2');
    assert.ok(store.design('Tasks')!.objects.some((o) => o.kind === 'portal'), 'the form layout has a portal');
  } finally { store.close(); }
});

test('links that match nothing are counted, and a column that is not links stays text', () => {
  const a: SheetInput = { name: 'A', rows: [['Name', 'Links'], ...Array.from({ length: 10 }, (_, i) => [`row ${i}`, i === 1 ? 'y, nope' : i % 2 ? 'y' : 'x'])] };
  const b: SheetInput = { name: 'B', rows: [['Name'], ['x'], ['y'], ['x']] };
  const plan = planImportTables([a, b]);
  assert.equal(plan.sheets[0].columns[1].kind, 'link');
  const store = fresh();
  try {
    const report = importTables(store, [a, b], plan);
    assert.equal(report.unmatchedLinks, 1);
    assert.equal(report.links, 10);
    assert.equal(report.ambiguousLinks, 5, 'the name x is shared by two rows, and five rows name it');
  } finally { store.close(); }
  const c: SheetInput = { name: 'C', rows: [['Name', 'Notes'], ['one', 'zzz'], ['two', 'qqq']] };
  assert.equal(planImportTables([c, b]).sheets[0].columns[1].kind, 'text');
  assert.notEqual(planImportTables([a, b], { links: false }).sheets[0].columns[1].kind, 'link');
});

test('day-first dates are read when a value shows the order, and month-name dates from Notion', () => {
  const sheet = (rows: string[][]): SheetInput => ({ name: 'D', rows: [['When'], ...rows] });
  const dmy = planImportTables([sheet([['13/02/2024'], ['01/03/2024']])]).sheets[0].columns[0];
  assert.deepEqual([dmy.kind, dmy.dayFirst], ['date', true]);
  const notion = planImportTables([sheet([['October 17, 2026'], ['March 3, 2025']])]).sheets[0].columns[0];
  assert.equal(notion.kind, 'date');
  const ambiguous = planImportTables([sheet([['1/2/2024'], ['3/4/2024']])]);
  assert.match(ambiguous.sheets[0].notes.join(), /read month first/);
  const store = fresh();
  try {
    importTables(store, [sheet([['13/02/2024'], ['01/03/2024']])], planImportTables([sheet([['13/02/2024'], ['01/03/2024']])]));
    assert.deepEqual(store.select('SELECT "When" FROM "D" ORDER BY "ID"').rows, [['2024-02-13'], ['2024-03-01']]);
  } finally { store.close(); }
});

test('names the file keeps for itself, duplicates, empty headers and a table that exists are handled', () => {
  const store = fresh();
  try {
    store.applyDesign([{ op: 'createTable', name: 'Taken', fields: [{ name: 'A' }] }] as never);
    const odd: SheetInput = { name: 'Odd', rows: [['ROWID', 'a::b', 'a:b', '', 'x(1)', 'x'], ['1', '2', '3', '4', '5', '6']] };
    const plan = planImportTables([odd]);
    assert.deepEqual(plan.sheets[0].columns.map((c) => c.name), ['ROWID field', 'a:b', 'a:b 2', 'Column 4', 'x(1) field', 'x']);
    const report = importTables(store, [odd], plan);
    assert.ok(report.renamedColumns >= 4);
    assert.throws(() => importTables(store, [{ name: 'Taken', rows: [['A'], ['1']] }], { sheets: [{ ...planImportTables([{ name: 'Taken2', rows: [['A'], ['1']] }]).sheets[0], table: 'Taken', sheet: 'Taken' }], notes: [] }), /already has a table called "Taken"/);
    // Planning against the file's tables renames instead.
    assert.equal(planImportTables([{ name: 'Taken', rows: [['A'], ['1']] }], { existing: ['Taken'] }).sheets[0].table, 'Taken 2');
  } finally { store.close(); }
});

test('ragged and empty rows, and a failure part way, leave nothing behind', () => {
  const sheet: SheetInput = { name: 'R', rows: [['A', 'B'], ['1'], ['2', '3', '4'], ['', ''], ['5', '6', '7']] };
  const plan = planImportTables([sheet]);
  assert.equal(plan.sheets[0].rows, 3);
  assert.equal(plan.sheets[0].ragged, 3, 'a short row and two long rows with something in the extra cell');
  const store = fresh();
  try {
    // Forcing a type the data can't hold counts the values and leaves them empty.
    const forced = planImportTables([sheet], { overrides: { R: { A: 'date' } } });
    const report = importTables(store, [sheet], forced);
    assert.equal(report.unfittingValues, 3);
    assert.equal(report.rows, 3);
    // A failure: a sheet missing from the input.
    const before = store.schema.tables.length;
    assert.throws(() => importTables(store, [], planImportTables([{ name: 'Z', rows: [['A'], ['1']] }])), /not among the sheets/);
    assert.equal(store.schema.tables.length, before);
  } finally { store.close(); }
});

test('Notion Markdown pages become rows: title, properties and body', () => {
  const sheet = notionMarkdownSheet('Notes', [
    { file: 'First 0123456789abcdef0123456789abcdef.md', text: '﻿# First\n\nStatus: Open\nOwner: Ann\n\nHello\nworld\n' },
    { file: 'Second 0123456789abcdef0123456789abcdef.md', text: 'Status: Done\n\nBody only' },
  ]);
  assert.deepEqual(sheet.rows, [['Title', 'Status', 'Owner', 'Body'], ['First', 'Open', 'Ann', 'Hello\nworld'], ['Second', 'Done', '', 'Body only']]);
});

test('a limited account may not import tables', () => {
  const store = fresh();
  try {
    store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] } as never);
    assert.throws(() => importTables(store, [people], planImportTables([people]), { privileges: store.privilegesForSet('Staff') }), /needs \[Full Access\]/);
    assert.equal(store.schema.tables.length, 0);
  } finally { store.close(); }
});
