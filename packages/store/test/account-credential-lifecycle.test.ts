import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, totpCode } from '../src/index.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from './forge-webauthn.ts';

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-account-lifecycle-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path);
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.createAccount('ReviewUser', 'first-synthetic-password', 'Staff');
  store.createAccount('OtherUser', 'other-synthetic-password', 'Staff');
  return { store, done() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('AR-store-core-01: recovery lifecycle', () => {
  const f = fresh();
  try {
    const s = f.store;
    const [code] = s.generateRecoveryCodes('ReviewUser', 1);
    const [other] = s.generateRecoveryCodes('OtherUser', 1);
    assert.equal(s.deleteAccount('reviewuser'), true);
    s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
    assert.deepEqual({ remaining: s.recoveryCodesRemaining('ReviewUser'), accepted: s.useRecoveryCode('ReviewUser', code) },
      { remaining: 0, accepted: false });
    assert.equal(s.useRecoveryCode('OtherUser', other), true);
  } finally { f.done(); }
});

test('AR-store-core-01: registration lifecycle', () => {
  const f = fresh();
  try {
    const s = f.store;
    const auth = makeAuthenticator('example.test', 'https://example.test');
    const challenge = s.issueWebauthnChallenge('register', 'REVIEWUSER');
    const other = s.issueWebauthnChallenge('register', 'OtherUser');
    const anonymous = s.issueWebauthnChallenge('auth');
    s.deleteAccount('reviewuser');
    s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
    assert.throws(() => s.registerPasskey('ReviewUser', forgeRegistration(auth, challenge), { ...auth, challenge }), /expired/);
    assert.equal(s.hasPasskey('ReviewUser'), false);
    assert.ok(s.sql.prepare('SELECT 1 FROM _fm_webauthn_challenges WHERE challenge = ?').get(anonymous));
    s.registerPasskey('OtherUser', forgeRegistration(auth, other), { ...auth, challenge: other });
    assert.equal(s.hasPasskey('OtherUser'), true);
  } finally { f.done(); }
});

test('AR-store-core-01: credential transaction rollback', () => {
  const f = fresh();
  try {
    const s = f.store;
    const [code] = s.generateRecoveryCodes('ReviewUser', 1);
    const token = s.createApiToken('ReviewUser');
    const { secret } = s.enrollTotp('ReviewUser');
    s.confirmTotp('ReviewUser', totpCode(secret));
    const auth = makeAuthenticator('example.test', 'https://example.test');
    const challenge = s.issueWebauthnChallenge('register', 'ReviewUser');
    const pending = s.issueWebauthnChallenge('register', 'ReviewUser');
    s.registerPasskey('ReviewUser', forgeRegistration(auth, challenge), { ...auth, challenge });
    s.sql.exec(`CREATE TRIGGER reject_account_removal BEFORE INSERT ON _fm_audit
      WHEN NEW.kind = 'account-removed' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
    assert.throws(() => s.deleteAccount('ReviewUser'), /synthetic audit failure/);
    assert.equal(s.canonicalAccount('ReviewUser'), 'ReviewUser');
    assert.equal(s.recoveryCodesRemaining('ReviewUser'), 1);
    assert.equal(s.useRecoveryCode('ReviewUser', code), true);
    assert.ok(s.apiToken(token));
    assert.equal(s.hasTotp('ReviewUser'), true);
    assert.equal(s.hasPasskey('ReviewUser'), true);
    assert.ok(s.sql.prepare('SELECT 1 FROM _fm_webauthn_challenges WHERE challenge = ?').get(pending));
    s.sql.exec('DROP TRIGGER reject_account_removal');
    s.deleteAccount('ReviewUser');
    s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
    assert.equal(s.apiToken(token), undefined);
    assert.equal(s.hasTotp('ReviewUser'), false);
    assert.equal(s.hasPasskey('ReviewUser'), false);
    const assertionChallenge = s.issueWebauthnChallenge('auth');
    assert.throws(() => s.verifyPasskeyAssertion(forgeAssertion(auth, assertionChallenge), { ...auth, challenge: assertionChallenge }));
    for (const table of ['_fm_recovery_codes', '_fm_webauthn_challenges']) {
      assert.equal(s.sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account = ? COLLATE NOCASE`).get('ReviewUser')!.n, 0);
    }
  } finally { f.done(); }
});

