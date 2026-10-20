// A layout set to "records view only" stays view only in scripts when it shows
// a table from another file: the layout's own file checks its layout
// privileges before the other file checks record and field access.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '../../store/src/index.ts';
import type { Script } from '../../fmp12/src/index.ts';
import { runScript } from '../src/index.ts';

let dir: string;
let a: Store;
let b: Store;
let id: number;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-external-viewonly-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  a = open('A');
  b = open('B');
  b.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  id = b.create('Items', { Name: 'first' }).recordId;
  b.setPassword('Clerk', 'password', '[Full Access]');
  a.applyDesign([{ op: 'createDataSource', name: 'B', paths: ['file:B'] }]);
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  a.applyDesign([
    { op: 'createOccurrence', name: 'BItems', file: 'B', externalTable: b.schema.tables[0].id },
    { op: 'createLayout', name: 'ExternalItems', occurrence: 'BItems' },
    { op: 'createLayout', name: 'EditableItems', occurrence: 'BItems' },
  ]);
  a.savePrivilegeSet({
    name: 'Clerks', records: { view: true, edit: true, create: true, delete: true },
    layouts: 'viewOnly', layoutAccess: { ExternalItems: { layout: 'viewOnly', records: 'viewOnly' } },
    valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
  });
  a.setPassword('Clerk', 'password', 'Clerks');
});

after(() => {
  a?.close();
  b?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const script = (text: string): Script => ({
  id: 9999, name: 'test',
  steps: parseScriptText(text, a.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script);
const run = (layout: string, text: string) => runScript(a, script(text), { layout, foundSet: [id], account: 'Clerk', privileges: a.privileges('Clerk') });
const edit = 'Set Error Capture [ On ]\nSet Field [ BItems::Name ; "changed" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) ]';

test('a records-view-only layout on another file\'s table refuses edits, new records and deletes (200)', async () => {
  assert.equal((await run('ExternalItems', edit)).result, '200');
  assert.equal(String(b.get('Items', id).fieldData.Name), 'first', 'nothing was written');
  assert.equal((await run('ExternalItems', 'Set Error Capture [ On ]\nNew Record/Request\nExit Script [ Text Result: Get ( LastError ) ]')).result, '200');
  assert.equal((await run('ExternalItems', 'Set Error Capture [ On ]\nDelete Record/Request [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) ]')).result, '200');
  assert.equal((await run('ExternalItems', 'Exit Script [ Text Result: Get ( RecordAccess ) ]')).result, '1', 'Get ( RecordAccess ) says view only');
  assert.equal(b.findIds('Items').length, 1);
});

test('a modifiable layout on the same table still edits', async () => {
  assert.equal((await run('EditableItems', edit)).result, '0');
  assert.equal(String(b.get('Items', id).fieldData.Name), 'changed');
});

test('Duplicate Record checks the external layout before creating a row in its owner', async () => {
  const before = b.findIds('Items');
  const text = 'Set Error Capture [ On ]\nDuplicate Record/Request\nExit Script [ Text Result: Get ( LastError ) ]';
  assert.equal((await run('ExternalItems', text)).result, '200');
  assert.deepEqual(b.findIds('Items'), before);
  assert.equal((await run('EditableItems', text)).result, '0');
  assert.equal(b.findIds('Items').length, before.length + 1);
});

test('Truncate Table checks layout write access before the external owner full-access gate', async () => {
  const before = b.findIds('Items');
  assert.equal((await run('ExternalItems', 'Set Error Capture [ On ]\nTruncate Table\nExit Script [ Text Result: Get ( LastError ) ]')).result, '200');
  assert.deepEqual(b.findIds('Items'), before);
});
