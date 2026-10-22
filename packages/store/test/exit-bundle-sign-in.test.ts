// Who may take a full copy of a file: a Full Access account that signs in again, by the ordinary sign-in rules.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, exitBundle, ExitBundleError, LOCKOUT, Store, totpCode } from '../src/index.ts';

const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');
const READER_PASSWORD = ['another', 'long', 'enough', 'phrase'].join(' ');
const REMOTE = '203.0.113.5';
let dir: string;
let store: Store;
let n = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-exit-sign-in-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  store = new Store(join(dir, 'Shop.openhbam.sqlite'), 'Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  store.setPassword('Admin', PASSWORD);
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.createAccount('reader', READER_PASSWORD, 'Reader');
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const out = () => join(dir, `copy-${++n}`);
const refused = () => store.securityEvents({ kind: 'data-export-refused' });
const exported = () => store.securityEvents({ kind: 'data-exported' });
const rejection = (status: number, text?: RegExp) => (e: unknown) => e instanceof ExitBundleError && e.status === status && (!text || text.test(e.message));

test('a Reader is refused, even with the right password, and the refusal is audited once', async () => {
  const target = out();
  await assert.rejects(exitBundle(store, target, { account: 'reader', password: READER_PASSWORD, from: '' }), rejection(403));
  assert.equal(refused().length, 1);
  assert.equal(exported().length, 0);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(`${target}.partial`), false);
});

test('a wrong password is audited as a failed sign-in and as a refusal', async () => {
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: 'not the password', from: '' }), rejection(403));
  assert.equal(refused().length, 1);
  assert.equal(store.securityEvents({ kind: 'sign-in-failed' }).length, 1);
});

test('an unknown account is refused and audited', async () => {
  await assert.rejects(exitBundle(store, out(), { account: 'nobody', password: PASSWORD, from: '' }), rejection(403));
  assert.equal(refused().length, 1);
  assert.equal(refused()[0].account, 'nobody');
  await assert.rejects(exitBundle(store, out(), { account: '', password: '', from: '' }), rejection(403));
  assert.equal(refused().length, 2);
});

test('a remote address is refused for an account with a second factor, one that requires it, or a file that requires it; the command line is not', async () => {
  const confirm = (account: string) => store.confirmTotp(account, totpCode(store.enrollTotp(account).secret));
  assert.equal(confirm('Admin'), true);
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: REMOTE }), rejection(403, /second factor/));
  assert.equal(refused().length, 1);
  assert.match(String(refused()[0].description), /second factor/);
  const report = await exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: '' });
  assert.equal(report.tables, 1);
  assert.equal(exported().length, 1);

});

test('an account that requires a second factor, and a file that requires it for Full Access, are refused from a remote address', async () => {
  store.setAccountRequire2fa('Admin', true);
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: REMOTE }), rejection(403, /second factor/));
  store.setAccountRequire2fa('Admin', false);
  (store as unknown as { sql: { exec(s: string): void } }).sql.exec("INSERT INTO _fm_meta VALUES ('requireTotpForFullAccess', 'true') ON CONFLICT(key) DO UPDATE SET json = excluded.json");
  assert.equal(store.requireTotpForFullAccess(), true);
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: REMOTE }), rejection(403, /second factor/));
  assert.equal(refused().length, 2);
  assert.equal((await exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: '' })).tables, 1);
});

test('wrong passwords from a remote address lock out that address and leave the command line alone', async () => {
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: 'wrong guess', from: REMOTE }), rejection(403));
  }
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: REMOTE }), rejection(403));
  assert.ok(store.lockedOut('Admin', REMOTE));
  assert.equal(store.lockedOut('Admin', ''), undefined);
  assert.equal((await exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: '' })).tables, 1);
});

test('an account that must change its password, or may not sign in from this address, is refused', async () => {
  store.setMustChangePassword('Admin', true);
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: '' }), rejection(403, /change its password/));
  store.setMustChangePassword('Admin', false);
  store.setAccountLocalOnly('Admin', true);
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: REMOTE }), rejection(403, /may not sign in from this address/));
  assert.equal(refused().length, 2);
});

test('the log never holds the password or a field value', async () => {
  const sql = (store as unknown as { sql: { prepare(s: string): { run(...a: unknown[]): unknown } } }).sql;
  sql.prepare('INSERT INTO Items (Name) VALUES (?)').run('a secret field value');
  await assert.rejects(exitBundle(store, out(), { account: 'Admin', password: 'wrong guess 12345', from: '' }), rejection(403));
  await exitBundle(store, out(), { account: 'Admin', password: PASSWORD, from: '' });
  const log = JSON.stringify(store.auditLog({ limit: 1000 }));
  for (const secret of [PASSWORD, READER_PASSWORD, 'wrong guess 12345', 'a secret field value']) assert.ok(!log.includes(secret), secret);
  assert.equal(exported().length, 1);
  assert.equal(refused().length, 1);
});
