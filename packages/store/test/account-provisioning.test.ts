import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from './forge-webauthn.ts';
import { planAccountImport } from '../src/account-provisioning.ts';
import { Worker } from 'node:worker_threads';
import { createStore, Store, hashPassword, totpCode, parseDelimited, parseAccountCsv, accountKey } from '../src/index.ts';
import { expiryClock, ExpiryClock } from '../src/clock.ts';

const header = 'account,privilegeSet,active\n';
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-account-import-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  const full = store.privilegeSets().find((p) => p.id === 1)!.name;
  store.setPassword('Admin', 'admin-secret', full);
  for (const name of ['Staff', 'Reader']) store.savePrivilegeSet({ name, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  return { store, path, full, done() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const apply = (s: Store, csv: string, key: string) => {
  const preview = s.previewAccountImport(csv, 'Admin');
  assert.equal(preview.valid, true, JSON.stringify(preview.errors));
  return s.applyAccountImport(csv, 'Admin', preview.previewToken!, key);
};

test('strict shared CSV parser handles BOM, CRLF, quoted commas, quotes and newlines', () => {
  assert.deepEqual(parseDelimited('\ufeffaccount,privilegeSet,active\r\n"a,b",Staff,true\r\n"a""b",Reader,false\r\n"a\nb",Staff,true', ',', true), [
    ['account', 'privilegeSet', 'active'], ['a,b', 'Staff', 'true'], ['a"b', 'Reader', 'false'], ['a\nb', 'Staff', 'true'],
  ]);
  assert.equal(parseAccountCsv('\ufeffactive,account,privilegeSet\r\ntrue,"a,b",Staff')[0].account, 'a,b');
  for (const csv of ['"bad', 'a"b,c,d', '"a"junk,b,c', '"""', '"a""']) assert.throws(() => parseDelimited(csv, ',', true));
  // Existing script imports keep their tolerant mode.
  assert.deepEqual(parseDelimited('"unclosed', ','), [['unclosed']]);
});

test('CSV accepts exactly the desired-state columns and explicit booleans, with bounded input', () => {
  for (const csv of ['account,password,active\na,secret,true', 'account,account,active\na,b,true', 'account,privilegeSet,active,unknown\na,Staff,true,x', header + 'a,Staff,1', header + 'a,Staff,TRUE', header + 'a,Staff,true,extra', header, header + '"unclosed,Staff,true']) assert.throws(() => parseAccountCsv(csv));
  assert.throws(() => parseAccountCsv(header + 'x'.repeat(1024 * 1024)), /upload-too-large/);
  assert.throws(() => parseAccountCsv(header + 'a,Staff,true\n'.repeat(1001)), /too-many-rows/);
});

test('CSV rejects unsafe privilege-set names even when the set already exists', () => {
  const f = fresh();
  try {
    const legacy = { ...f.store.privilegeSets().find((p) => p.name === 'Staff')!, name: '\t=1+1' };
    f.store.sql.prepare('INSERT INTO _fm_privileges (name, json) VALUES (?, ?)').run(legacy.name, JSON.stringify(legacy));
    const preview = f.store.previewAccountImport(header + 'Someone,"\t=1+1",true', 'Admin');
    assert.equal(preview.valid, false);
    assert.ok(preview.errors.some((e) => e.code === 'invalid-privilege-set'));
    assert.equal(f.store.accounts().some((a) => a.name === 'Someone'), false);
    for (const name of ['=danger', '+danger', '-danger', '@danger', ' name', 'name ', 'x\rname', 'x\u0085name']) {
      assert.throws(() => f.store.savePrivilegeSet({ name, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] }));
    }
    assert.doesNotThrow(() => f.store.savePrivilegeSet({ name: 'Café', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] }));
  } finally { f.done(); }
});

test('CSV rejects NFC-equivalent account names within the whole batch and against stored names', () => {
  const f = fresh();
  try {
    const batch = f.store.previewAccountImport(header + 'é,Staff,true\né,Staff,true', 'Admin');
    assert.equal(batch.valid, false);
    assert.equal(batch.errors.filter((e) => e.code === 'ambiguous-unicode-account').length, 2);
    f.store.setPassword('é', 'safe-password', 'Staff');
    const alias = f.store.previewAccountImport(header + 'é,Staff,true', 'Admin');
    assert.equal(alias.valid, false);
    assert.ok(alias.errors.some((e) => e.code === 'ambiguous-unicode-account'));
    assert.equal(f.store.accountPrivilegeSet('é'), 'Staff');
  } finally { f.done(); }
});

test('preview and apply agree; create, update, deactivate and reactivate preserve existing credentials', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.setPassword('Alice', 'existing-secret', 'Reader', { mustChange: true });
    s.setPassword('Bob', 'bob-secret', 'Staff');
    s.setAccountActive('Bob', false);
    const csv = header + 'alice,Staff,false\nbob,Reader,true\n"new,\"\"user",Staff,true';
    const before = s.accounts();
    const auditBefore = s.auditLog({ security: true }).length;
    const writesBefore = s.sql.prepare('SELECT total_changes() AS n').get()!.n;
    const preview = s.previewAccountImport(csv, 'Admin');
    assert.equal(preview.valid, true);
    assert.equal(s.sql.prepare('SELECT total_changes() AS n').get()!.n, writesBefore, 'dry-run performs no database writes');
    assert.deepEqual(preview.rows.map((r) => r.actions), [['update', 'deactivate'], ['update', 'reactivate'], ['create']]);
    assert.deepEqual(s.accounts(), before, 'dry-run makes no account changes');
    assert.equal(s.auditLog({ security: true }).length, auditBefore, 'dry-run writes no events');
    const result = s.applyAccountImport(csv, 'Admin', preview.previewToken!, 'first');
    assert.deepEqual(result.rows, preview.rows);
    assert.deepEqual(result.errors, []);
    assert.equal(s.accountPrivilegeSet('Alice'), 'Staff');
    assert.equal(s.accountInactive('Alice'), true);
    assert.equal(s.verify('Bob', 'bob-secret', ''), true);
    s.setAccountActive('Alice', true);
    assert.equal(s.verify('Alice', 'existing-secret', ''), true);
    assert.equal(s.mustChangePassword('Alice'), true);
    const created = s.accounts().find((a) => a.name === 'new,"user')!;
    assert.equal(created.hasPassword, false);
    assert.equal(created.mustChange, true);
    assert.equal(s.verify(created.name, '', ''), false);
    const serialized = JSON.stringify([preview, result, s.auditLog({ security: true })]);
    for (const secret of ['existing-secret', 'bob-secret', 'admin-secret', 'password_hash', 'previewToken":"ohbt_']) assert.ok(!serialized.includes(secret));
    const events = s.auditLog({ security: true }).filter((e) => (e.changes as { batchId?: string })?.batchId === result.batchId);
    assert.ok(events.length > 3);
    assert.ok(events.every((e) => e.account === 'Admin'));
    const assigned = events.find((e) => e.target === 'Alice' && e.kind === 'privilege-set-assigned')!;
    assert.deepEqual((assigned.changes as { before: unknown }).before, { privilegeSet: 'Reader', active: true });
  } finally { f.done(); }
});

