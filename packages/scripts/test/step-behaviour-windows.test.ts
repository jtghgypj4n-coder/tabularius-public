import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('windows');
after(h.close);
const main = { id: 'MAIN', name: 'Steps', style: 'document' as const, layout: 'People' };
const client = { startWindow: main, openWindows: [main] };

test('window steps select and close named windows; unknown windows set LastError', async () => {
  const cases = [
    { script: 'New Window [ "Report" ]\nExit Script [ Text Result: Get ( WindowName ) ]', expected: 'Report' },
    { script: 'New Window [ "Report" ]\nSelect Window [ Name: "Report" ]\nExit Script [ Text Result: Get ( WindowName ) ]', expected: 'Report' },
    { script: 'New Window [ "Report" ]\nClose Window [ Current Window ]\nExit Script [ Text Result: Get ( WindowName ) ]', expected: 'Steps' },
  ];
  for (const c of cases) {
    const r = await h.run(c.script, client);
    assert.equal(r.result, c.expected);
  }
  // Error 112 for a missing window follows this repo's current behavior; Claris documents the failure but not a code here.
  const bad = await h.run('Set Error Capture [ On ]\nSelect Window [ Name: "Missing" ]\nExit Script [ Text Result: Get ( LastError ) ]', client);
  assert.equal(bad.result, '112');
});
