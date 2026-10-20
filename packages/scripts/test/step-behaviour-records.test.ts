import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('records');
after(h.close);

test('record steps create, duplicate, and remove records; failures update LastError', async () => {
  const cases = [
    {
      label: 'new record with values',
      script: 'New Record/Request\nSet Field [ People::Name ; "Mira" ]\nSet Field [ People::Age ; 29 ]\nCommit Records/Requests [ With dialog: Off ]',
      query: "SELECT Name || ':' || Age AS value FROM People WHERE Name = 'Mira'",
      expected: 'Mira:29.0',
    },
    {
      label: 'duplicate current record',
      script: 'Go to Record/Request/Page [ First ]\nDuplicate Record/Request [ With dialog: Off ]\nCommit Records/Requests [ With dialog: Off ]',
      query: "SELECT count(*) AS value FROM People WHERE Name = 'Ada'",
      expected: '2',
    },
    {
      label: 'delete current record',
      script: 'Enter Find Mode [ Pause: Off ]\nSet Field [ People::Name ; "Lin" ]\nPerform Find\nDelete Record/Request [ With dialog: Off ]',
      query: "SELECT count(*) AS value FROM People WHERE Name = 'Lin'",
      expected: '0',
    },
  ];
  for (const c of cases) {
    const r = await h.run(c.script);
    assert.equal(r.error, 0, c.label);
    assert.equal(String(h.store.query(c.query)[0].value), c.expected, c.label);
  }
  // Error 102 for an unresolved field name is the engine's current behavior; this test doesn't claim Claris verifies it.
  const bad = await h.runDirect([
    { stepId: 86, name: 'Set Error Capture', enabled: true, params: { on: true } },
    { stepId: 116, name: 'Set Next Serial Value', enabled: true, params: { field: { tableOccurrence: { id: 0, name: 'People' }, field: { id: 999, name: 'Missing' } }, value: '5' } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError )' } },
  ]);
  assert.equal(bad.result, '102');
});
