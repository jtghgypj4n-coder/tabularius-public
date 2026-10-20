import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stepLine, type Script } from '@tabularius/fmp12';
import { createStore, hashPassword, importFmp12, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'DEMO_drawers.fmp12')) && existsSync(join(fixtures, 'InterMediator_TestDB.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let drawers: Store;
let im: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(join(fixtures, 'DEMO_drawers.fmp12'), join(dir, 'Drawers.sqlite'));
  importFmp12(join(fixtures, 'InterMediator_TestDB.fmp12'), join(dir, 'IM.sqlite'));
  drawers = new Store(join(dir, 'Drawers.sqlite'));
  im = new Store(join(dir, 'IM.sqlite'));
});
after(() => {
  drawers?.close();
  im?.close();
  if (dir) rmSync(dir, { recursive: true });
});

function script(store: Store, text: string, fullAccess = false): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps, ...(fullAccess ? { fullAccess } : {}) } as Script;
}

test('account steps: reset a password, deactivate and activate, delete', { skip }, async () => {
  drawers.setPassword('clerk', 'old', '[Full Access]');
  const r = await runScript(drawers, script(drawers, `
    Set Error Capture [ On ]
    Reset Account Password [ Account Name: "clerk" ; New Password: "new" ; Expire password ]
    Enable Account [ Account Name: "clerk" ; Deactivate ]
    Set Variable [ $off ; Value: Get ( LastError ) ]
    Delete Account [ Account Name: "nobody" ]
    Exit Script [ Result: $off & "|" & Get ( LastError ) ]
  `), { layout: 'RECORD' });
  assert.equal(r.result, '0|213');
  assert.equal(drawers.verify('clerk', 'new'), false, 'an inactive account cannot sign in');
  assert.equal(drawers.accounts().find((a) => a.name === 'clerk')?.inactive, true);
  await runScript(drawers, script(drawers, 'Enable Account [ Account Name: "clerk" ; Activate ]'), { layout: 'RECORD' });
  assert.equal(drawers.verify('clerk', 'new'), true);
  assert.equal(drawers.verify('clerk', 'old'), false);
  await runScript(drawers, script(drawers, 'Delete Account [ Account Name: "CLERK" ]'), { layout: 'RECORD' });
  assert.equal(drawers.accounts().some((a) => a.name === 'clerk'), false);
});

test('account steps need full access, or a script that runs with it', { skip }, async () => {
  drawers.setPassword('reader', 'pw', '[Read-Only Access]');
  drawers.setPassword('target', 'pw', '[Read-Only Access]');
  const privileges = drawers.privileges('reader');
  const text = 'Set Error Capture [ On ]\nDelete Account [ Account Name: "target" ]';
  const limited = await runScript(drawers, script(drawers, text), { layout: 'RECORD', account: 'reader', privileges });
  assert.equal(limited.error, 9);
  assert.ok(drawers.accounts().some((a) => a.name === 'target'));
  const elevated = await runScript(drawers, script(drawers, text, true), { layout: 'RECORD', account: 'reader', privileges });
  assert.equal(elevated.error, 0);
  assert.equal(drawers.accounts().some((a) => a.name === 'target'), false);
});

test('Re-Login switches the account the run uses; a wrong password keeps the old one', { skip }, async () => {
  drawers.setPassword('viewer', 'pw', '[Read-Only Access]');
  const r = await runScript(drawers, script(drawers, `
    Set Error Capture [ On ]
    Re-Login [ Account Name: "viewer" ; Password: "wrong" ; With dialog: Off ]
    Set Variable [ $bad ; Value: Get ( LastError ) & " " & Get ( AccountName ) ]
    Re-Login [ Account Name: "viewer" ; Password: "pw" ; With dialog: Off ]
    Exit Script [ Result: $bad & "|" & Get ( LastError ) & " " & Get ( AccountName ) & " " & Get ( AccountPrivilegeSetName ) ]
  `), { layout: 'RECORD', account: 'Admin', privileges: drawers.privileges('Admin') });
  assert.equal(r.result, '212 Admin|0 viewer [Read-Only Access]');
});

test('Set Next Serial Value sets what the next new record gets', { skip }, async () => {
  const r = await runScript(im, script(im, `
    Set Next Serial Value [ person::id ; 500 ]
    New Record/Request
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Result: person_to::id ]
  `), { layout: 'person_layout' });
  assert.equal(r.error, 0);
  assert.equal(r.result, '500');
});

test('design dialog steps ask the client to open the Design screen', { skip }, async () => {
  const r = await runScript(drawers, script(drawers, 'Open Manage Database\nOpen Script Workspace\nOpen Manage Containers\nOpen Edit Saved Finds\nSet Multi-User [ On ]'), { layout: 'RECORD' });
  assert.equal(r.error, 0);
  assert.deepEqual(r.actions.map((a) => a.open), ['design.html#tables', 'design.html#scripts', 'design.html#containers', 'saved-finds']);
});

test('account steps read back as FileMaker shows them', () => {
  assert.equal(stepLine('Reset Account Password', { accountName: '$a', password: '$p', expirePassword: true }),
    'Reset Account Password [ Account Name: $a ; New Password: $p ; Expire password ]');
  assert.equal(stepLine('Enable Account', { accountName: '"x"', activate: false }), 'Enable Account [ Account Name: "x" ; Deactivate ]');
  assert.equal(stepLine('Re-Login', { accountName: '$a', password: '$p', noDialog: true }), 'Re-Login [ Account Name: $a ; Password: $p ; With dialog: Off ]');
});

test('script account steps cannot delete or deactivate the last active Full Access account', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-script-account-guard-'));
  const path = join(folder, 'Local.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }]);
    store.setPassword('Admin', 'pw', '[Full Access]');
    store.createLocalAccount('Placeholder', '[Full Access]', true);
    store.setPassword('InactiveAdmin', 'other', '[Full Access]');
    store.setAccountActive('InactiveAdmin', false);
    store.setPassword('MfaBackup', 'backup', '[Full Access]');
    store.setAccountRequire2fa('MfaBackup', true);
    store.createLocalAccount('Backup', '[Full Access]', true);
    store.sql.prepare("INSERT INTO _fm_accounts (name, source, password_hash, privilege_set) VALUES ('BACKUP', 'openhbam', ?, '[Full Access]')").run(hashPassword('other'));
    for (const operation of ['Enable Account [ Account Name: "Admin" ; Deactivate ]', 'Delete Account [ Account Name: "Admin" ]']) {
      const result = await runScript(store, script(store, `Set Error Capture [ On ]\n${operation}\nExit Script [ Result: Get ( LastError ) ]`), { layout: 'People' });
      assert.equal(result.result, '960');
      assert.equal(store.accountInactive('Admin'), false);
      assert.equal(store.verify('Admin', 'pw', ''), true);
    }
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
