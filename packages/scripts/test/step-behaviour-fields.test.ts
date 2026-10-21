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
