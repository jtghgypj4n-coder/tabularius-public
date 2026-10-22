import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

for (const name of ['NUL.csv', 'tail.csv.', 'CON.txt', 'name:stream.csv']) {
  test(`script export refuses nonportable output ${name} on Windows`, { skip: process.platform !== 'win32' && 'Windows name rules apply only on Windows' }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-path-'));
    createStore(join(dir, 'test.sqlite'));
    const store = new Store(join(dir, 'test.sqlite'), 'Test');
    t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
    const documents = join(dir, 'Documents');
    const result = await runScript(store, { id: 1, name: 'Export', steps: [{ stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [name], createFolders: true, exportFormat: 'COMS' } }] }, { layout: 'T', documents });
    assert.notEqual(result.error, 0);
    assert.equal(existsSync(join(documents, name)), false);
  });
}

for (const name of ['NUL.csv', 'tail.csv.', 'CON.txt', 'name:stream.csv']) {
  test(`script export keeps ${name}, which is an ordinary name outside Windows`, { skip: process.platform === 'win32' && 'ordinary on other systems only' }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-path-posix-'));
    createStore(join(dir, 'test.sqlite'));
    const store = new Store(join(dir, 'test.sqlite'), 'Test');
    t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
    const documents = join(dir, 'Documents');
    const result = await runScript(store, { id: 1, name: 'Export', steps: [{ stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [name], createFolders: true, exportFormat: 'COMS' } }] }, { layout: 'T', documents });
    assert.equal(result.error, 0);
    assert.equal(existsSync(join(documents, name)), true);
  });
}
