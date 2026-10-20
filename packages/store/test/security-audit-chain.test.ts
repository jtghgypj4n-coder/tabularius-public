import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, StoreError, writer, endTransaction, totpCode, verifySecurityAudit, type Transaction } from '../src/index.ts';
import { ensureSecurityChain, securityEventHash } from '../src/security-chain.ts';

function open(): { dir: string; path: string; store: Store; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-chain-'));
  const path = join(dir, 'Test.openhbam.sqlite');
  createStore(path);
  const store = new Store(path);
  return { dir, path, store, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function events(store: Store, count = 5): void {
  for (let i = 0; i < count; i++) store.auditSignIn(`account-${i}`, `place-${i}`, i % 2 === 0);
}

function securityState(store: Store): unknown {
  return ['_fm_accounts', '_fm_privileges', '_fm_totp', '_fm_api_tokens', '_fm_meta', '_fm_audit', '_fm_security_chain_state']
    .map((table) => store.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

const mutations: [string, (store: Store) => () => unknown][] = [
  ['add account', (s) => () => s.setPassword('new', 'new password')],
  ['change password', (s) => () => s.setPassword('member', 'changed password')],
  ['disable account', (s) => () => s.setAccountActive('member', false)],
  ['delete account', (s) => () => s.deleteAccount('member')],
  ['enroll second factor', (s) => () => s.enrollTotp('member')],
  ['confirm second factor', (s) => {
    const { secret } = s.enrollTotp('member');
    return () => s.confirmTotp('member', totpCode(secret));
  }],
  ['disable second factor', (s) => {
    const { secret } = s.enrollTotp('member');
    s.confirmTotp('member', totpCode(secret));
    return () => s.disableTotp('member');
  }],
  ['external account', (s) => () => s.setExternalAccount('external', s.privilegeSets().find((p) => p.id === 1)!.name)],
  ['security batch', (s) => () => s.applySecurity([
    { op: 'setAccount', name: 'member', password: 'changed password', localOnly: true, require2fa: true },
    { op: 'setPasswordPolicy', policy: { minLength: 8 } },
  ])],
];

for (const [name, prepare] of mutations) {
  test(`${name} as the first script transaction operation commits or reverts state and audit together`, () => {
    for (const keep of [false, true]) {
      const f = open();
      const tx: Transaction = { files: new Map() };
      try {
        f.store.setPassword('member', 'original password');
        const mutate = prepare(f.store);
        const before = securityState(f.store);
        const committed = f.store.verifySecurityAudit();
        writer.run({ transaction: { open: tx } }, mutate);
        assert.ok(tx.files.has(f.store), 'ownership was acquired before the mutation');
        const changed = securityState(f.store);
        assert.notDeepEqual(changed, before);
        assert.deepEqual(f.store.verifySecurityAudit(), committed, 'separate verifier sees committed history');
        endTransaction(tx, keep);
        assert.deepEqual(securityState(f.store), keep ? changed : before);
        assert.equal(f.store.verifySecurityAudit().ok, true);
      } finally { endTransaction(tx, false); f.close(); }
    }
  });
}

test('another script transaction owning the store refuses security writes before changing any state', () => {
  for (const [name, prepare] of mutations) {
    const f = open();
    const tx: Transaction = { files: new Map() };
    try {
      f.store.setPassword('member', 'original password');
      const mutate = prepare(f.store);
      writer.run({ transaction: { open: tx } }, () => f.store.setAccountLocalOnly('member', true));
      const held = securityState(f.store);
      const denied = (e: unknown) => e instanceof StoreError && e.code === 301;
      assert.throws(mutate, denied, name);
      const other: Transaction = { files: new Map() };
      assert.throws(() => writer.run({ transaction: { open: other } }, mutate), denied, name);
      assert.equal(other.files.size, 0);
      assert.deepEqual(securityState(f.store), held, name);
      endTransaction(tx, false);
      assert.equal(f.store.verifySecurityAudit().ok, true);
    } finally { endTransaction(tx, false); f.close(); }
  }
});

test('audit append failure reverts the security mutation both standalone and inside a script transaction', () => {
  for (const [name, prepare] of mutations) for (const nested of [false, true]) {
    const f = open();
    const tx: Transaction = { files: new Map() };
    try {
      f.store.setPassword('member', 'original password');
      const mutate = prepare(f.store);
      const before = securityState(f.store);
      f.store.sql.exec(`CREATE TRIGGER fail_security_head BEFORE UPDATE OF head_hash ON _fm_security_chain_state
        BEGIN SELECT RAISE(ABORT, 'head interrupted'); END`);
      assert.throws(() => nested ? writer.run({ transaction: { open: tx } }, mutate) : mutate(), /head interrupted/, name);
      assert.equal(f.store.sql.isTransaction, nested);
      assert.deepEqual(securityState(f.store), before, name);
      endTransaction(tx, false);
      assert.equal(f.store.verifySecurityAudit().ok, true);
    } finally { endTransaction(tx, false); f.close(); }
  }
});

test('canonical hash vector preserves Unicode, escaping, nulls, raw JSON and 64-bit ids', () => {
  const row = { chain_seq: 2n, prev_hash: '0'.repeat(64), seq: 9007199254740993n,
    at: '2026-01-02T03:04:05.006Z', account: 'Zoë\n"\\', kind: 'sign-in', tbl: '',
    record_id: null, changes: '{ "nested": [null, "雪", "\\\\"] }', security: 1n, agent: 0n };
  const original = securityEventHash('test-chain', row);
  assert.equal(original, '89cd825c7504688f2da65d0d68e2478a73c6468134ff738248c9a29186b08d27');
  for (const change of [{ account: '' }, { account: null }, { changes: JSON.stringify(JSON.parse(row.changes)) },
    { seq: 9007199254740992n }, { record_id: 9007199254740993n }]) {
    assert.notEqual(securityEventHash('test-chain', { ...row, ...change }), original);
  }
  assert.throws(() => securityEventHash('test-chain', { ...row, seq: Number(row.seq) }), /invalid integer/);
  assert.throws(() => securityEventHash('test-chain', { ...row, changes: {} }), /invalid text/);
});

test('complete database text with embedded NULs and BOMs can be appended and verified', () => {
  const f = open();
  try {
    for (const account of ['Ann\0Mallory', '\uFEFFAnn', 'Ann\uFFFD']) f.store.auditSignIn(account, 'place\0suffix', true);
    assert.equal(f.store.verifySecurityAudit().ok, true);
    const stored = f.store.sql.prepare('SELECT CAST(account AS BLOB) AS account FROM _fm_audit WHERE seq = 1').get()!;
    assert.deepEqual(Buffer.from(stored.account as Uint8Array), Buffer.from('Ann\0Mallory'));
  } finally { f.close(); }
});

test('NUL suffixes in every stored event text field cannot collide with the original hashes', () => {
  for (const field of ['at', 'account', 'kind', 'tbl', 'changes', 'prev_hash', 'event_hash']) {
    const f = open();
    try {
      events(f.store, 1);
      const old = f.store.sql.prepare(`SELECT CAST(${field} AS BLOB) AS value FROM _fm_audit WHERE seq = 1`).get()!;
      const bytes = Buffer.concat([Buffer.from(old.value as Uint8Array), Buffer.from('\0Mallory')]);
      f.store.sql.prepare(`UPDATE _fm_audit SET ${field} = CAST(? AS TEXT) WHERE seq = 1`).run(bytes);
      const result = f.store.verifySecurityAudit();
      assert.equal(result.ok, false, field);
      assert.equal(result.firstBrokenSeq, '1', field);
    } finally { f.close(); }
  }
});

test('malformed UTF-8 decoding collisions in stored account and JSON payload bytes are rejected', () => {
  for (const field of ['account', 'changes']) {
    const f = open();
    try {
      f.store.auditSignIn('Ann\uFFFD', '\uFFFD', true);
      assert.equal(f.store.verifySecurityAudit().ok, true);
      const before = f.store.sql.prepare(`SELECT ${field} AS value, CAST(${field} AS BLOB) AS bytes FROM _fm_audit`).get()!;
      const valid = Buffer.from(before.bytes as Uint8Array);
      const offset = valid.indexOf(Buffer.from('\uFFFD'));
      assert.ok(offset >= 0);
      const invalid = Buffer.concat([valid.subarray(0, offset), Buffer.from([0xff]), valid.subarray(offset + 3)]);
      f.store.sql.prepare(`UPDATE _fm_audit SET ${field} = CAST(? AS TEXT)`).run(invalid);
      assert.equal(f.store.sql.prepare(`SELECT ${field} AS value FROM _fm_audit`).get()!.value, before.value,
        'the Node TEXT decoding probe reproduces the collision');
      const result = f.store.verifySecurityAudit();
      assert.equal(result.ok, false);
      assert.equal(result.firstBrokenSeq, '1');
      assert.match(result.reason!, /invalid UTF-8 text/);
    } finally { f.close(); }
  }
});

test('genesis text and stored head/hash text use complete bytes too', () => {
  for (const field of ['chain_id', 'created_at', 'genesis_hash', 'head_hash']) for (const suffix of [Buffer.from('\0suffix'), Buffer.from([0xff])]) {
    const f = open();
    try {
      const old = f.store.sql.prepare(`SELECT CAST(${field} AS BLOB) AS value FROM _fm_security_chain_state`).get()!;
      f.store.sql.prepare(`UPDATE _fm_security_chain_state SET ${field} = CAST(? AS TEXT)`)
        .run(Buffer.concat([Buffer.from(old.value as Uint8Array), suffix]));
      assert.equal(f.store.verifySecurityAudit().ok, false, field);
    } finally { f.close(); }
  }
  for (const field of ['chain_id', 'created_at']) {
    const f = open();
    try {
      const state = { chain_id: 'chain', created_at: 'created', [field]: 'text\uFFFD' };
      const genesis = createHash('sha256').update(JSON.stringify(['openhbam/security-genesis/v1', state.chain_id, state.created_at, '0', '0'])).digest('hex');
      f.store.sql.prepare('UPDATE _fm_security_chain_state SET chain_id = ?, created_at = ?, genesis_hash = ?, head_hash = ?')
        .run(state.chain_id, state.created_at, genesis, genesis);
      assert.equal(f.store.verifySecurityAudit().ok, true);
      const malformed = Buffer.concat([Buffer.from('text'), Buffer.from([0xff])]);
      f.store.sql.prepare(`UPDATE _fm_security_chain_state SET ${field} = CAST(? AS TEXT)`).run(malformed);
      assert.equal(f.store.sql.prepare(`SELECT ${field} AS value FROM _fm_security_chain_state`).get()!.value, state[field]);
      assert.match(f.store.verifySecurityAudit().reason!, /invalid UTF-8 text/);
    } finally { f.close(); }
  }
});

test('the verifier inclusion predicate uses the partial index and still includes altered flags', () => {
  const f = open();
  try {
    const plan = f.store.sql.prepare(`EXPLAIN QUERY PLAN SELECT seq FROM _fm_audit
      WHERE security = 1 OR chain_seq IS NOT NULL OR prev_hash IS NOT NULL OR event_hash IS NOT NULL ORDER BY seq`).all();
    assert.ok(plan.some((row) => String(row.detail).includes('_fm_security_audit_chain')));
    events(f.store, 1);
    f.store.sql.exec('UPDATE _fm_audit SET security = 0 WHERE seq = 1');
    assert.equal(f.store.verifySecurityAudit().firstBrokenSeq, '1');
  } finally { f.close(); }
});

test('the per-file chain covers more than 10,000 events and permits record-audit gaps', () => {
  const f = open();
  try {
    assert.equal(f.store.verifySecurityAudit().ok, true);
    f.store.sql.exec('BEGIN IMMEDIATE');
    events(f.store, 10025);
    f.store.sql.exec("INSERT INTO _fm_audit (at, kind, tbl) VALUES ('now', 'create', 'Records')");
    events(f.store, 2);
    f.store.sql.exec('COMMIT');
    const result = f.store.verifySecurityAudit();
    assert.equal(result.ok, true, result.reason ?? '');
    assert.equal(result.checked, 10027);
    assert.equal(result.firstBrokenSeq, null);
    assert.equal(result.head?.chainSeq, '10027');
    assert.equal(result.head?.auditSeq, '10028');
    const first = f.store.sql.prepare('SELECT prev_hash FROM _fm_audit WHERE seq = 1').get();
    const state = f.store.sql.prepare('SELECT genesis_hash FROM _fm_security_chain_state').get();
    assert.equal(first?.prev_hash, state?.genesis_hash);
  } finally { f.close(); }
});

for (const [field, value] of [
  ['at', "'changed'"], ['account', "'changed'"], ['kind', "'changed'"], ['tbl', "'changed'"],
  ['record_id', '99'], ['changes', "'{}'"], ['security', '0'], ['agent', '1'],
  ['chain_seq', '99'], ['prev_hash', "'changed'"], ['event_hash', 'NULL'],
] as const) {
  test(`verification detects an edited ${field}`, () => {
    const f = open();
    try {
      events(f.store);
      f.store.sql.exec(`UPDATE _fm_audit SET ${field} = ${value} WHERE seq = 3`);
      const result = f.store.verifySecurityAudit();
      assert.equal(result.ok, false);
      assert.equal(result.status, 'broken');
      assert.equal(result.firstBrokenSeq, '3');
      assert.ok(result.reason);
      assert.equal(result.checked, 2);
    } finally { f.close(); }
  });
}

test('verification detects a deleted middle row, reordered rows and tail deletion with the head retained', () => {
  for (const [sql, seq, reason] of [
    ['DELETE FROM _fm_audit WHERE seq = 3', '4', /chain position/],
    ['UPDATE _fm_audit SET seq = 100 WHERE seq = 2; UPDATE _fm_audit SET seq = 2 WHERE seq = 3; UPDATE _fm_audit SET seq = 3 WHERE seq = 100', '2', /chain position/],
    ['DELETE FROM _fm_audit WHERE seq >= 4', '5', /stored head mismatch/],
    ['DELETE FROM _fm_audit', '5', /stored head mismatch/],
  ] as const) {
    const f = open();
    try {
      events(f.store);
      f.store.sql.exec(sql);
      const result = f.store.verifySecurityAudit();
      assert.equal(result.ok, false);
      assert.equal(result.firstBrokenSeq, seq);
      assert.match(result.reason!, reason);
    } finally { f.close(); }
  }
});

test('verification detects an inserted audit row and reports its sequence', () => {
  const f = open();
  try {
    events(f.store);
    f.store.sql.exec("INSERT INTO _fm_audit (at, kind, tbl, security, agent) VALUES ('forged', 'sign-in', '', 1, 0)");
    const result = f.store.verifySecurityAudit();
    assert.equal(result.ok, false);
    assert.equal(result.status, 'broken');
    assert.equal(result.firstBrokenSeq, '6');
    assert.match(result.reason!, /chain position/);
  } finally { f.close(); }
});

test('a local chain cannot detect tail truncation when the retained head is also rewritten', () => {
  const f = open();
  try {
    events(f.store);
    f.store.sql.exec(`DELETE FROM _fm_audit WHERE seq > 3;
      UPDATE _fm_security_chain_state SET head_seq = 3, head_audit_seq = 3,
        head_hash = (SELECT event_hash FROM _fm_audit WHERE seq = 3)`);
    // Without an external checkpoint the shortened history is internally consistent.
    assert.equal(f.store.verifySecurityAudit().ok, true);
  } finally { f.close(); }
});

test('unlinked security rows and forged genesis are reported, never silently repaired on reopen', () => {
  const f = open();
  try {
    events(f.store);
    f.store.sql.exec("INSERT INTO _fm_audit (at, kind, tbl, security) VALUES ('now', 'sign-in', '', 1)");
    const reopened = new Store(f.path);
    try {
      assert.equal(reopened.verifySecurityAudit().firstBrokenSeq, '6');
      assert.equal(reopened.sql.prepare('SELECT event_hash FROM _fm_audit WHERE seq = 6').get()?.event_hash, null);
    } finally { reopened.close(); }
    f.store.sql.exec('DELETE FROM _fm_audit WHERE seq = 6');
    f.store.sql.exec("UPDATE _fm_security_chain_state SET genesis_hash = 'forged'");
    assert.match(f.store.verifySecurityAudit().reason!, /genesis hash mismatch/);
  } finally { f.close(); }
});

test('64-bit stored sequence numbers are hashed and verified without rounding', () => {
  const f = open();
  try {
    f.store.sql.exec("INSERT INTO sqlite_sequence (name, seq) VALUES ('_fm_audit', 9007199254740992)");
    events(f.store, 2);
    const result = f.store.verifySecurityAudit();
    assert.equal(result.ok, true, result.reason ?? '');
    assert.equal(result.head?.auditSeq, '9007199254740994');
  } finally { f.close(); }
});

test('existing security rows become a legacy baseline without changing their stored fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-legacy-'));
  const path = join(dir, 'Old.openhbam.sqlite');
  createStore(path);
  const sql = new DatabaseSync(path);
  sql.exec(`CREATE TABLE _fm_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
    account TEXT, kind TEXT NOT NULL, tbl TEXT NOT NULL, record_id INTEGER, changes TEXT, security INTEGER NOT NULL DEFAULT 0);
    INSERT INTO _fm_audit VALUES (1, 'old', 'Ann', 'sign-in', '', NULL, '{ "from": "old" }', 1);
    INSERT INTO _fm_audit VALUES (2, 'old', 'Ann', 'create', 'Records', 1, NULL, 0);
    INSERT INTO _fm_audit VALUES (3, 'old', NULL, 'sign-in-failed', '', NULL, NULL, 1)`);
  sql.prepare('UPDATE _fm_audit SET account = CAST(? AS TEXT) WHERE seq = 1').run(Buffer.from('Ann\0legacy'));
  const original = sql.prepare('SELECT * FROM _fm_audit').all();
  sql.close();
  const store = new Store(path);
  try {
    const fields = 'seq, at, account, kind, tbl, record_id, changes, security';
    assert.deepEqual(store.sql.prepare(`SELECT ${fields} FROM _fm_audit`).all(), original);
    assert.deepEqual(Buffer.from(store.sql.prepare('SELECT CAST(account AS BLOB) AS account FROM _fm_audit WHERE seq = 1').get()!.account as Uint8Array),
      Buffer.from('Ann\0legacy'));
    const result = store.verifySecurityAudit();
    assert.equal(result.ok, true);
    assert.equal(result.checked, 2);
    assert.equal(result.legacyThroughSeq, '3');
    store.auditSignIn('new', 'new', true);
    assert.equal(store.verifySecurityAudit().checked, 3);
    assert.equal(store.verifySecurityAudit().legacyThroughSeq, '3');
    store.sql.exec("UPDATE _fm_audit SET changes = '{}' WHERE seq = 1");
    assert.equal(store.verifySecurityAudit().firstBrokenSeq, '1');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('interrupted migration rolls columns, links and state back and can be retried', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`CREATE TABLE _fm_audit (seq INTEGER PRIMARY KEY, at TEXT, account TEXT, kind TEXT, tbl TEXT,
      record_id INTEGER, changes TEXT, security INTEGER, agent INTEGER);
      INSERT INTO _fm_audit VALUES (1, 'old', NULL, 'sign-in', '', NULL, NULL, 1, 0);
      INSERT INTO _fm_audit VALUES (2, 'old', NULL, 'sign-in', '', NULL, NULL, 1, 0);
      CREATE TRIGGER fail_migration BEFORE UPDATE ON _fm_audit WHEN OLD.seq = 2
        BEGIN SELECT RAISE(ABORT, 'migration interrupted'); END`);
    assert.throws(() => ensureSecurityChain(sql), /migration interrupted/);
    assert.equal(sql.isTransaction, false);
    assert.equal(sql.prepare("SELECT 1 FROM sqlite_schema WHERE name = '_fm_security_chain_state'").get(), undefined);
    assert.ok(!sql.prepare('PRAGMA table_info(_fm_audit)').all().some((r) => r.name === 'event_hash'));
    sql.exec('DROP TRIGGER fail_migration');
    ensureSecurityChain(sql);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM _fm_audit WHERE event_hash IS NOT NULL').get()?.n, 2);
  } finally { sql.close(); }
});

test('malformed legacy text aborts migration without publishing a baseline', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`CREATE TABLE _fm_audit (seq INTEGER PRIMARY KEY, at TEXT, account TEXT, kind TEXT, tbl TEXT,
      record_id INTEGER, changes TEXT, security INTEGER, agent INTEGER);
      INSERT INTO _fm_audit VALUES (1, 'old', CAST(X'ff' AS TEXT), 'sign-in', '', NULL, NULL, 1, 0)`);
    assert.throws(() => ensureSecurityChain(sql), /invalid UTF-8 text/);
    assert.equal(sql.isTransaction, false);
    assert.equal(sql.prepare("SELECT 1 FROM sqlite_schema WHERE name = '_fm_security_chain_state'").get(), undefined);
    assert.ok(!sql.prepare('PRAGMA table_info(_fm_audit)').all().some((r) => r.name === 'event_hash'));
    assert.equal(sql.prepare('SELECT hex(CAST(account AS BLOB)) AS bytes FROM _fm_audit').get()?.bytes, 'FF');
  } finally { sql.close(); }
});

