// Set Error Capture and Allow User Abort follow the same rule as Set Revert Transaction on Error: a subscript inherits the
// caller's setting and whatever it sets lasts only while it runs. Claris does not spell the scope out (unverified).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

async function run(scripts: Record<string, string>, main: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-settings-scope-'));
  createStore(join(dir, 'S.sqlite'));
  const store = new Store(join(dir, 'S.sqlite'), 'S');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] },
      ...Object.entries(scripts).map(([name, text]) => ({ op: 'createScript' as const, name, text })),
      { op: 'createScript', name: 'Main', text: main },
    ]);
    return String((await runScript(store, 'Main', { layout: 'Items' })).result);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const STATE = 'Get ( ErrorCaptureState ) & Get ( AllowAbortState )';

test('a subscript that changes error capture and user abort leaves the caller\'s settings as they were', async () => {
  const result = await run(
    { Quiet: 'Set Error Capture [ On ]\nSet Variable [ $inside ; Value: ' + STATE + ' ]\nAllow User Abort [ Off ]\nExit Script [ Text Result: $inside & "/" & ' + STATE + ' ]' },
    'Perform Script [ Specified: By name ; "Quiet" ]\nExit Script [ Text Result: Get ( ScriptResult ) & "/" & ' + STATE + ' ]',
  );
  assert.equal(result, '11/10/01');
});

test('a subscript starts with the caller\'s settings', async () => {
  const result = await run(
    { Peek: 'Exit Script [ Text Result: ' + STATE + ' ]' },
    'Set Error Capture [ On ]\nAllow User Abort [ Off ]\nPerform Script [ Specified: By name ; "Peek" ]\nExit Script [ Text Result: Get ( ScriptResult ) ]',
  );
  assert.equal(result, '10');
});
