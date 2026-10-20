import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type AccessDenial } from '../../store/src/index.ts';
import type { ScriptStep } from '../../fmp12/src/index.ts';
import { runScript, scriptDenial } from '../src/index.ts';

const SECRET = 'hidden-value-sentinel';
const SUBMITTED = 'submitted-value-sentinel';
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-denial-'));
  createStore(join(dir, 'Owner.sqlite'));
  const s = new Store(join(dir, 'Owner.sqlite'), 'Owner');
  t.after(() => { s.close(); rmSync(dir, { recursive: true }); });
  s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }, { name: 'Secret' }] }]);
  const id = s.create('T', { A: 'original', Secret: SECRET }).recordId;
  s.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: 'Secret = "formula-input-sentinel"', create: true, delete: false }, layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [] });
  s.setPassword('clerk', 'pw', 'Clerk');
  const observed: AccessDenial[] = [];
  let n = 0;
  const run = async (text: string | ScriptStep[], options = {}) => {
    const name = `Run ${++n}`;
    s.applyDesign([{ op: 'createScript', name, ...(typeof text === 'string' ? { text } : { steps: text }) }]);
    return runScript(s, name, { layout: 'T', foundSet: [id], recordId: id, account: 'clerk', privileges: s.privileges('clerk'),
      trace: true, onAccessDenial: (d) => observed.push(d), ...options });
  };
  return { s, id, observed, run };
}
const refusedEdit = 'Delete Record/Request [ With dialog: Off ]';
const detail = 'Exit Script [ Text Result: Get ( LastErrorDetail ) ]';
function safe(value: unknown) {
  const json = JSON.stringify(value);
  for (const sentinel of [SECRET, SUBMITTED, 'formula-input-sentinel', 'exception-sentinel', 'policyFingerprint', 'records.edit', 'evaluation-failure', '"denial"']) assert.ok(!json.includes(sentinel), sentinel);
}

for (const capture of ['On', 'Off']) test(`Error Capture ${capture}: safe direct result and control preservation`, async (t) => {
  const { run, observed } = setup(t);
  const r = await run(`Set Error Capture [ ${capture} ]\n${refusedEdit}\nIf [ Get ( LastError ) = 200 ]\nEnd If\n${detail}`);
  assert.equal(r.error, 200); assert.match(r.result, /Clerk.*record-delete/);
  assert.equal(observed.length, 1); assert.ok(scriptDenial(r)); safe(r);
});

test('a variable carries only safe wording; a successful step clears current denial but not observation', async (t) => {
  const { run, observed } = setup(t);
  const r = await run(`${refusedEdit}\nSet Variable [ $detail ; Value: Get ( LastErrorDetail ) ]\nExit Script [ Text Result: $detail ]`);
  assert.equal(r.error, 0); assert.match(r.result, /Clerk.*record-delete/);
  assert.equal(scriptDenial(r), undefined); assert.equal(observed.length, 1); safe(r);
});

test('an unrelated later error removes stale denial; observer failure leaves execution intact', async (t) => {
  const { run } = setup(t);
  const r = await run([
    { stepId: 9, name: 'Delete Record/Request', enabled: true },
    { stepId: 6, name: 'Go to Layout', enabled: true, params: { layoutDestination: 'name', layoutCalculation: '"Absent"' } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastErrorDetail )' } },
  ], { onAccessDenial: () => { throw new Error('observer-exception-sentinel'); } });
  assert.equal(r.error, 105); assert.equal(r.result, ''); assert.equal(scriptDenial(r), undefined); safe(r);
});

for (const onServer of [false, true]) test(`${onServer ? 'awaited server' : 'ordinary'} subscript retains terminal context privately`, async (t) => {
  const { s, run, observed } = setup(t);
  s.applyDesign([{ op: 'createScript', name: 'Child', text: `${refusedEdit}\n${detail}` }]);
  const call = onServer ? 'Perform Script on Server [ “Child” ]' : 'Perform Script [ “Child” ]';
  const r = await run(`${call}\n${detail}`);
  assert.equal(r.error, 200); assert.match(r.result, /Clerk.*record-delete/); assert.ok(scriptDenial(r));
  assert.ok(observed.length >= 1); safe(r);
  const returned = await run(`${call}\nExit Script [ Text Result: Get ( ScriptResult ) ]`);
  assert.match(returned.result, /Clerk.*record-delete/); safe(returned);
});

