import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('fields');
after(h.close);

test('field steps write values by object and qualified name, and expose field errors', async () => {
  const cases = [
    { step: 'Set Field [ People::Name ; "Grace" ]', field: 'Name', expected: 'Grace' },
    { step: 'Set Field By Name [ "People::Age" ; 52 ]', field: 'Age', expected: '52' },
    { step: 'Replace Field Contents [ With dialog: Off ; People::Name ; Upper ( People::Name ) ]', field: 'Name', expected: 'GRACE' },
  ];
  for (const c of cases) {
    const r = await h.run(`Go to Record/Request/Page [ First ]\n${c.step}\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: People::${c.field} ]`);
    assert.equal(r.error, 0, c.step);
    assert.equal(r.result, c.expected, c.step);
    assert.ok(h.store.query(`SELECT "${c.field}" AS value FROM People`).some((row) => String(row.value) === c.expected));
  }
  // Error 102 is the repository's current result for a missing field reference.
  const bad = await h.run('Set Error Capture [ On ]\nSet Field By Name [ "People::Missing" ; "x" ]\nExit Script [ Text Result: Get ( LastError ) ]');
  assert.equal(bad.result, '102');
});

test('failed calculations never write through Set Field, Set Field By Name or Replace Field Contents', async () => {
  const isolated = stepHarness('failed-calc');
  const cases = [
    'Set Field [ People::Name ; NoSuchFunction ( ) ]',
    'Set Field By Name [ "People::Name" ; NoSuchFunction ( ) ]',
    'Replace Field Contents [ With dialog: Off ; People::Name ; NoSuchFunction ( ) ]',
    'Insert Calculated Result [ Select ; People::Name ; NoSuchFunction ( ) ]',
  ];
  try {
    for (const step of cases) {
      const r = await isolated.run(`Set Error Capture [ On ]\n${step}\nExit Script [ Text Result: Get ( LastError ) ]`);
      assert.equal(r.result, '1208', step);
      assert.deepEqual(isolated.store.query('SELECT Name FROM People ORDER BY Name').map((row) => row.Name), ['Ada', 'Lin'], step);
    }
  } finally {
    isolated.close();
  }
});

test('Replace Field Contents runs its calculation once per record, and not at all on an empty found set', async () => {
  const isolated = stepHarness('replace-once');
  try {
    const counted = await isolated.run('Set Variable [ $n ; 0 ]\nReplace Field Contents [ With dialog: Off ; People::Name ; Let ( $n = $n + 1 ; $n ) ]\nExit Script [ Text Result: $n ]');
    assert.equal(counted.error, 0);
    assert.equal(counted.result, '2');
    assert.deepEqual(isolated.store.query('SELECT Name FROM People ORDER BY Name').map((row) => row.Name), ['1', '2']);
    const empty = await isolated.run('Set Error Capture [ On ]\nReplace Field Contents [ With dialog: Off ; People::Name ; NoSuchFunction ( ) ]\nExit Script [ Text Result: Get ( LastError ) ]', { foundSet: [] });
    assert.equal(empty.result, '0');
  } finally {
    isolated.close();
  }
});

test('Replace Field Contents stops at the record whose calculation fails, and writes no "?"', async () => {
  const isolated = stepHarness('replace-later');
  const names = () => isolated.store.query('SELECT Name FROM People ORDER BY Name').map((row) => row.Name);
  try {
    const later = await isolated.run('Set Error Capture [ On ]\nReplace Field Contents [ With dialog: Off ; People::Name ; If ( Get ( RecordNumber ) = 2 ; NoSuchFunction ( ) ; "done" ) ]\nExit Script [ Text Result: Get ( LastError ) ]');
    assert.equal(later.result, '1208');
    assert.deepEqual(names(), ['done', 'Lin']);
  } finally {
    isolated.close();
  }
});

