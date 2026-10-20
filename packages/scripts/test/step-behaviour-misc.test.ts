import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('misc');
after(h.close);

test('miscellaneous session steps preserve their parameter and report unavailable steps in LastError', async () => {
  const cases = [
    { step: 'Set Session Identifier [ "batch-42" ]', expected: 'batch-42' },
    { step: 'Set Session Identifier [ "" ]', expected: '' },
  ];
  for (const c of cases) {
    const r = await h.run(`${c.step}\nExit Script [ Text Result: Get ( SessionIdentifier ) ]`);
    assert.equal(r.error, 0);
    assert.equal(r.result, c.expected);
  }
  const states = await h.run('Set Use System Formats [ On ]\nSet Variable [ $on ; Value: Get ( UseSystemFormatsState ) ]\nSet Use System Formats [ Off ]\nExit Script [ Text Result: $on & "/" & Get ( UseSystemFormatsState ) ]');
  // Claris says this step is unavailable in Server/WebDirect; the state flag below is Tabularius's current behavior.
  assert.equal(states.result, '1/0');
  const actions = await h.run('Open Manage Layouts\nOpen Manage Themes\nFlush Web Viewer Cookies\nPrint PDF [ With dialog: On ]');
  assert.equal(actions.actions.length, 4);
  assert.deepEqual(actions.actions.slice(0, 2).map((a) => a.open), ['design.html#layouts', 'design.html#themes']);
  // Get Folder Path is documented as unavailable to this server; its existing error is 3.
  const bad = await h.run('Set Error Capture [ On ]\nGet Folder Path\nExit Script [ Text Result: Get ( LastError ) ]');
  assert.equal(bad.result, '3');
  const sendEvent = await h.runDirect([
    { stepId: 86, name: 'Set Error Capture', enabled: true, params: { on: true } },
    { stepId: 57, name: 'Send Event', enabled: true, params: {} },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError )' } },
  ]);
  assert.equal(sendEvent.result, '3');
});
