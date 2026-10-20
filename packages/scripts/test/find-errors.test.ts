// Find errors say which fields (and empty variables) were involved, never the criteria themselves,
// so a test-scripts report on a client's file shows why a find failed without showing its data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-find-errors-'));
  createStore(join(dir, 'F.sqlite'));
  store = new Store(join(dir, 'F.sqlite'), 'F');
  store.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Name', type: 'text' }, { name: 'Status', type: 'text' }] }]);
  store.create('Clients', { Name: 'Acme', Status: 'Active' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const run = (text: string) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script, { layout: 'Clients', trace: true });
const message = (r: Awaited<ReturnType<typeof run>>) => [...(r.trace ?? [])].reverse().find((t) => t.error)?.message ?? '';

test('no criteria: names the fields set to nothing', async () => {
  const r = await run(`
    Enter Find Mode [ Pause: Off ]
    Set Field [ Clients::Name ; $search ]
    Perform Find []`);
  assert.equal(r.error, 400);
  assert.equal(message(r), 'No find criteria (Name set to nothing)');
  const none = await run('Enter Find Mode [ Pause: Off ]\nPerform Find []');
  assert.equal(message(none), 'No find criteria (no field was set in find mode)');
});

test('no records: names the fields searched, not what was searched for', async () => {
  const r = await run(`
    Enter Find Mode [ Pause: Off ]
    Set Field [ Clients::Name ; "Secret Client Ltd" ]
    Set Field [ Clients::Status ; "Active" ]
    Perform Find []`);
  assert.equal(r.error, 401);
  assert.equal(message(r), 'No records match the request (by Name, Status)');
  assert.doesNotMatch(JSON.stringify(r.trace), /Secret Client/);
});
