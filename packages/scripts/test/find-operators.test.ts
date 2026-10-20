import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, Store, parseScriptText } from '@tabularius/store';
import { runScript } from '../src/index.ts';

test('Perform Find uses the shared operators and reports unsupported criteria as 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-find-operators-'));
  const path = join(dir, 'Find.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Code' }, { name: 'Day', type: 'date' }, { name: 'Number', type: 'number' }] }]);
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    store.create('Items', { Name: 'café', Code: 'A3x', Day: day });
    store.create('Items', { Name: 'café', Code: 'A30x', Day: 'next Tuesday' });
    store.create('Items', { Name: 'a'.repeat(100000) });
    for (const [field, value, count, error] of [
      ['Name', '!', 2, 0], ['Day', '//', 1, 0], ['Day', '?', 1, 0],
      ['Code', 'A#@', 1, 0], ['Name', '~cafe', 2, 0], ['Name', '~', undefined, 400],
      ['Number', '1...2...3', undefined, 508],
      ['Name', '#'.repeat(100000), undefined, 400], ['Name', '@'.repeat(100), undefined, 400],
    ] as const) {
      const text = `Enter Find Mode [ Pause: Off ]\nSet Field [ Items::${field} ; "${value}" ]\nPerform Find []`;
      const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      const r = await runScript(store, { id: 9999, name: 'Find', steps } as Script, { layout: 'Items' });
      assert.equal(r.error, error, value);
      if (count !== undefined) assert.equal(r.foundSet?.length, count, value);
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const related of [false, true]) for (const restore of [false, true]) {
  test(`Perform Find ordered and omit-only requests (${related ? 'related' : 'own'}, ${restore ? 'stored' : 'find mode'})`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-find-order-'));
    const path = join(dir, 'Find.sqlite');
    createStore(path);
    const store = new Store(path);
    t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Text' }] },
      { op: 'createTable', name: 'Links', fields: [{ name: 'Item' }] },
      { op: 'createRelationship', left: 'Links', right: 'Items', predicates: [{ left: 'Item', right: 'Text' }] },
    ]);
    for (const Text of ['dup', 'dup', 'solo']) store.create('Items', { Text });
    store.create('Links', { Item: 'dup' });
    store.create('Links', { Item: 'solo' });
    const field = 'Items::Text';
    const layout = related ? 'Links' : 'Items';
    for (const [include, count] of [[false, 1], [true, related ? 2 : 3]] as const) {
      const text = restore
        ? 'Perform Find []'
        : `Enter Find Mode [ Pause: Off ]\nSet Field [ ${field} ; "!" ]\nOmit Record []\n${include ? `New Record/Request []\nSet Field [ ${field} ; "*" ]\n` : ''}Perform Find []`;
      const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      // Stored request parameters use the same field reference as Set Field.
      if (restore) {
        const ref = parseScriptText(`Set Field [ ${field} ; "!" ]`, store.schema)[0].params!.field!;
        steps[0].params = { restore: true, requests: [{ omit: true, criteria: [{ field: ref, criteria: '!' }] },
          ...(include ? [{ omit: false, criteria: [{ field: ref, criteria: '*' }] }] : [])] };
      }
      const result = await runScript(store, { id: 9999, name: 'Find', steps } as Script, { layout });
      assert.equal(result.error, 0);
      assert.equal(result.foundSet?.length, count);
    }
  });
}