test('AR-store-core-01: name change through security operations', () => {
  const f = fresh();
  try {
    const s = f.store;
    const [code] = s.generateRecoveryCodes('ReviewUser', 1);
    const identity = s.accountIdentityId('ReviewUser');
    s.applySecurity([{ op: 'deleteAccount', name: 'ReviewUser' },
      { op: 'setAccount', name: 'RenamedUser', password: 'renamed-synthetic-password', privilegeSet: 'Staff' }]);
    s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
    for (const name of ['ReviewUser', 'RenamedUser']) {
      assert.notEqual(s.accountIdentityId(name), identity);
      assert.equal(s.recoveryCodesRemaining(name), 0);
      assert.equal(s.useRecoveryCode(name, code), false);
    }
  } finally { f.done(); }
});

test('AR-store-core-01: delegated credential lifecycle', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.setExternalAccount('Team', 'Staff');
    const token = s.createApiToken('Team', { identity: { issuer: 'https://example.test', sub: 'synthetic-person', person: 'REVIEWUSER', mapping: 'Team' } });
    const other = s.createApiToken('Team', { identity: { issuer: 'https://example.test', sub: 'synthetic-other', person: 'OtherUser', mapping: 'Team' } });
    assert.ok(s.apiToken(token));
    s.deleteAccount('ReviewUser');
    assert.equal(s.apiToken(token), undefined);
    s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
    assert.equal(s.apiToken(token), undefined);
    assert.ok(s.apiToken(other));
    const mapped = s.createApiToken('OtherUser', { identity: { issuer: 'https://example.test', sub: 'synthetic-mapping', mapping: 'ReviewUser' } });
    const malformed = s.createApiToken('OtherUser');
    s.sql.prepare('UPDATE _fm_api_tokens SET identity = ? WHERE id = ?').run('{', malformed.split('_')[1].split('.')[0]);
    s.deleteAccount('ReviewUser');
    assert.equal(s.apiToken(mapped), undefined);
    assert.ok(s.apiTokens().some((t) => malformed.startsWith(`ohbt_${t.id}.`)));
  } finally { f.done(); }
});

