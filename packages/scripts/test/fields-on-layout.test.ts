import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { importFmp12, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-gfl-'));
  importFmp12(fixture, join(dir, 'Flicks.sqlite'));
  store = new Store(join(dir, 'Flicks.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}
const result = async (formula: string, layout = 'WV Framework - Modules', account?: string) =>
  String((await runScript(store, script(`Exit Script [ Text Result: ${formula} ]`),
    { layout, foundSet: store.findIds(layout), ...(account ? { account, privileges: store.privileges(account) } : {}) })).result);

test('GetFieldsOnLayout lists the fields placed on a layout, typed and described from their comments', { skip }, async () => {
  const json = JSON.parse(await result('GetFieldsOnLayout ( "WV Framework - Modules" )'));
  assert.equal(json.layout_name, 'WV Framework - Modules');
  assert.deepEqual(json.fields['LIBRARY_CODE::enabled'], { description: 'Defaults to True, causing code to get loaded.', type: 'number' });
  assert.deepEqual(json.fields['LIBRARY_CODE::name'], { type: 'string' });
  // "" is the current layout.
  assert.equal(await result('GetFieldsOnLayout ( "" )'), await result('GetFieldsOnLayout ( "WV Framework - Modules" )'));
  // No such layout: empty.
  assert.equal(await result('GetFieldsOnLayout ( "No such layout" )'), '');
});

test('GetFieldsOnLayout leaves out global fields, as Claris documents', { skip }, async () => {
  const fields = Object.keys(JSON.parse(await result('GetFieldsOnLayout ( "WV Framework - Demo" )')).fields);
  assert.ok(!fields.some((f) => f.startsWith('FOCUS::g_')), fields.join(', '));
  const sample = Object.keys(JSON.parse(await result('GetFieldsOnLayout ( "WV Framework - Sample Data" )')).fields);
  assert.ok(sample.includes('MOVIE::runtime') && !sample.includes('MOVIE::const_display_gt'), sample.join(', '));
});

test('GetFieldsOnLayout leaves out fields the account can\'t see, and lists nothing for a layout it can\'t open', { skip }, async () => {
  const to = store.schema.tableOccurrences.find((t) => t.name === 'LIBRARY_CODE')!;
  const table = store.schema.tables.find((t) => t.id === to.baseTableId)!.name;
  const records = { view: true, edit: true, create: true, delete: true };
  store.savePrivilegeSet({
    name: 'NoCode', records, tables: { [table]: { ...records, fields: { code: 'none' } } }, layouts: 'modifiable',
    layoutAccess: { 'WV Framework - Demo': { layout: 'none', records: 'none' } }, valueLists: 'none', scripts: 'modifiable', extendedPrivileges: [],
  });
  store.setPassword('nocode', 'nocode-pw-1234', 'NoCode');
  const fields = Object.keys(JSON.parse(await result('GetFieldsOnLayout ( "WV Framework - Modules" )', undefined, 'nocode')).fields);
  assert.ok(fields.includes('LIBRARY_CODE::name') && !fields.includes('LIBRARY_CODE::code'), fields.join(', '));
  assert.equal(await result('GetFieldsOnLayout ( "WV Framework - Demo" )', undefined, 'nocode'), '');
});
