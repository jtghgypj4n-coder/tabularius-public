import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('found-sets');
after(h.close);

test('found-set steps omit records and return a find error through LastError', async () => {
  const cases = [
    { steps: 'Go to Record/Request/Page [ First ]\nOmit Record', expected: '1' },
    { steps: 'Go to Record/Request/Page [ First ]\nOmit Multiple Records [ 1 ]', expected: '1' },
    { steps: 'Go to Record/Request/Page [ First ]\nOmit Record\nShow Omitted Only', expected: '1' },
  ];
  for (const c of cases) {
    const r = await h.run(`${c.steps}\nExit Script [ Text Result: Get ( FoundCount ) ]`);
    assert.equal(r.error, 0);
    assert.equal(r.result, c.expected);
  }
  // The engine's current empty-request error is 400; this value isn't asserted here as Claris-verified.
  const bad = await h.run('Set Error Capture [ On ]\nEnter Find Mode [ Pause: Off ]\nPerform Find\nExit Script [ Text Result: Get ( LastError ) ]');
  assert.equal(bad.result, '400');
});