for (const withRuns of [false, true]) {
  test(`AR-store-core-01: saved execution ownership lifecycle ${withRuns ? 'with' : 'without'} run tables`, () => {
    const f = fresh();
    try {
      const s = f.store;
      s.sql.exec('CREATE TABLE _fm_automations (id TEXT PRIMARY KEY, json TEXT NOT NULL)');
      s.sql.exec('CREATE TABLE _fm_digests (id TEXT PRIMARY KEY, spec TEXT NOT NULL, last_slot TEXT)');
      if (withRuns) {
        s.sql.exec(`CREATE TABLE _fm_automation_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, automation TEXT NOT NULL, at TEXT NOT NULL,
          record_id INTEGER, outcome TEXT NOT NULL, error INTEGER, steps INTEGER, ms INTEGER, message TEXT);
          CREATE TABLE _fm_digest_runs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, at TEXT NOT NULL, spec TEXT NOT NULL)`);
      }
      for (const [table, column] of [['_fm_automations', 'json'], ['_fm_digests', 'spec']]) {
        for (const account of ['REVIEWUSER', 'OtherUser']) {
          for (const suffix of ['first', 'second']) {
            const id = `${account}-${suffix}`;
            s.sql.prepare(`INSERT INTO ${table} (id, ${column}) VALUES (?, ?)`).run(id, JSON.stringify({ account }));
            if (withRuns) {
              for (const run of [1, 2]) {
                if (table === '_fm_automations') {
                  s.sql.prepare('INSERT INTO _fm_automation_runs (automation, at, record_id, outcome) VALUES (?, ?, ?, ?)')
                    .run(id, 'synthetic', run, 'ok');
                } else {
                  s.sql.prepare('INSERT INTO _fm_digest_runs (id, digest, at, spec) VALUES (?, ?, ?, ?)')
                    .run(`${id}-${run}`, id, 'synthetic', JSON.stringify({ data: [{ value: `${account}-${run}` }], highlights: [account] }));
                }
              }
            }
          }
        }
      }
      const tables = ['_fm_automations', '_fm_digests', ...(withRuns ? ['_fm_automation_runs', '_fm_digest_runs'] : [])];
      const snapshot = () => tables.map((table) => s.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const before = snapshot();
      s.sql.exec(`CREATE TRIGGER reject_execution_removal BEFORE INSERT ON _fm_audit
        WHEN NEW.kind = 'account-removed' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
      assert.throws(() => s.deleteAccount('reviewuser'), /synthetic audit failure/);
      assert.deepEqual(snapshot(), before);
      s.sql.exec('DROP TRIGGER reject_execution_removal');
      s.deleteAccount('reviewuser');
      const remaining = () => {
        for (const table of ['_fm_automations', '_fm_digests']) {
          assert.deepEqual(s.sql.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map((r) => r.id), ['OtherUser-first', 'OtherUser-second']);
        }
        if (withRuns) {
          for (const [table, column] of [['_fm_automation_runs', 'automation'], ['_fm_digest_runs', 'digest']]) {
            assert.deepEqual(s.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
              before[tables.indexOf(table)].filter((row) => String(row[column]).startsWith('OtherUser-')));
          }
        }
      };
      remaining();
      s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
      remaining();
    } finally { f.done(); }
  });
}

test('AR-store-core-01: account-bound state lifecycle', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.sql.exec(`CREATE TABLE _fm_scim_users (id TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE COLLATE NOCASE,
      external_id TEXT, attrs TEXT, groups TEXT, created TEXT NOT NULL, modified TEXT NOT NULL)`);
    for (const account of ['REVIEWUSER', 'OtherUser']) {
      s.sql.prepare('INSERT INTO _fm_scim_users (id, account, created, modified) VALUES (?, ?, ?, ?)').run(account, account, 'synthetic', 'synthetic');
      s.sql.prepare('INSERT INTO _fm_pending (at, agent, kind, layout, tbl, summary) VALUES (?, ?, ?, ?, ?, ?)')
        .run('synthetic', account, 'create', 'Example', 'Example', 'Synthetic proposal');
      s.sql.prepare('INSERT INTO _fm_account_import_receipts (key, actor, digest, result) VALUES (?, ?, ?, ?)')
        .run(account, account, 'synthetic', '{}');
      s.setUserPref(account, 'savedFinds', 'synthetic');
    }
    const pending = s.pendingChanges().find((p) => p.agent === 'REVIEWUSER')!.id;
    const tables = [['_fm_scim_users', 'account'], ['_fm_pending', 'agent'],
      ['_fm_account_import_receipts', 'actor'], ['_fm_user_prefs', 'account']];
    s.sql.exec(`CREATE TRIGGER reject_account_state_removal BEFORE INSERT ON _fm_audit
      WHEN NEW.kind = 'account-removed' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
    assert.throws(() => s.deleteAccount('reviewuser'), /synthetic audit failure/);
    for (const [table] of tables) assert.equal(s.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 2);
    s.sql.exec('DROP TRIGGER reject_account_state_removal');
    s.deleteAccount('reviewuser');
    s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
    assert.throws(() => s.approvePending(pending, 'Admin'), /No pending change/);
    for (const [table, column] of tables) {
      assert.deepEqual(s.sql.prepare(`SELECT ${column} AS owner FROM ${table}`).all().map((r) => r.owner), ['OtherUser']);
    }
  } finally { f.done(); }
});

test('AR-store-core-01: shared dashboard ownership lifecycle', () => {
  const f = fresh();
  try {
    const s = f.store;
    s.sql.exec(`CREATE TABLE _fm_dashboards (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      spec TEXT NOT NULL, account TEXT, created TEXT NOT NULL, updated TEXT NOT NULL)`);
    for (const account of ['REVIEWUSER', 'OtherUser']) {
      s.sql.prepare('INSERT INTO _fm_dashboards (id, name, spec, account, created, updated) VALUES (?, ?, ?, ?, ?, ?)')
        .run(account, 'Synthetic dashboard', '[]', account, 'synthetic', 'synthetic');
    }
    s.deleteAccount('reviewuser');
    s.createAccount('ReviewUser', 'replacement-synthetic-password', 'Staff');
    assert.deepEqual(s.sql.prepare('SELECT account FROM _fm_dashboards ORDER BY id').all().map((r) => r.account), ['OtherUser', null]);
  } finally { f.done(); }
});
