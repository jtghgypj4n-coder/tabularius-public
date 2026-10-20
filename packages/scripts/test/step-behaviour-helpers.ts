import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

export function stepHarness(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), `tabularius-${prefix}-`));
  const documents = join(dir, 'documents');
  mkdirSync(documents);
  const path = join(dir, 'steps.sqlite');
  createStore(path);
  const store = new Store(path, 'Steps');
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [
      { name: 'Name', type: 'text' }, { name: 'Age', type: 'number' }, { name: 'Serial', type: 'number' }, { name: 'Photo', type: 'container' },
    ] },
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Text', type: 'text' }] },
  ]);
  store.create('People', { Name: 'Ada', Age: '36', Serial: '1' });
  store.create('People', { Name: 'Lin', Age: '41', Serial: '2' });

  const script = (text: string) => ({
    id: 9001, name: 'Step behaviour',
    steps: parseScriptText(text.trim(), store.schema).map((s) => ({
      stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params,
    })),
  } as Script);
  const run = (text: string, opts: RunOptions = {}) => runScript(store, script(text), {
    layout: 'People', foundSet: store.findIds('People'), documents, ...opts,
  });
  const runDirect = (steps: ScriptStep[], opts: RunOptions = {}) => runScript(store, {
    id: 9001, name: 'Step behaviour', steps,
  } as Script, { layout: 'People', foundSet: store.findIds('People'), documents, ...opts });
  const close = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, run, runDirect, close, documents };
}
