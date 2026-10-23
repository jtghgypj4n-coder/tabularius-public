import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { withFilesystemHook } from '../../store/src/fs-boundary.ts';
import { runScript, ScriptError } from '../src/index.ts';

test('export preserves the original script error when staging cleanup fails', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-cleanup-'));
  createStore(join(dir, 'generated.sqlite'));
  const store = new Store(join(dir, 'generated.sqlite'), 'Generated');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Value' }] }]);
  store.create('Rows', { Value: 'generated' });
  const warnings = t.mock.method(console, 'warn', () => {});
  const result = await withFilesystemHook((event) => {
    if (event.operation === 'write') throw new ScriptError(507, 'original export failed');
    if (event.operation === 'remove') throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
  }, () => runScript(store, { id: 1, name: 'Export', steps: [
    { stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: ['out.csv'], exportFormat: 'COMS' } },
  ] }, { layout: 'Rows', documents: dir }));
  assert.equal(result.error, 507);
  assert.equal(warnings.mock.calls.length, 1);
});