test('receipts survive reopening; key conflicts fail; reimporting unchanged desired state has no duplicate account events', () => {
  const f = fresh();
  try {
    const csv = header + 'New,Staff,false';
    const preview = f.store.previewAccountImport(csv, 'Admin');
    const first = f.store.applyAccountImport(csv, 'Admin', preview.previewToken!, 'retry');
    const count = f.store.auditLog({ security: true }).length;
    const second = new Store(f.path, 'Local');
    try {
      assert.deepEqual(second.applyAccountImport(csv, 'Admin', 'expired-or-lost-preview', 'retry'), first);
      assert.deepEqual(second.applyAccountImport('\ufeffactive,privilegeSet,account\r\nfalse,Staff,New\r\n', 'Admin', '', 'retry'), first, 'header order and line endings normalize before the input digest');
      assert.equal(second.auditLog({ security: true }).length, count);
      assert.throws(() => second.applyAccountImport(header + 'Other,Staff,true', 'Admin', preview.previewToken!, 'retry'), /idempotency-conflict/);
      const again = apply(second, csv, 'again');
      assert.deepEqual(again.rows[0].actions, ['no-op']);
      assert.equal(second.auditLog({ kind: 'account-added', security: true }).filter((e) => e.target === 'New').length, 1);
    } finally { second.close(); }
  } finally { f.done(); }
});