test('automatic transaction revert preserves safe detail and leaves no writes', async (t) => {
  const { s, id, run, observed } = setup(t);
  const r = await run(`Open Transaction\n${refusedEdit}\nCommit Transaction\n${detail}`);
  assert.equal(r.error, 200); assert.match(r.result, /record-delete/); assert.ok(scriptDenial(r));
  assert.equal(s.get('T', id).fieldData.A, 'original'); assert.equal(s.undoable, false); assert.equal(observed.length, 1); safe(r);
});

test('custom transaction detail is preserved and never becomes a privilege denial', async (t) => {
  const { run, observed } = setup(t);
  const r = await run('Open Transaction\nRevert Transaction [ Condition: 1 ; Error code: 5001 ; Error message: "custom detail" ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastErrorDetail ) ]');
  assert.equal(r.error, 5001); assert.equal(r.result, 'custom detail'); assert.equal(scriptDenial(r), undefined); assert.equal(observed.length, 0);
});

test('full access bypass and final dropped commit preserve terminal behavior', async (t) => {
  const { s, id, run, observed } = setup(t);
  const edit = `Set Field [ T::A ; "${SUBMITTED}" ]`;
  const full = await run(`${edit}\nCommit Records/Requests\n${detail}`, { privileges: undefined });
  assert.equal(full.error, 0); assert.equal(observed.length, 0); assert.equal(s.get('T', id).fieldData.A, SUBMITTED);
  const dropped = await run('Set Field [ T::A ; "pending-sentinel" ]\nExit Script');
  assert.equal(dropped.error, 0); assert.equal(scriptDenial(dropped), undefined);
  assert.equal(observed.length, 1); assert.equal(s.get('T', id).fieldData.A, SUBMITTED);
});

test('Open Transaction forced commit error retains denial and skips its body', async (t) => {
  const { run, observed } = setup(t);
  const r = await run('Set Field [ T::A ; "pending" ]\nOpen Transaction\nNew Record/Request\nCommit Transaction\n' + detail);
  assert.equal(r.error, 200); assert.match(r.result, /record-edit/); assert.ok(scriptDenial(r));
  assert.ok(observed.length >= 1); safe(r);
});

