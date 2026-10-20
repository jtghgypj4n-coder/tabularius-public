import { test } from 'node:test';
import { probe, moduleUrl } from './edge-child-probe.ts';

for (const transaction of [false, true]) for (const mode of ['On', 'Off', 'Callback']) test(`AR-server-edge-07 ${mode} ${transaction}`, async () => {
  await probe(`
  import assert from 'node:assert/strict';
  import { ScriptQueue } from ${moduleUrl('../src/server-queue.ts')};
  const { createStore, Store } = await import(${moduleUrl('../../store/src/index.ts')});
  const { runScript } = await import(${moduleUrl('../../scripts/src/index.ts')});
  import { join } from 'node:path';
  const mode = ${JSON.stringify(mode)};
  const transaction = ${transaction};
  const dir = process.argv[1];
  const path = join(dir, 'Test.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Test');
  const queue = new ScriptQueue(1, { pending: 1, perProducer: 1 });
  let release;
  const active = queue.run(() => new Promise(resolve => { release = resolve; }));
  const pending = queue.run(async () => {});
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
      { op: 'createScript', name: 'Work', text: 'Exit Script [ Text Result: "ran" ]' },
      { op: 'createScript', name: 'Caller', text: [
        'Set Error Capture [ On ]', ...(transaction ? ['Open Transaction', 'Set Field [ Items::Name ; "changed" ]'] : []),
        mode === 'Callback' ? 'Perform Script on Server with Callback [ “Work” ; Callback script: “Work” ; State: Continue ]'
          : 'Perform Script on Server [ “Work” ; Wait for completion: ' + mode + ' ]',
        'Exit Script [ Text Result: Get ( LastError ) ]',
      ].join('\\n') },
    ]);
    const id = store.create('Items', { Name: 'original' });
    const result = await runScript(store, 'Caller', { layout: 'Items', serverQueue: queue });
    if (transaction) assert.equal(result.error, 812);
    else assert.equal(result.result, '812');
    assert.equal(store.get('Items', Number(id.recordId)).fieldData.Name, 'original');
    assert.equal(queue.queued, 1);
  } finally {
    release(); await active; await pending;
    store.close();
  }
  `);
});