test('bad rows block the entire batch; a mutation failure rolls back accounts, receipt and successful events', () => {
  const f = fresh();
  try {
    const s = f.store;
    const bad = s.previewAccountImport(header + 'Good,Staff,true\nBad,Unknown,false', 'Admin');
    assert.equal(bad.valid, false);
    assert.deepEqual(bad.errors, [{ row: 3, code: 'unknown-privilege-set' }]);
    assert.throws(() => s.applyAccountImport(header + 'Good,Staff,true\nBad,Unknown,false', 'Admin', '', 'bad'));
    assert.equal(s.accounts().some((a) => a.name === 'Good'), false);
    const csv = header + 'Good,Staff,true\nBad,Staff,true';
    const preview = s.previewAccountImport(csv, 'Admin');
    const before = s.auditLog({ security: true }).length;
    const chainBefore = s.verifySecurityAudit();
    assert.equal(chainBefore.ok, true);
    s.sql.exec(`CREATE TRIGGER fail_bad BEFORE INSERT ON _fm_accounts WHEN NEW.name = 'Bad'
      BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
    assert.throws(() => s.applyAccountImport(csv, 'Admin', preview.previewToken!, 'rollback'), /forced failure/);
    assert.equal(s.accounts().some((a) => a.name === 'Good'), false);
    assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM _fm_account_import_receipts WHERE key = ?').get('rollback')!.n, 0);
    const events = s.auditLog({ security: true });
    assert.equal(events.length, before + 1);
    assert.equal(events.at(-1)!.kind, 'accounts-import-rejected');
    assert.equal((events.at(-1)!.changes as { reason: string }).reason, 'mutation-failed');
    const chainAfter = s.verifySecurityAudit();
    assert.equal(chainAfter.ok, true, 'rolled-back rows leave a valid security chain');
    assert.equal(chainAfter.checked, chainBefore.checked + 1, 'only the rejection event advances the chain');
    s.sql.exec('DROP TRIGGER fail_bad');
    s.applyAccountImport(csv, 'Admin', preview.previewToken!, 'rollback');
    assert.equal(s.verifySecurityAudit().ok, true, 'retry commits accounts and security events together');
  } finally { f.done(); }
});

test('planner rejects self, reserved, external, agent, duplicate, ambiguous and injection names and Full Access grants', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.setExternalAccount('external', 'Staff');
    s.setAgentAccount('agent', 'Staff');
    s.schema.accounts.push({ id: 987, name: 'RemovedExternal', external: true });
    assert.ok(s.previewAccountImport(header + 'RemovedExternal,Staff,true', 'Admin').errors.some((e) => e.code === 'non-local-account'));
    assert.throws(() => s.createLocalAccount('RemovedExternal', 'Staff', true), /non-local-account/);
    for (const [row, code] of [
      ['admin,Staff,true', 'self-account'], ['[Guest],Staff,true', 'reserved-account'], ['external,Staff,true', 'non-local-account'], ['agent,Staff,true', 'non-local-account'], ['other,[Full Access],true', 'full-access-grant'],
      ['=SUM(1),Staff,true', 'invalid-account-name'], ['+formula,Staff,true', 'invalid-account-name'], ['-formula,Staff,true', 'invalid-account-name'], ['@domain,Staff,true', 'invalid-account-name'], [' name,Staff,true', 'invalid-account-name'], ['"name\nnext",Staff,true', 'invalid-account-name'],
      ['x,Staff,true\nX,Reader,false', 'duplicate-account'], ['é,Staff,true\nÉ,Staff,true', 'ambiguous-unicode-account'],
    ]) assert.ok(s.previewAccountImport(header + row, 'Admin').errors.some((e) => e.code === code), code);
    assert.ok(s.previewAccountImport(header + '\ud800,Staff,true', 'Admin').errors.some((e) => e.code === 'invalid-account-name'));
    assert.equal(accountKey('ÉA'), 'Éa');
    assert.equal('É'.toLowerCase(), 'é');
    assert.equal(s.sql.prepare("SELECT 'É' = 'é' COLLATE NOCASE AS equal").get()!.equal, 0);
    assert.equal(s.sql.prepare("SELECT 'A' = 'a' COLLATE NOCASE AS equal").get()!.equal, 1);
    s.sql.prepare("INSERT INTO _fm_accounts (name, source, privilege_set) VALUES ('foreign', 'unsupported', 'Staff')").run();
    assert.ok(s.previewAccountImport(header + 'foreign,Staff,true', 'Admin').errors.some((e) => e.code === 'non-local-account'));
    s.setPassword('Case', 'pw', 'Staff');
    s.sql.prepare("INSERT INTO _fm_accounts (name, source, privilege_set) VALUES ('case', 'openhbam', 'Staff')").run();
    assert.ok(s.previewAccountImport(header + 'CASE,Staff,true', 'Admin').errors.some((e) => e.code === 'ambiguous-existing-account'));
    s.sql.prepare("INSERT INTO _fm_accounts (name, source, privilege_set) VALUES ('É', 'openhbam', 'Staff')").run();
    assert.ok(s.previewAccountImport(header + 'é,Staff,true', 'Admin').errors.some((e) => e.code === 'ambiguous-unicode-account'));
  } finally { f.done(); }
});

test('stale, expired, altered, wrong-actor and wrong-database preview bindings fail', (t) => {
  // This test moves wall time forward: isolate its high-water mark from later tests.
  const clock = new ExpiryClock();
  t.mock.method(expiryClock, 'now', () => clock.now());
  const f = fresh();
  try {
    const s = f.store;
    const csv = header + 'New,Staff,true';
    const preview = s.previewAccountImport(csv, 'Admin').previewToken!;
    s.setPassword('OtherAdmin', 'pw', f.full);
    assert.throws(() => s.applyAccountImport(csv, 'OtherAdmin', preview, 'actor'), /stale-or-changed-preview/);
    assert.throws(() => s.applyAccountImport(csv, 'Admin', preview, 'stale'), /stale-or-changed-preview/);
    const latest = s.previewAccountImport(csv, 'Admin').previewToken!;
    assert.throws(() => s.applyAccountImport(header + 'Changed,Staff,true', 'Admin', latest, 'changed'), /stale-or-changed-preview/);
    assert.throws(() => s.applyAccountImport(csv, 'Admin', latest + 'x', 'altered'), /invalid-preview/);
    const other = new Store(f.path, 'AnotherDatabase');
    try { assert.throws(() => other.applyAccountImport(csv, 'Admin', latest, 'database'), /stale-or-changed-preview/); }
    finally { other.close(); }
    const original = Date.now;
    try {
      Date.now = () => original() + 6 * 60_000;
      assert.throws(() => s.applyAccountImport(csv, 'Admin', latest, 'expired'), /stale-or-changed-preview/);
    } finally { Date.now = original; }
  } finally { f.done(); }
});

test('delete, demote, deactivate and password+assignment callers share the active credential-bearing Full Access guard', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.createLocalAccount('Placeholder', f.full, true);
    s.setPassword('InactiveAdmin', 'pw', f.full);
    s.setAccountActive('InactiveAdmin', false);
    for (const run of [() => s.deleteAccount('Admin'), () => s.setAccountActive('Admin', false), () => s.setAccountPrivilegeSet('Admin', 'Staff'), () => s.setPassword('Admin', 'changed', 'Staff')]) assert.throws(run, /last account with full access/);
    assert.equal(s.verify('Admin', 'admin-secret', ''), true);
    s.schema.accounts.push({ id: 321, name: 'UnusableImported', passwordVerifier: '01' + '00'.repeat(30) });
    s.sql.prepare("INSERT INTO _fm_accounts (name, source, privilege_set) VALUES ('UnusableImported', 'fmp12', ?)").run(f.full);
    assert.throws(() => s.setAccountActive('Admin', false), /last account with full access/, 'an unusable imported verifier is not a way back in');
    s.setPassword('Second', 'pw', f.full);
    s.setAccountPrivilegeSet('Second', 'Staff');
    assert.throws(() => s.setAccountActive('Admin', false), /last account with full access/);
    s.setAccountPrivilegeSet('Second', f.full);
    assert.throws(() => s.applySecurity([{ op: 'setAccount', name: 'Admin', privilegeSet: 'Staff' }, { op: 'setAccount', name: 'Second', privilegeSet: 'Staff' }]), /last account with full access/);
    assert.equal(s.accountPrivilegeSet('Admin'), f.full);
    assert.equal(s.accountPrivilegeSet('Second'), f.full);
    apply(s, header + 'Second,Staff,false', 'demotion');
    assert.equal(s.accountInactive('Second'), true);
    assert.equal(s.accountPrivilegeSet('Second'), 'Staff');
    s.setMustChangePassword('Admin', true);
    assert.throws(() => s.previewAccountImport(header + 'new,Staff,true', 'Admin'), /requires-current-full-access/);
  } finally { f.done(); }
});

test('two processes cannot each deactivate the other remaining administrator', async () => {
  const f = fresh();
  try {
    f.store.setPassword('Second', 'pw', f.full);
    const moduleUrl = new URL('../src/index.ts', import.meta.url).href;
    const run = (account: string) => new Promise<string>((resolve, reject) => {
      const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
        import(workerData.moduleUrl).then(({ Store }) => {
          const store = new Store(workerData.path, 'Local');
          parentPort.postMessage('ready');
          parentPort.once('message', () => {
            try { store.setAccountActive(workerData.account, false); parentPort.postMessage('changed'); }
            catch (e) { parentPort.postMessage(e.message); }
            finally { store.close(); }
          });
        }).catch((e) => { throw e; });`, { eval: true, workerData: { moduleUrl, path: f.path, account } });
      worker.on('error', reject);
      worker.on('message', (message) => {
        if (message === 'ready') worker.postMessage('go');
        else resolve(message);
      });
    });
    const results = await Promise.all([run('Admin'), run('Second')]);
    assert.equal(results.filter((r) => r === 'changed').length, 1);
    assert.ok(results.some((r) => /last account with full access/.test(r)));
    assert.equal(f.store.accounts().filter((a) => !a.inactive && a.privilegeSet === f.full).length, 1);
  } finally { f.done(); }
});

