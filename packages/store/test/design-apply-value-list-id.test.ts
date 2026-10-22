// A value list's file names its object by the (id N) in its first line, so moving the file or renaming it keeps the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, designText, planDesignApply, readDesignFolder, Store, writeDesignText } from '../src/index.ts';

test('a moved value-list file is the same list, not a new one', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tab-vl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'F.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => store.close());
  store.applyDesign([{ op: 'createValueList', name: 'Colours', values: ['red', 'blue'] }]);
  const source = () => ({ schema: store.schema, layouts: store.designs().layouts, accounts: store.accounts(), privilegeSets: store.privilegeSets() });
  const folder = join(dir, 'design');
  mkdirSync(folder);
  writeDesignText(folder, designText(source()));
  assert.deepEqual(planDesignApply(readDesignFolder(folder), source()).ops, [], 'the export is nothing to apply');
  const [file] = readdirSync(join(folder, 'value-lists'));
  renameSync(join(folder, 'value-lists', file), join(folder, 'value-lists', 'Somewhere else.txt'));
  const p = planDesignApply(readDesignFolder(folder), source());
  assert.deepEqual(p.ops, [], `a moved file changes nothing: ${p.lines.join('; ')}`);
});
