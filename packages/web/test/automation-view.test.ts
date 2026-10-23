import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleAutomation } from '../src/automation-view.ts';

test('automation toggle follows returned state instead of a possibly stale button label', async () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let serverEnabled = false;
  const call = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    serverEnabled = (body as { enabled: boolean }).enabled;
    return { automation: { enabled: serverEnabled } };
  };
  let enabled = await toggleAutomation('7', false, call); // Turn on again
  enabled = await toggleAutomation('7', enabled, call); // Turn off
  assert.deepEqual(calls.map((c) => c.body), [{ enabled: true }, { enabled: false }]);
  assert.equal(enabled, false);
});