test('CSV may retain an existing Full Access assignment but cannot grant one; external actors cannot remove the last local administrator', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.setPassword('Second', 'second-secret', f.full);
    const before = s.previewAccountImport(header + `Second,${f.full},true`, 'Admin');
    assert.equal(before.valid, true);
    assert.deepEqual(before.rows[0].actions, ['no-op']);
    apply(s, header + `Second,${f.full},false`, 'disable-full');
    assert.equal(s.accountInactive('Second'), true);
    assert.equal(s.accountPrivilegeSet('Second'), f.full);
    apply(s, header + `Second,${f.full},true`, 'enable-full');
    assert.equal(s.accountInactive('Second'), false);
    s.setAccountActive('Second', false);
    s.setExternalAccount('Owners', f.full);
    const last = s.previewAccountImport(header + 'Admin,Staff,false', 'person@example.test', 'Owners');
    assert.equal(last.valid, false);
    assert.ok(last.errors.some((e) => e.code === 'last-full-access'));
    const transition = header + `Admin,Staff,false\nSecond,${f.full},true`;
    const transitionPreview = s.previewAccountImport(transition, 'person@example.test', 'Owners');
    assert.equal(transitionPreview.valid, true, 'the final batch state retains a credential-bearing administrator');
    const transitionResult = s.applyAccountImport(transition, 'person@example.test', transitionPreview.previewToken!, 'handoff', 'Owners');
    assert.deepEqual(transitionResult.rows, transitionPreview.rows, 'CSV order does not change the final-state plan');
    assert.equal(s.accountInactive('Admin'), true);
    assert.equal(s.accountInactive('Second'), false);
    const mapping = s.previewAccountImport(header + `Owners,${f.full},true`, 'person@example.test', 'Owners');
    assert.ok(mapping.errors.some((e) => e.code === 'self-account'));
  } finally { f.done(); }
});