test('Replace Field Contents with a formula that may embed fails before it writes anything when a record\'s calculation fails', async () => {
  const isolated = stepHarness('replace-embed');
  try {
    const r = await isolated.run('Set Error Capture [ On ]\nReplace Field Contents [ With dialog: Off ; People::Name ; If ( Get ( RecordNumber ) = 2 ; NoSuchFunction ( ) ; "done" ) & Evaluate ( "1" ) ]\nExit Script [ Text Result: Get ( LastError ) ]');
    assert.equal(r.result, '1208');
    assert.deepEqual(isolated.store.query('SELECT Name FROM People ORDER BY Name').map((row) => row.Name), ['Ada', 'Lin']);
  } finally {
    isolated.close();
  }
});

test('Replace Field Contents with serial numbers stops on a failed initial value or increment and writes nothing', async () => {
  const isolated = stepHarness('replace-serial');
  try {
    for (const custom of ['Initial value: NoSuchFunction ( ) ; Increment value: 1', 'Initial value: 1 ; Increment value: NoSuchFunction ( )']) {
      const r = await isolated.run(`Set Error Capture [ On ]\nReplace Field Contents [ With dialog: Off ; People::Name ; Replace with serial numbers: Custom values ; ${custom} ]\nExit Script [ Text Result: Get ( LastError ) ]`);
      assert.equal(r.result, '1208', custom);
      assert.deepEqual(isolated.store.query('SELECT Name FROM People ORDER BY Name').map((row) => row.Name), ['Ada', 'Lin'], custom);
    }
  } finally {
    isolated.close();
  }
});

test('a failed calculation stops Replace Field Contents at once: no later record is evaluated', async () => {
  const isolated = stepHarness('replace-stops');
  try {
    const r = await isolated.run('Set Variable [ $n ; 0 ]\nSet Error Capture [ On ]\nReplace Field Contents [ With dialog: Off ; People::Name ; Let ( $n = $n + 1 ; If ( Get ( RecordNumber ) = 1 ; NoSuchFunction ( ) ; "done" ) ) ]\nExit Script [ Text Result: $n ]');
    assert.equal(r.result, '1');
    assert.deepEqual(isolated.store.query('SELECT Name FROM People ORDER BY Name').map((row) => row.Name), ['Ada', 'Lin']);
  } finally {
    isolated.close();
  }
});

test('a failed serial value leaves the next serial number in the entry options as it was, and evaluates nothing after it', async () => {
  const isolated = stepHarness('replace-serial-next');
  try {
    isolated.store.applyDesign([{ op: 'createField', table: 'People', name: 'Code', type: 'text', options: { autoEnter: { serial: { next: 'P-007', increment: 1 } } } }] as never);
    const codeOfNew = () => String(isolated.store.get('People', isolated.store.create('People', {}).recordId).fieldData.Code);
    for (const custom of ['Initial value: NoSuchFunction ( ) ; Increment value: Let ( $after = 1 ; 1 )', 'Initial value: 1 ; Increment value: NoSuchFunction ( )']) {
      const r = await isolated.run(`Set Error Capture [ On ]\nReplace Field Contents [ With dialog: Off ; People::Code ; Replace with serial numbers: Custom values ; ${custom} ; Update serial number in Entry Options ]\nExit Script [ Text Result: Get ( LastError ) & "|" & $after ]`);
      assert.equal(r.result, '1208|', custom);
    }
    assert.equal(codeOfNew(), 'P-007');
  } finally {
    isolated.close();
  }
});

test('Set Field By Name evaluates the value only when the name worked out', async () => {
  const isolated = stepHarness('byname-order');
  try {
    const r = await isolated.run('Set Error Capture [ On ]\nSet Field By Name [ NoSuchFunction ( ) ; Let ( $v = 1 ; "x" ) ]\nExit Script [ Text Result: Get ( LastError ) & "|" & $v ]');
    assert.equal(r.result, '1208|');
    assert.deepEqual(isolated.store.query('SELECT Name FROM People ORDER BY Name').map((row) => row.Name), ['Ada', 'Lin']);
  } finally {
    isolated.close();
  }
});
