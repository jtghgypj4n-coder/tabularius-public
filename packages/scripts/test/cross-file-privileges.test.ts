import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '../../store/src/index.ts';
import type { Script, ScriptStep } from '../../fmp12/src/index.ts';
import { runScript, ScriptSession } from '../src/index.ts';

let dir: string;
let a: Store;
let b: Store;
let id: number;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-file-privileges-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  a = open('A');
  b = open('B');
  b.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Visible', type: 'number' }, { name: 'Secret' }, { name: 'GlobalSecret', options: { global: true } }] },
    { op: 'createScript', name: 'Inspect', text: 'Exit Script [ Text Result: Get ( FoundCount ) & "|" & Items::Secret ]' },
    { op: 'createScript', name: 'Forbidden', text: 'Exit Script [ Text Result: "forbidden ran" ]' },
    { op: 'createScript', name: 'WriteSecret', text: 'Set Error Capture [ On ]\nSet Field [ Items::Secret ; "changed" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) ]' },
  ]);
  b.create('Items', { Visible: 0, Secret: 'hidden row' });
  id = b.create('Items', { Visible: 1, Secret: 'hidden field' }).recordId;
  b.savePrivilegeSet({
    name: 'Limited', records: { view: 'Visible = 1', edit: true, create: false, delete: false },
    tables: { Items: { view: 'Visible = 1', edit: true, create: false, delete: false, fields: { Secret: 'none', GlobalSecret: 'none' } } },
    layouts: 'modifiable', scripts: 'viewOnly', scriptAccess: { Forbidden: 'none' }, valueLists: 'viewOnly', extendedPrivileges: [],
  });
  b.setPassword('Owner', 'password', 'Limited');
  b.setPassword('Both', 'password', '[Full Access]');
  a.setPassword('Owner', 'password', '[Full Access]');
  a.setPassword('Both', 'password', '[Full Access]');
  a.applyDesign([{ op: 'createDataSource', name: 'B', paths: ['file:B'] }]);
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  a.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Link', type: 'number' }, { name: 'Secret' }] },
    { op: 'createOccurrence', name: 'BItems', file: 'B', externalTable: b.schema.tables[0].id },
    { op: 'createLayout', name: 'Outside', occurrence: 'Parents' },
    { op: 'createLayout', name: 'ExternalItems', occurrence: 'BItems' },
  ]);
  a.applyDesign([{ op: 'createRelationship', left: 'Parents', right: 'BItems', predicates: [{
    left: a.schema.tables[0].fields.find((f) => f.name === 'Link')!.id,
    right: b.schema.tables[0].fields.find((f) => f.name === 'Visible')!.id,
  }] }]);
  a.create('Parents', { Link: 1, Secret: 'local secret' });
  a.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none' } }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
  a.setPassword('Reader', 'password', 'Reader');
  b.applyDesign([
    { op: 'createScript', name: 'Work', text: 'Exit Script [ Text Result: "done" ]' },
    { op: 'createScript', name: 'ForbiddenCallback', text: 'Set Variable [ $$callbackRan ; Value: "ran" ]' },
    { op: 'createScript', name: 'QueueCallback', text: 'Perform Script on Server with Callback [ “Work” ; Callback script: “ForbiddenCallback” ; State: Continue ]' },
  ]);
  b.savePrivilegeSet({ ...b.privilegeSet('Limited')!, scriptAccess: { Forbidden: 'none', ForbiddenCallback: 'none' } });
});

after(() => {
  a?.close();
  b?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const parse = (text: string): ScriptStep[] => parseScriptText(text, a.schema)
  .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));