test('imported FileMaker local credentials and must-change are preserved without conversion', () => {
  const f = fresh();
  try {
    const s = f.store;
    const salt = Buffer.alloc(10, 7);
    const verifier = Buffer.concat([Buffer.from([1]), salt, pbkdf2Sync(Buffer.alloc(0), salt, 1, 20, 'sha1')]).toString('hex');
    s.schema.accounts.push({ id: 123, name: 'Imported', passwordVerifier: verifier });
    s.sql.prepare("INSERT INTO _fm_accounts (name, source, password_hash, privilege_set, must_change) VALUES ('Imported', 'fmp12', NULL, 'Reader', 1)").run();
    assert.equal(s.verify('Imported', '', ''), true);
    const result = apply(s, header + 'imported,Staff,false', 'imported-local');
    assert.equal(result.rows[0].credentialSetupRequired, false);
    assert.equal(s.sql.prepare("SELECT source FROM _fm_accounts WHERE name = 'Imported'").get()!.source, 'fmp12');
    assert.equal(s.schema.accounts.find((a) => a.name === 'Imported')!.passwordVerifier, verifier);
    assert.equal(s.mustChangePassword('Imported'), true);
    apply(s, header + 'Imported,Staff,true', 'imported-enabled');
    assert.equal(s.verify('Imported', '', ''), true);
    assert.ok(!JSON.stringify([result, s.auditLog({ security: true })]).includes(verifier));
  } finally { f.done(); }
});