test('failed appends roll back the row and head without committing the caller transaction', () => {
  const f = open();
  try {
    events(f.store, 1);
    const head = f.store.verifySecurityAudit().head;
    f.store.sql.exec(`CREATE TRIGGER fail_head BEFORE UPDATE OF head_hash ON _fm_security_chain_state
      BEGIN SELECT RAISE(ABORT, 'head interrupted'); END`);
    assert.throws(() => events(f.store, 1), /head interrupted/);
    assert.equal(f.store.sql.prepare('SELECT COUNT(*) AS n FROM _fm_audit').get()?.n, 1);
    assert.deepEqual(f.store.verifySecurityAudit().head, head);
    const trial = f.store.trial();
    assert.throws(() => events(f.store, 1), /head interrupted/);
    assert.equal(f.store.sql.isTransaction, true);
    f.store.sql.exec('DROP TRIGGER fail_head');
    events(f.store, 3);
    assert.equal(f.store.sql.prepare('SELECT COUNT(*) AS n FROM _fm_audit').get()?.n, 4);
    assert.equal(f.store.verifySecurityAudit().checked, 1, 'read-only verifier sees committed history');
    trial.undo();
    assert.deepEqual(f.store.verifySecurityAudit().head, head);
  } finally { f.close(); }
});

test('stale reader snapshots fail atomically at the write lock rather than fork the chain', () => {
  const f = open();
  const other = new Store(f.path);
  try {
    f.store.sql.exec('BEGIN');
    f.store.sql.prepare('SELECT * FROM _fm_security_chain_state').get();
    events(other, 1);
    assert.throws(() => events(f.store, 1), /locked/);
    assert.equal(f.store.sql.isTransaction, true);
    f.store.sql.exec('ROLLBACK');
    assert.equal(f.store.verifySecurityAudit().checked, 1);
    assert.equal(f.store.verifySecurityAudit().ok, true);
  } finally { other.close(); f.close(); }
});