function caller(name: string, onServer: boolean, byName: boolean, fullAccess: boolean): Script {
  const step = onServer ? 'Perform Script on Server' : 'Perform Script';
  const steps = byName
    ? parse(`Set Error Capture [ On ]\n${step} [ Specified: By name ; "B::${name}" ]`)
    : [
      { stepId: 86, name: 'Set Error Capture', enabled: true, params: { on: true } },
      { stepId: onServer ? 164 : 1, name: step, enabled: true, params: {
        script: { id: b.schema.scripts.find((s) => s.name === name)!.id, name, file: { id: a.schema.dataSources[0].id, name: 'B' } },
      } },
    ];
  steps.push(...parse('If [ Get ( LastError ) <> 0 ]\nExit Script [ Text Result: Get ( LastError ) ]\nEnd If\nExit Script [ Text Result: Get ( ScriptResult ) ]'));
  return { id: 9999, name: 'Caller', steps, fullAccess };
}

for (const onServer of [false, true]) for (const byName of [false, true]) for (const fullAccess of [false, true]) {
  test(`${onServer ? 'server' : 'client'} script, ${byName ? 'by name' : 'from list'}, caller full-access option ${fullAccess}: B privileges always apply`, async () => {
    const opts = { account: 'Owner', privileges: a.privileges('Owner') };
    const denied = await runScript(a, caller('Forbidden', onServer, byName, fullAccess), opts);
    assert.equal(denied.result, '9');
    const read = await runScript(a, caller('Inspect', onServer, byName, fullAccess), opts);
    assert.equal(read.error, 0);
    assert.equal(read.result, '1|', 'initial B found set excludes the hidden row and hides its field');
    const write = await runScript(a, caller('WriteSecret', onServer, byName, fullAccess), opts);
    assert.equal(write.result, '201');
    assert.equal(b.get('Items', id).fieldData.Secret, 'hidden field', 'commit keeps B field restrictions');
  });
}

test('a full account may still manage accounts in its own file', async () => {
  a.savePrivilegeSet({ ...b.privilegeSet('Limited')!, id: undefined });
  const script: Script = { id: 9999, name: 'Manage', steps: parse('Add Account [ Account Name: "Added" ; Password: "pw" ; Privilege Set: "Limited" ]\nExit Script [ Text Result: Get ( LastError ) ]') };
  const r = await runScript(a, script, { account: 'Owner', privileges: a.privileges('Owner') });
  assert.equal(r.result, '0');
  assert.ok(a.accounts().some((account) => account.name === 'Added'));
});

test('full-access elevation retains destination restrictions for direct external reads and writes', async () => {
  const opts = { layout: 'Parents', account: 'Owner', privileges: a.privileges('Owner') };
  const read = { id: 9999, name: 'Read external', steps: parse('Exit Script [ Text Result: BItems::Secret ]') };
  assert.equal((await runScript(a, read, opts)).result, '');
  assert.equal((await runScript(a, { ...read, fullAccess: true }, opts)).result, '');
  const write: Script = { id: 9999, name: 'Write external', fullAccess: true, steps: parse('Set Error Capture [ On ]\nSet Field [ BItems::Secret ; "changed" ]\nExit Script [ Text Result: Get ( LastError ) ]') };
  assert.equal((await runScript(a, write, opts)).result, '201');
  assert.equal(b.get('Items', id).fieldData.Secret, 'hidden field');
  const session = new ScriptSession();
  const global: Script = { ...write, steps: parse('Set Error Capture [ On ]\nSet Field [ BItems::GlobalSecret ; "changed" ]\nExit Script [ Text Result: Get ( LastError ) ]') };
  assert.equal((await runScript(a, global, { ...opts, session })).result, '201');
  assert.equal(session.globalFields.size, 0, 'elevation does not permit writing a hidden external global');
});