test('CSV deactivation blocks passkey assertions and reactivation preserves the passkey', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.setPassword('PasskeyUser', 'passkey-secret', 'Staff');
    const rpId = 'host.example', origin = 'https://host.example';
    const auth = makeAuthenticator(rpId, origin);
    const registration = s.issueWebauthnChallenge('register', 'PasskeyUser');
    s.registerPasskey('PasskeyUser', forgeRegistration(auth, registration), { rpId, origin, challenge: registration });
    apply(s, header + 'PasskeyUser,Staff,false', 'passkey-off');
    const challenge = s.issueWebauthnChallenge('auth');
    assert.throws(() => s.verifyPasskeyAssertion(forgeAssertion(auth, challenge, 1), { rpId, origin, challenge }), /passkey was not accepted/);
    assert.equal(s.hasPasskey('PasskeyUser'), true);
    apply(s, header + 'PasskeyUser,Staff,true', 'passkey-on');
    const enabled = s.issueWebauthnChallenge('auth');
    assert.equal(s.verifyPasskeyAssertion(forgeAssertion(auth, enabled, 1), { rpId, origin, challenge: enabled }), 'PasskeyUser');
    assert.ok(!JSON.stringify(s.auditLog({ security: true })).includes('passkey-secret'));
  } finally { f.done(); }
});

