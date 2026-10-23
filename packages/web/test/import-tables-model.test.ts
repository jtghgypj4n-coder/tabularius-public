// Import Tables: the plan's picks, the choices a person makes on it and the request that sends the files again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILES, choicesFor, choose, chosen, currentChoice, filesProblem, importTablesForm, importTablesQuery, keepValid, sheetLine, type ImportTablesPlan, type PlannedColumn } from '../src/import-tables-model.ts';

const col = (header: string, kind: PlannedColumn['kind'], extra: Partial<PlannedColumn> = {}): PlannedColumn => ({ column: 0, header, name: header, kind, inferred: true, ...extra });
const PLAN: ImportTablesPlan = {
  notes: [],
  sheets: [
    { sheet: 'Clients', table: 'Clients', idField: 'Name', rows: 3, ragged: 0, notes: [], columns: [col('Name', 'text'), col('Notes', 'text')] },
    { sheet: 'Orders', table: 'Orders', idField: 'Order', rows: 1, ragged: 0, notes: [], columns: [col('Order', 'number'), col('Client', 'link', { target: 'Clients' }), col('Old', 'skip')] },
  ],
};

test('a column shows the kind the plan worked out, or the choice made; a link shows its sheet', () => {
  assert.equal(currentChoice(PLAN.sheets[1].columns[0], undefined), 'number');
  assert.equal(currentChoice(PLAN.sheets[1].columns[1], undefined), 'link:Clients');
  assert.equal(currentChoice(PLAN.sheets[1].columns[0], 'text'), 'text');
});

test('the picks are every kind, then a link to each other sheet and never to its own', () => {
  const orders = choicesFor(PLAN, 'Orders').map((o) => o.value);
  assert.deepEqual(orders, ['text', 'number', 'date', 'time', 'timestamp', 'checkbox', 'select', 'multi', 'skip', 'link:Clients']);
  assert.ok(!choicesFor(PLAN, 'Clients').some((o) => o.value === 'link:Clients'));
  assert.equal(choicesFor(PLAN, 'Orders').at(-1)!.label, 'Link to Clients');
});

test('choices are kept by sheet and column, and a choice that no longer fits the plan is dropped', () => {
  let c = choose({}, 'Orders', 'Order', 'text');
  c = choose(c, 'Orders', 'Client', 'skip');
  assert.deepEqual(JSON.parse(JSON.stringify(c)), { Orders: { Order: 'text', Client: 'skip' } });
  assert.deepEqual(keepValid(c, PLAN), c);
  assert.deepEqual(JSON.parse(JSON.stringify(keepValid({ Gone: { A: 'text' }, Orders: { Nope: 'text', Order: 'link:Orders', Client: 'link:Clients' } }, PLAN))), { Orders: { Client: 'link:Clients' } });
  assert.deepEqual(JSON.parse(JSON.stringify(keepValid(c, { notes: [], sheets: [PLAN.sheets[0]] }))), {});
});

test('files that cannot be sent are named before anything is sent', () => {
  assert.match(filesProblem([], []), /Choose the files/);
  assert.equal(filesProblem([{ name: 'a.csv', size: 10 }], []), '');
  assert.equal(filesProblem([], [{ name: 'p.md', size: 10 }]), '');
  assert.match(filesProblem(Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `${i}.csv`, size: 1 })), []), /at most 20 files/);
  assert.match(filesProblem([{ name: 'a.csv', size: 30 * 1024 * 1024 }], [{ name: 'p.md', size: 30 * 1024 * 1024 }]), /more than the 50 MB/);
});

test('the request carries the files, the pages and folder, and only the choices that were made', () => {
  const csv = new File(['A,B\r\n1,2\r\n'], 'T.csv');
  const page = new File(['# x'], 'x.md');
  const form = importTablesForm([csv], [page], 'Tasks', { T: { A: 'text' } });
  assert.deepEqual([...form.keys()], ['file', 'pages', 'folder', 'overrides']);
  assert.equal(JSON.parse(form.get('overrides') as string).T.A, 'text');
  assert.equal((form.get('file') as File).name, 'T.csv');
  assert.deepEqual([...importTablesForm([csv], [], 'Ignored', {}).keys()], ['file'], 'no pages: no folder; no choices: no overrides');
  assert.equal(importTablesQuery('preview', true), '?stage=preview');
  assert.equal(importTablesQuery('import', false), '?stage=import&links=0');
});

test('a sheet is one line: its table, rows, fields without the skipped ones, and links', () => {
  assert.equal(sheetLine(PLAN.sheets[1]), 'Orders: table Orders, 1 row, 2 fields, 1 link');
  assert.equal(sheetLine(PLAN.sheets[0]), 'Clients: table Clients, 3 rows, 2 fields');
});

test('web-b-9: prototype names stay own keys in null-prototype choices', () => {
  const plan: ImportTablesPlan = {
    notes: [],
    sheets: [
      { sheet: '__proto__', table: 'Proto', idField: 'polluted', rows: 1, ragged: 0, notes: [], columns: [col('polluted', 'text'), col('constructor', 'text')] },
      { sheet: 'constructor', table: 'Constructor', idField: 'name', rows: 1, ragged: 0, notes: [], columns: [col('name', 'text'), col('__proto__', 'text')] },
    ],
  };
  const made = choose(choose(choose(choose({}, '__proto__', 'polluted', 'skip'), '__proto__', 'constructor', 'number'), 'constructor', 'name', 'date'), 'constructor', '__proto__', 'text');
  const kept = keepValid(made, plan);
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Object.prototype is untouched');
  assert.equal(({} as Record<string, unknown>).constructor, Object);
  for (const c of [made, kept]) {
    assert.deepEqual(Object.keys(c), ['__proto__', 'constructor']);
    assert.equal(Object.getPrototypeOf(c), null);
    assert.equal(Object.getPrototypeOf(c.constructor), null);
    assert.equal(Object.getPrototypeOf(c['__proto__']), null);
    assert.equal(Object.hasOwn(c.constructor, '__proto__'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(c)), { ['__proto__']: { polluted: 'skip', constructor: 'number' }, constructor: { name: 'date', ['__proto__']: 'text' } });
  }
  assert.deepEqual(JSON.parse(importTablesForm([], [], '', kept).get('overrides') as string), JSON.parse(JSON.stringify(kept)));
  assert.equal(chosen(made, '__proto__', 'polluted'), 'skip');
  // A sheet with no choice reads as none, whatever its name.
  assert.equal(chosen({}, 'constructor', 'name'), undefined);
  assert.equal(chosen({}, '__proto__', 'x'), undefined);
  assert.equal(currentChoice(plan.sheets[1].columns[0], undefined), 'text');
});
