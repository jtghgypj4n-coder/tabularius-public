import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

test('MBS IsServer is true for unattended runs and server scripts, false for a web-client run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mbs-system-'));
  const file = join(dir, 'Generated.sqlite');
  createStore(file);
  const store = new Store(file, 'Generated');
  try {
    store.applyDesign([
      { op: 'createScript', name: 'Check', text: 'Exit Script [ Text Result: MBS ( "IsServer" ) ]' },
      { op: 'createScript', name: 'Call server', text: [
        'Set Variable [ $client ; Value: MBS ( "IsServer" ) ]',
        'Perform Script on Server [ "Check" ; Wait for completion: On ]',
        'Exit Script [ Text Result: $client & "/" & Get ( ScriptResult ) ]',
      ].join('\n') },
    ]);
    assert.equal((await runScript(store, 'Check')).result, '1');
    assert.equal((await runScript(store, 'Check', { downloads: true })).result, '0');
    assert.equal((await runScript(store, 'Call server', { downloads: true })).result, '0/1');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