const adminMutations = {
  delete: (s: Store) => s.deleteAccount('Admin'),
  demote: (s: Store) => s.setAccountPrivilegeSet('Admin', 'Staff'),
  deactivate: (s: Store) => s.setAccountActive('Admin', false),
};
const confirmFactor = (s: Store, account: string) => {
  const { secret } = s.enrollTotp(account);
  assert.equal(s.confirmTotp(account, totpCode(secret)), true);
};
function backupWithMfa(s: Store, full: string, policy: 'account' | 'file') {
  if (policy === 'file') {
    confirmFactor(s, 'Admin');
    s.setRequireTotpForFullAccess(true);
  }
  // A new Full Access account can be added after the file-wide MFA policy is enabled.
  s.setPassword('Backup', 'backup-secret', full);
  if (policy === 'account') s.setAccountRequire2fa('Backup', true);
}

test('delete, demote and deactivate reject backups unable to complete account or file MFA', () => {
  for (const policy of ['account', 'file'] as const) for (const pending of [false, true]) for (const [operation, mutate] of Object.entries(adminMutations)) {
    const f = fresh();
    try {
      const s = f.store;
      backupWithMfa(s, f.full, policy);
      if (pending) s.enrollTotp('Backup');
      assert.equal(s.hasSecondFactor('Backup'), false);
      const before = s.accounts();
      const audit = s.auditLog({ security: true });
      assert.throws(() => mutate(s), /last account with full access/, `${policy} MFA, ${pending ? 'pending' : 'missing'} factor, ${operation}`);
      assert.deepEqual(s.accounts(), before);
      assert.deepEqual(s.auditLog({ security: true }), audit, 'refused mutations write no successful security events');
      assert.equal(s.verify('Admin', 'admin-secret', ''), true);
    } finally { f.done(); }
  }
});

test('confirmed TOTP and registered passkeys provide usable MFA paths for alternative administrators', () => {
  for (const policy of ['account', 'file'] as const) for (const factor of ['totp', 'passkey']) for (const [operation, mutate] of Object.entries(adminMutations)) {
    const f = fresh();
    try {
      const s = f.store;
      backupWithMfa(s, f.full, policy);
      if (factor === 'totp') confirmFactor(s, 'Backup');
      else {
        const rpId = 'host.example', origin = 'https://host.example';
        const authenticator = makeAuthenticator(rpId, origin);
        const challenge = s.issueWebauthnChallenge('register', 'Backup');
        s.registerPasskey('Backup', forgeRegistration(authenticator, challenge), { rpId, origin, challenge });
      }
      assert.equal(s.hasSecondFactor('Backup'), true);
      assert.doesNotThrow(() => mutate(s), `${policy} MFA, ${factor}, ${operation}`);
      assert.equal(s.accountInactive('Backup'), false);
      assert.equal(s.accountPrivilegeSet('Backup'), f.full);
      assert.equal(s.verify('Backup', 'backup-secret', ''), true);
    } finally { f.done(); }
  }
});

test('CSV preview and apply through an external mapping enforce MFA on untouched recovery administrators', () => {
  for (const policy of ['account', 'file'] as const) {
    const f = fresh();
    try {
      const s = f.store;
      s.setExternalAccount('Owners', f.full);
      backupWithMfa(s, f.full, policy);
      const actor = 'person@example.test';
      for (const desired of ['Admin,Staff,true', `Admin,${f.full},false`]) {
        const csv = header + desired;
        const preview = s.previewAccountImport(csv, actor, 'Owners');
        assert.equal(preview.valid, false);
        assert.ok(preview.errors.some((e) => e.code === 'last-full-access'));
        assert.equal(preview.previewToken, undefined);
        assert.throws(() => s.applyAccountImport(csv, actor, '', `blocked-${policy}`, 'Owners'));
        assert.equal(s.accountInactive('Admin'), false);
        assert.equal(s.accountPrivilegeSet('Admin'), f.full);
      }
      s.enrollTotp('Backup');
      assert.equal(s.previewAccountImport(header + 'Admin,Staff,true', actor, 'Owners').valid, false, 'pending enrollment is insufficient');
      confirmFactor(s, 'Backup');
      const csv = header + 'Admin,Staff,true';
      const preview = s.previewAccountImport(csv, actor, 'Owners');
      assert.equal(preview.valid, true);
      s.disableTotp('Backup');
      assert.throws(() => s.applyAccountImport(csv, actor, preview.previewToken!, `factor-removed-${policy}`, 'Owners'), /stale-or-changed-preview/);
      assert.equal(s.accountPrivilegeSet('Admin'), f.full);
      assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM _fm_account_import_receipts').get()!.n, 0);
      confirmFactor(s, 'Backup');
      const next = s.previewAccountImport(csv, actor, 'Owners');
      const result = s.applyAccountImport(csv, actor, next.previewToken!, `confirmed-${policy}`, 'Owners');
      assert.deepEqual(result.rows, next.rows);
      assert.equal(s.accountPrivilegeSet('Admin'), 'Staff');
    } finally { f.done(); }
  }
});