test('full-access subscripts cannot commit restricted pending edits, but their own edits bypass ordinary restrictions', async (t) => {
  const { s, id, run, observed } = setup(t);
  s.applyDesign([
    { op: 'createScript', name: 'Commit', steps: [{ stepId: 75, name: 'Commit Records/Requests', enabled: true }, { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastErrorDetail )' } }] },
    { op: 'createScript', name: 'Full edit', text: 'Set Field [ T::A ; "full edit" ]\nCommit Records/Requests\nExit Script' },
  ]);
  s.schema.scripts.find((x) => x.name === 'Commit')!.fullAccess = true;
  s.schema.scripts.find((x) => x.name === 'Full edit')!.fullAccess = true;
  const denied = await run('Set Field [ T::A ; "pending edit" ]\nPerform Script [ “Commit” ]\n' + detail);
  assert.equal(denied.error, 200); assert.ok(scriptDenial(denied)); assert.match(denied.result, /record-edit/);
  assert.equal(s.get('T', id).fieldData.A, 'original'); assert.ok(observed.length >= 1);
  const count = observed.length;
  const full = await run('Perform Script [ “Full edit” ]\n' + detail);
  assert.equal(full.error, 0); assert.equal(observed.length, count); assert.equal(s.get('T', id).fieldData.A, 'full edit');
});

test('callbacks replace stale current denial with their server result and clear it on unrelated callback errors', async (t) => {
  const { s, run } = setup(t);
  s.applyDesign([
    { op: 'createScript', name: 'Server OK', text: 'Exit Script [ Text Result: "ok" ]' },
    { op: 'createScript', name: 'Callback', text: detail },
  ]);
  const server = s.schema.scripts.find((x) => x.name === 'Server OK')!;
  const callback = s.schema.scripts.find((x) => x.name === 'Callback')!;
  const steps: ScriptStep[] = [
    { stepId: 9, name: 'Delete Record/Request', enabled: true },
    { stepId: 210, name: 'Perform Script on Server with Callback', enabled: true, params: { script: { id: server.id, name: server.name }, callback: { script: { id: callback.id, name: callback.name } } } },
    { stepId: 103, name: 'Exit Script', enabled: true },
  ];
  const r = await run(steps);
  assert.equal(r.error, 0); assert.equal(scriptDenial(r), undefined);
  const deniedServer = await run(steps, { skip: (name: string) => name === 'Server OK' });
  assert.equal(deniedServer.error, 3); assert.equal(scriptDenial(deniedServer), undefined);
});

test('untagged numeric privilege-like errors are never inferred as denials', async (t) => {
  const { run, observed } = setup(t);
  const r = await run([
    { stepId: 9, name: 'Delete Record/Request', enabled: true },
    { stepId: 160, name: 'Insert from URL', enabled: true, params: { variable: '$r', calculation: '"https://example.invalid"' } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastErrorDetail )' } },
  ]);
  assert.equal(r.error, 3); assert.equal(r.result, ''); assert.equal(scriptDenial(r), undefined); assert.equal(observed.length, 1);
});

test('cross-file denial survives automatic rollback and is audited in its captured owning file', async (t) => {
  const { s, id, run } = setup(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cross-denial-'));
  createStore(join(dir, 'Other.sqlite'));
  const other = new Store(join(dir, 'Other.sqlite'), 'Other');
  t.after(() => { other.close(); rmSync(dir, { recursive: true }); });
  other.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }, { op: 'createScript', name: 'Child', text: 'Delete Record/Request [ With dialog: Off ]\n' + detail }]);
  const rid = other.create('T', { A: 'related-record-sentinel' }).recordId;
  other.savePrivilegeSet({ name: 'Owner Rules', records: { view: true, edit: true, create: true, delete: false }, layouts: 'modifiable', scripts: 'viewOnly', valueLists: 'none', extendedPrivileges: [] });
  other.setPassword('clerk', 'pw', 'Owner Rules');
  s.applyDesign([{ op: 'createDataSource', name: 'Other', paths: ['file:Other'] }]);
  s.resolveFile = (name) => name === 'Other' ? other : undefined;
  const source = s.schema.dataSources.find((x) => x.name === 'Other')!;
  const child = other.schema.scripts.find((x) => x.name === 'Child')!;
  let first: AccessDenial | undefined;
  const r = await run([
    { stepId: 205, name: 'Open Transaction', enabled: true },
    { stepId: 7, name: 'New Record/Request', enabled: true },
    { stepId: 1, name: 'Perform Script', enabled: true, params: { script: { id: child.id, name: child.name, file: { id: source.id, name: source.name } } } },
    { stepId: 206, name: 'Commit Transaction', enabled: true },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastErrorDetail )' } },
  ], { onAccessDenial: (d: AccessDenial) => { first ??= d; } });
  assert.equal(r.error, 200); assert.match(r.result, /Owner Rules.*record-delete/); assert.equal(scriptDenial(r), first);
  assert.equal(s.findIds('T').length, 1); assert.equal(s.get('T', id).fieldData.A, 'original'); assert.equal(other.get('T', rid).fieldData.A, 'related-record-sentinel');
  assert.ok(first); const audit = { code: 200, surface: 'web' as const, identifier: 'script', origin: 'script' as const, capturedAt: new Date().toISOString() };
  s.recordPrivilegeDenied(first, audit); other.recordPrivilegeDenied(first, audit);
  assert.equal(s.securityEvents({ kind: 'privilege-denied' }).length, 0); assert.equal(other.securityEvents({ kind: 'privilege-denied' }).length, 1);
  assert.ok(!JSON.stringify(other.securityEvents({ kind: 'privilege-denied' })).includes('related-record-sentinel'));
});

for (const code of [9, 200, 201]) test(`generic code ${code} has no privilege explanation or observation`, async (t) => {
  const { s, run, observed } = setup(t);
  const { StoreError } = await import('../../store/src/index.ts');
  t.mock.method(s, 'delete', () => { throw new StoreError(code, 'Generic refusal'); });
  const r = await run(refusedEdit + '\n' + detail);
  assert.equal(r.error, code); assert.equal(r.result, ''); assert.equal(scriptDenial(r), undefined); assert.equal(observed.length, 0);
});
