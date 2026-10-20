import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

test('script sorts with a related key use the sorted field language and ignore leading symbols', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-collation-'));
  const path = join(dir, 'Sort.sqlite');
  createStore(path);
  const store = new Store(path, 'Sort');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Group' }, { name: 'English' }, { name: 'Unicode', options: { indexLanguage: 'Unicode' } }, { name: 'Japanese', options: { indexLanguage: 'Japanese' } }, { name: 'Swedish', options: { indexLanguage: 'Swedish_Custom' } }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Group' }, { name: 'Tie', type: 'number' }] },
    { op: 'createRelationship', left: 'Items', right: 'Children', predicates: [{ left: 'Group', right: 'Group' }] },
  ]);
  for (const [Name, English, Unicode, Japanese, Swedish] of [
    ['two', '2', '2', '処方', 'zebra'], ['hash', '#2', '#2', '自費', 'åre'], ['eleven', '11', '11', 'かき', 'apple'],
  ]) store.create('Items', { Name, Group: 'A', English, Unicode, Japanese, Swedish });
  store.create('Children', { Group: 'A', Tie: '1' });

  for (const [field, expected] of [
    ['English', ['eleven', 'two', 'hash']],
    ['Unicode', ['hash', 'eleven', 'two']],
    ['Japanese', ['eleven', 'hash', 'two']],
    ['Swedish', ['eleven', 'two', 'hash']],
  ] as const) {
    const line = `Sort Records [ Restore; Items::${field}; ascending; Children::Tie; ascending; With dialog: Off ]`;
    const steps = parseScriptText(line, store.schema).map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
    const result = await runScript(store, { id: 9999, name: 'sort', steps } as Script, { layout: 'Items' });
    assert.equal(result.error, 0);
    assert.deepEqual(result.foundSet!.map((id) => store.get('Items', id).fieldData.Name), expected);
  }
});