test('several real worker processes append one ordered chain and reopening preserves it', { timeout: 30000 }, async (t) => {
  const env = commandStubEnv(t);
  const f = open();
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const source = `import { Store } from ${JSON.stringify(new URL('../src/store.ts', import.meta.url).href)};
      const store = new Store(process.argv[1]);
      process.stdout.write('ready\\n');
      process.stdin.once('data', () => {
        try {
          for (let i = 0; i < 150; i++) store.auditSignIn(process.argv[2] + '-' + i, 'worker', true);
        } finally { store.close(); }
      });`;
    const workers = Array.from({ length: 4 }, (_, i) => {
      const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', source, f.path, String(i)], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(child);
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data; });
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout.once('data', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => { if (code !== 0) reject(new Error(stderr)); });
      });
      const done = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
      });
      return { child, ready, done };
    });
    // Attach completion handlers before a startup failure can reject either promise.
    const completion = Promise.all(workers.map((w) => w.done));
    await Promise.all([Promise.all(workers.map((w) => w.ready)).then(() => {
      for (const w of workers) w.child.stdin.end('go');
    }), completion]);
    const result = f.store.verifySecurityAudit();
    assert.equal(result.ok, true, result.reason ?? '');
    assert.equal(result.checked, 600);
    assert.equal(f.store.sql.prepare('SELECT COUNT(DISTINCT account) AS n FROM _fm_audit').get()?.n, 600);
    const reopened = new Store(f.path);
    try { assert.deepEqual(reopened.verifySecurityAudit(), result); } finally { reopened.close(); }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    f.close();
  }
});

test('verification reports an old unprotected file without creating tables or columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-unprotected-'));
  const path = join(dir, 'Old.openhbam.sqlite');
  createStore(path);
  const sql = new DatabaseSync(path);
  try {
    const before = sql.prepare('SELECT * FROM sqlite_schema').all();
    const result = verifySecurityAudit(path);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'unprotected');
    assert.match(result.reason!, /not initialized/);
    assert.deepEqual(sql.prepare('SELECT * FROM sqlite_schema').all(), before);
  } finally { sql.close(); rmSync(dir, { recursive: true, force: true }); }
});
