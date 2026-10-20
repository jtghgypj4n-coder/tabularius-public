import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript, ScriptError } from '../src/index.ts';
import type { ScriptStep } from '../../fmp12/src/index.ts';

const step = (stepId: number, name: string, params: ScriptStep['params'] = {}): ScriptStep => ({ stepId, name, enabled: true, params });

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-owner-'));
  const stores = ['A', 'B'].map((name) => {
    createStore(join(dir, `${name}.sqlite`)); return new Store(join(dir, `${name}.sqlite`), name);
  });
  const [a, b] = stores;
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true }); });
  b.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
  b.create('T', { Value: 'ExternalExportVaultsentinel' });
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  a.applyDesign([
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
    { op: 'createOccurrence', name: 'External', file: 'B', externalTable: b.schema.tables[0].id },
    { op: 'createLayout', name: 'External', occurrence: 'External' },
  ]);
  return { a, b, documents: join(dir, 'Documents') };
}

for (const [id, name] of [[144, 'Save Records as PDF'], [143, 'Save Records as Excel'], [36, 'Export Records'], [225, 'Save Records as JSONL'], [152, 'Save Records as Snapshot Link']] as const) {
  for (const isolated of [false, true]) test(`${name} checks the retained external owner before creating output (${isolated ? 'isolated' : 'allowed'})`, async (t) => {
    const { a, b, documents } = setup(t);
    let blocked = false, reads = 0;
    const get = b.get.bind(b);
    t.mock.method(b, 'get', (...args: Parameters<typeof get>) => { if (blocked) reads++; return get(...args); });
    const result = await runScript(a, { id: 999, name: 'Export', steps: [step(id, name, {
      filePaths: ['out'], createFolders: true, exportFormat: 'COMS',
      field: { tableOccurrence: { id: a.schema.tableOccurrences[0].id, name: 'External' }, field: { id: b.schema.tables[0].fields[0].id, name: 'Value' } },
    })] }, { layout: 'External', documents, beforeFile: (file) => {
      if (file === b && blocked) throw new ScriptError(3, 'The export owner is isolated');
    }, profile: { run: () => {}, step: () => {}, enter: () => { blocked = isolated; } } });
    assert.equal(result.error, isolated ? 3 : 0);
    assert.equal(reads, 0);
    assert.equal(existsSync(documents), !isolated);
    assert.equal(existsSync(join(documents, 'out')), !isolated);
  });
}

for (const isolated of [false, true]) test(`Close PDF rechecks a captured external owner after switching windows (${isolated ? 'isolated' : 'allowed'})`, async (t) => {
  const { a, b, documents } = setup(t);
  let blocked = false;
  a.applyDesign([{ op: 'createTable', name: 'Local', fields: [{ name: 'Value' }] }]);
  const result = await runScript(a, { id: 999, name: 'PDF', steps: [
    step(243, 'Create PDF'), step(144, 'Save Records as PDF', { toOpenPdf: true }),
    step(6, 'Go to Layout', { layoutDestination: 'named', layout: { id: a.schema.layouts.find((l) => l.name === 'Local')!.id, name: 'Local' } }),
    step(245, 'Close PDF', { filePaths: ['out.pdf'], createFolders: true }),
  ] }, { layout: 'External', documents, beforeFile: (file) => {
    if (file === b && blocked) throw new ScriptError(3, 'The PDF source is isolated');
  }, profile: { run: () => {}, step: (_file, _script, index) => { if (index === 2) blocked = isolated; } } });
  assert.equal(result.error, isolated ? 3 : 0);
  assert.equal(existsSync(documents), !isolated);
  assert.equal(existsSync(join(documents, 'out.pdf')), !isolated);
});
