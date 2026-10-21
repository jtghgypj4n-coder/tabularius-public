import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScriptTests } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-test-termination-'));
let store;
try {
  const path = join(dir, 'T.sqlite');
  createStore(path);
  store = new Store(path, 'T');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'text' }] },
    { op: 'createScript', name: 'Limited loop', text: 'Loop\nSet Variable [ $x ; Value: 1 ]\nEnd Loop' },
    { op: 'createScript', name: 'Canceled loop', text: 'Loop\nSet Variable [ $x ; Value: 1 ]\nEnd Loop' },
  ]);
  const [limitedScript, canceledScript] = store.schema.scripts;
  const limited = await runScriptTests(store, [{ id: 'limited', script: limitedScript.id, name: 'step budget', given: {}, expect: { error: 0 } }], { maxSteps: 5 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const canceled = await runScriptTests(store, [{ id: 'canceled', script: canceledScript.id, name: 'cancellation', given: {}, expect: { error: 0 } }], { maxSteps: 1_000_000_000, stop: controller.signal });
  process.stdout.write(JSON.stringify({ limited: limited[0], canceled: canceled[0] }));
} finally {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
}