test('elevated Execute FileMaker Data API respects destination records and fields', async () => {
  const script: Script = { id: 9999, name: 'External API', fullAccess: true, steps: parse('Execute FileMaker Data API [ Select ; Target: $data ; "{\\"layouts\\":\\"ExternalItems\\"}" ]\nExit Script [ Text Result: $data ]') };
  const r = await runScript(a, script, { layout: 'Parents', account: 'Owner', privileges: a.privileges('Owner') });
  const data = JSON.parse(r.result);
  assert.equal(data.messages[0].code, '0');
  assert.equal(data.response.dataInfo.foundCount, 1);
  assert.equal(data.response.data.length, 1);
  assert.equal(data.response.data[0].fieldData.Secret, undefined);
  const write: Script = { id: 9999, name: 'External API write', fullAccess: true, steps: parse(`Set Error Capture [ On ]\nExecute FileMaker Data API [ Select ; Target: $data ; "{\\"action\\":\\"update\\",\\"layouts\\":\\"ExternalItems\\",\\"recordId\\":${id},\\"fieldData\\":{\\"Secret\\":\\"changed\\"}}" ]\nExit Script [ Text Result: $data ]`) };
  const written = await runScript(a, write, { layout: 'Parents', account: 'Owner', privileges: a.privileges('Owner') });
  assert.equal(JSON.parse(written.result).messages[0].code, '201');
  assert.equal(b.get('Items', id).fieldData.Secret, 'hidden field');
});

for (const fullAccess of [false, true]) test(`cross-file server callback denial, callback full-access option ${fullAccess}`, async () => {
  const callback = b.schema.scripts.find((s) => s.name === 'ForbiddenCallback')!;
  const saved = callback.fullAccess;
  callback.fullAccess = fullAccess;
  const session = new ScriptSession();
  try {
    const r = await runScript(a, caller('QueueCallback', false, true, true), { layout: 'Parents', account: 'Owner', privileges: a.privileges('Owner'), session });
    assert.equal(r.error, 9);
    assert.equal(session.variables.has('$$callbackran'), false, 'a denied callback never executes, including under elevation');
  } finally {
    callback.fullAccess = saved;
  }
});

test('full access in both files permits cross-file scripts, external reads/writes and callbacks', async () => {
  const opts = { layout: 'Parents', account: 'Both', privileges: a.privileges('Both') };
  assert.equal((await runScript(a, caller('Forbidden', false, true, false), opts)).result, 'forbidden ran');
  assert.equal((await runScript(a, caller('Forbidden', true, false, true), opts)).result, 'forbidden ran');
  const read: Script = { id: 9999, name: 'Read external', fullAccess: true, steps: parse('Exit Script [ Text Result: BItems::Secret ]') };
  assert.equal((await runScript(a, read, opts)).result, 'hidden field');
  const write: Script = { id: 9999, name: 'Write external', fullAccess: true, steps: parse('Set Field [ BItems::Secret ; "permitted" ]') };
  try {
    assert.equal((await runScript(a, write, opts)).error, 0);
    assert.equal(b.get('Items', id).fieldData.Secret, 'permitted');
  } finally {
    b.update('Items', id, { Secret: 'hidden field' });
  }
  const session = new ScriptSession();
  assert.equal((await runScript(a, caller('QueueCallback', false, true, true), { ...opts, session })).error, 0);
  assert.equal(session.variables.get('$$callbackran')?.[0]?.value, 'ran');
});

test('elevation lifts local account limits and its cached reads cannot leak into a non-elevated subscript', async () => {
  a.applyDesign([
    { op: 'createScript', name: 'Local read', text: 'Exit Script [ Text Result: Parents::Secret ]' },
  ]);
  const script: Script = { id: 9999, name: 'Local elevation', fullAccess: true, steps: parse('Set Variable [ $full ; Value: Parents::Secret ]\nPerform Script [ Specified: By name ; "Local read" ]\nExit Script [ Text Result: $full & "|" & Get ( ScriptResult ) ]') };
  const r = await runScript(a, script, { layout: 'Parents', account: 'Reader', privileges: a.privileges('Reader') });
  assert.equal(r.result, 'local secret|');
  const write: Script = { id: 9999, name: 'Local elevated edit', fullAccess: true, steps: parse('Set Field [ Parents::Secret ; "elevated write" ]') };
  try {
    assert.equal((await runScript(a, write, { layout: 'Parents', account: 'Reader', privileges: a.privileges('Reader') })).error, 0);
    assert.equal(a.get('Parents', a.findIds('Parents')[0]).fieldData.Secret, 'elevated write');
  } finally {
    a.update('Parents', a.findIds('Parents')[0], { Secret: 'local secret' });
  }
});
