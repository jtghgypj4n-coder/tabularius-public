import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('navigation');
after(h.close);

test('navigation steps select records and report a bad layout through LastError', async () => {
  const cases = [
    { label: 'first record', action: 'Go to Record/Request/Page [ First ]', expected: 'Ada' },
    { label: 'last record', action: 'Go to Record/Request/Page [ Last ]', expected: 'Lin' },
    { label: 'next record', action: 'Go to Record/Request/Page [ First ]\nGo to Record/Request/Page [ Next ]', expected: 'Lin' },
  ];
  for (const c of cases) {
    const r = await h.run(`${c.action}\nExit Script [ Text Result: People::Name ]`);
    assert.equal(r.result, c.expected, c.label);
  }
  // Claris confirms First/Last/Next behavior; 105 for an unknown layout is the current engine error code.
  const bad = await h.runDirect([
    { stepId: 86, name: 'Set Error Capture', enabled: true, params: { on: true } },
    { stepId: 6, name: 'Go to Layout', enabled: true, params: { layout: { id: 999, name: 'Missing' }, layoutDestination: 'named' } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError )' } },
  ]);
  assert.equal(bad.result, '105');
});
