import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

// A global field is stored in a record; an account that may not view any record gets the refusal it always got, and one that
// may view some reads it from one of those.
function setup(rows: [string, string][]) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-global-read-'));
  createStore(join(dir, 'Data.sqlite'));
  const store = new Store(join(dir, 'Data.sqlite'), 'Data');
  store.applyDesign([{ op: 'createTable', name: 'Settings', fields: [{ name: 'Name' }, { name: 'gTheme', options: { global: true } }] }]);
  for (const [name, theme] of rows) store.create('Settings', { Name: name, gTheme: theme });
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
    tables: { Settings: { view: 'Name = "visible"', edit: false, create: false, delete: false } },
    layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: [] });
  store.setPassword('Reader', 'pw', 'Reader');
  const run = () => runScript(store, {
    id: 9999, name: 'Probe', fullAccess: false,
    steps: parseScriptText('Set Error Capture [ On ]\nSet Variable [ $g ; Value: Settings::gTheme ]\nExit Script [ Text Result: $g & "|" & Get ( LastError ) ]', store.schema)
      .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params })),
  }, { layout: 'Settings', account: 'Reader', privileges: store.privileges('Reader') });
  return { run, close: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

test('a stored global read by an account that may view no record is refused as before', async () => {
  const s = setup([['hidden', 'SENTINEL-DARK']]);
  try {
    assert.equal((await s.run()).result, '|200');
  } finally { s.close(); }
});

test('a stored global is read from a record the account may view, though a hidden one comes first', async () => {
  const s = setup([['hidden', 'SENTINEL-HIDDEN'], ['visible', 'dark']]);
  try {
    assert.equal((await s.run()).result, 'dark|0');
  } finally { s.close(); }
});