test('ambiguous recovery accounts never permit deletion, demotion or deactivation, regardless of row order', () => {
  for (const passwordFirst of [false, true]) for (const [operation, mutate] of Object.entries(adminMutations)) {
    const f = fresh();
    try {
      const s = f.store;
      if (passwordFirst) s.setPassword('BACKUP', 'backup-secret', f.full);
      else s.createLocalAccount('Backup', f.full, true);
      s.sql.prepare('INSERT INTO _fm_accounts (name, source, password_hash, privilege_set) VALUES (?, ?, ?, ?)')
        .run(passwordFirst ? 'Backup' : 'BACKUP', 'openhbam', passwordFirst ? null : hashPassword('backup-secret'), f.full);
      if (!passwordFirst) {
        assert.equal(s.verify('Backup', 'backup-secret', ''), false);
        assert.equal(s.verify('BACKUP', 'backup-secret', ''), false, 'SQLite resolves both spellings to the credential-free row');
      }
      const before = s.accounts();
      const audit = s.auditLog({ security: true });
      assert.throws(() => mutate(s), /last account with full access/, `${operation}, ${passwordFirst ? 'password' : 'placeholder'} first`);
      assert.deepEqual(s.accounts(), before);
      assert.deepEqual(s.auditLog({ security: true }), audit);
    } finally { f.done(); }
  }
});

test('CSV and the pure planner reject untouched ASCII and Unicode ambiguity among recovery administrators', () => {
  for (const names of [['Backup', 'BACKUP'], ['École', 'école']]) {
    const f = fresh();
    try {
      const s = f.store;
      s.setExternalAccount('Owners', f.full);
      s.createLocalAccount(names[0], f.full, true);
      s.sql.prepare('INSERT INTO _fm_accounts (name, source, password_hash, privilege_set) VALUES (?, ?, ?, ?)')
        .run(names[1], 'openhbam', hashPassword('backup-secret'), f.full);
      const csv = header + 'Admin,Staff,false';
      const preview = s.previewAccountImport(csv, 'person@example.test', 'Owners');
      assert.equal(preview.valid, false);
      assert.ok(preview.errors.some((e) => e.code === 'last-full-access'));
      assert.ok(!preview.errors.some((e) => e.code === 'ambiguous-existing-account'), 'the ambiguous accounts are not named in the CSV');
      // Even precomputed credential-presence flags cannot make an ambiguous identity recoverable.
      const accounts = s.accounts().map((a) => ({ ...a, local: !a.external && !a.agent, recoverable: true, hasSecondFactor: true }));
      const pure = planAccountImport(parseAccountCsv(csv), accounts, s.privilegeSets(), 'person@example.test', 'Owners');
      assert.equal(pure.valid, false);
      assert.ok(pure.errors.some((e) => e.code === 'last-full-access'));
      assert.throws(() => s.applyAccountImport(csv, 'person@example.test', '', 'ambiguous-backup', 'Owners'));
      assert.equal(s.accountPrivilegeSet('Admin'), f.full);
      assert.equal(s.accountInactive('Admin'), false);
    } finally { f.done(); }
  }
});
