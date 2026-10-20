import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { retainCurrentCredentials } from '../src/backup.ts';
import { importFmp12, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');

function ensureCredentialTables(path: string): void {
  const sql = new DatabaseSync(path);
  sql.exec(`CREATE TABLE IF NOT EXISTS _fm_api_tokens(id TEXT PRIMARY KEY, account TEXT, token_hash TEXT);
    CREATE TABLE IF NOT EXISTS _fm_totp(account TEXT PRIMARY KEY, secret TEXT);
    CREATE TABLE IF NOT EXISTS _fm_passkeys(id TEXT PRIMARY KEY, account TEXT);
    CREATE TABLE IF NOT EXISTS _fm_recovery_codes(account TEXT, code_hash TEXT);
    CREATE TABLE IF NOT EXISTS _fm_meta(key TEXT PRIMARY KEY, json TEXT);`);
  sql.close();
}

function db(path: string, current: boolean): void {
  const sql = new DatabaseSync(path);
  sql.exec(`CREATE TABLE _fm_accounts(name TEXT PRIMARY KEY, password_hash TEXT);
    CREATE TABLE _fm_api_tokens(id TEXT PRIMARY KEY, token_hash TEXT);
    CREATE TABLE _fm_totp(account TEXT PRIMARY KEY, secret TEXT);
    CREATE TABLE _fm_passkeys(id TEXT PRIMARY KEY, account TEXT);
    CREATE TABLE _fm_recovery_codes(account TEXT, code_hash TEXT);
    CREATE TABLE _fm_meta(key TEXT PRIMARY KEY, json TEXT);`);
  sql.prepare('INSERT INTO _fm_accounts VALUES (?,?)').run('alice', current ? 'new-password' : 'old-password');
  if (!current) sql.prepare('INSERT INTO _fm_accounts VALUES (?,?)').run('gone', 'historical-only');
  sql.prepare('INSERT INTO _fm_api_tokens VALUES (?,?)').run(current ? 'current' : 'revoked-history', current ? 'live' : 'old');
  sql.prepare('INSERT INTO _fm_totp VALUES (?,?)').run(current ? 'alice' : 'old-user', 'secret');
  sql.prepare('INSERT INTO _fm_passkeys VALUES (?,?)').run(current ? 'current-key' : 'old-key', 'alice');
  sql.prepare('INSERT INTO _fm_recovery_codes VALUES (?,?)').run('alice', current ? 'unused-current' : 'consumed-history');
  sql.prepare('INSERT INTO _fm_meta VALUES (?,?)').run('scim', JSON.stringify({ tokenHash: current ? 'rotated' : 'revoked', active: true }));
  sql.close();
}

test('restore reconciliation carries current credentials, password and SCIM state into copies, replacements and offline targets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-credentials-'));
  try {
    const source = join(dir, 'current.sqlite');
    db(source, true);
    for (const mode of ['copy', 'replace', 'offline']) {
      const restored = join(dir, `${mode}.sqlite`);
      db(restored, false);
      retainCurrentCredentials(source, restored);
      const sql = new DatabaseSync(restored, { readOnly: true });
      assert.equal((sql.prepare("SELECT password_hash FROM _fm_accounts WHERE name='alice'").get() as { password_hash: string }).password_hash, 'new-password');
      assert.equal((sql.prepare("SELECT password_hash FROM _fm_accounts WHERE name='gone'").get() as { password_hash: string | null }).password_hash, null, 'backup-only identity does not gain a current password credential');
      assert.equal((sql.prepare('SELECT id FROM _fm_api_tokens').get() as { id: string }).id, 'current');
      assert.equal((sql.prepare("SELECT json FROM _fm_meta WHERE key='scim'").get() as { json: string }).json.includes('rotated'), true);
      sql.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a restored file that was never opened by a store still takes the current credential tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-never-opened-'));
  try {
    const source = join(dir, 'current.sqlite');
    const restored = join(dir, 'restored.sqlite');
    db(source, true);
    new DatabaseSync(restored).exec('CREATE TABLE _fm_accounts(name TEXT PRIMARY KEY, password_hash TEXT); CREATE TABLE _fm_meta(key TEXT PRIMARY KEY, json TEXT)');
    retainCurrentCredentials(source, restored);
    const sql = new DatabaseSync(restored, { readOnly: true });
    assert.equal((sql.prepare('SELECT id FROM _fm_api_tokens').get() as { id: string }).id, 'current');
    assert.equal((sql.prepare('SELECT id FROM _fm_passkeys').get() as { id: string }).id, 'current-key');
    sql.close();
    // Nothing to carry forward when the current file never had the tables either.
    const bare = join(dir, 'bare.sqlite');
    const other = join(dir, 'other.sqlite');
    new DatabaseSync(bare).exec('CREATE TABLE _fm_accounts(name TEXT PRIMARY KEY, password_hash TEXT); CREATE TABLE _fm_meta(key TEXT PRIMARY KEY, json TEXT)');
    new DatabaseSync(other).exec('CREATE TABLE _fm_accounts(name TEXT PRIMARY KEY, password_hash TEXT); CREATE TABLE _fm_meta(key TEXT PRIMARY KEY, json TEXT)');
    retainCurrentCredentials(bare, other);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('restore reconciliation invalidates credentials without a current source and refuses missing tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-fail-closed-'));
  try {
    const incomplete = join(dir, 'incomplete.sqlite');
    const source = join(dir, 'source.sqlite');
    db(source, true);
    db(incomplete, false);
    retainCurrentCredentials(join(dir, 'absent.sqlite'), incomplete);
    const invalidated = new DatabaseSync(incomplete, { readOnly: true });
    assert.equal((invalidated.prepare("SELECT password_hash FROM _fm_accounts WHERE name='alice'").get() as { password_hash: string | null }).password_hash, null);
    assert.equal(invalidated.prepare('SELECT * FROM _fm_api_tokens').all().length, 0);
    assert.equal(invalidated.prepare("SELECT json FROM _fm_meta WHERE key='scim'").get(), undefined);
    invalidated.close();
    const noTables = join(dir, 'no-tables.sqlite');
    new DatabaseSync(noTables).close();
    assert.throws(() => retainCurrentCredentials(source, noTables), /cannot reconcile credential table/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a restore keeps what the current file required since the backup, and brings back whether an account is on as it was', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-restrictions-'));
  try {
    const make = (path: string, rows: [string, number, number, number][]) => {
      const sql = new DatabaseSync(path);
      sql.exec(`CREATE TABLE _fm_accounts(name TEXT PRIMARY KEY, password_hash TEXT, inactive INTEGER NOT NULL DEFAULT 0, require_2fa INTEGER NOT NULL DEFAULT 0, local_only INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE _fm_meta(key TEXT PRIMARY KEY, json TEXT);`);
      for (const [name, inactive, twoFactor, local] of rows) sql.prepare('INSERT INTO _fm_accounts VALUES (?,?,?,?,?)').run(name, 'hash', inactive, twoFactor, local);
      sql.close();
    };
    const current = join(dir, 'current.sqlite');
    const restored = join(dir, 'restored.sqlite');
    // Since the backup: emp was deactivated, boss now needs a second factor, kiosk is local only, and lifted had its restrictions lifted.
    make(current, [['emp', 1, 0, 0], ['boss', 0, 1, 0], ['kiosk', 0, 0, 1], ['lifted', 0, 0, 0]]);
    make(restored, [['emp', 0, 0, 0], ['boss', 0, 0, 0], ['kiosk', 0, 0, 0], ['lifted', 1, 1, 1]]);
    retainCurrentCredentials(current, restored);
    const sql = new DatabaseSync(restored, { readOnly: true });
    const row = (name: string) => sql.prepare('SELECT inactive, require_2fa, local_only FROM _fm_accounts WHERE name = ?').get(name);
    assert.deepEqual({ ...(row('emp') as object) }, { inactive: 0, require_2fa: 0, local_only: 0 }, 'whether an account is switched off is point-in-time data, as for the other restores: emp is on again');
    assert.deepEqual({ ...(row('boss') as object) }, { inactive: 0, require_2fa: 1, local_only: 0 });
    assert.deepEqual({ ...(row('kiosk') as object) }, { inactive: 0, require_2fa: 0, local_only: 1 });
    assert.deepEqual({ ...(row('lifted') as object) }, { inactive: 1, require_2fa: 1, local_only: 1 }, 'the backup\'s own restrictions stay');
    sql.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an empty current file (what a crash or a sync tool leaves) counts as absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-empty-'));
  try {
    const empty = join(dir, 'empty.sqlite');
    writeFileSync(empty, '');
    const restored = join(dir, 'restored.sqlite');
    db(restored, false);
    retainCurrentCredentials(empty, restored);
    const sql = new DatabaseSync(restored, { readOnly: true });
    assert.equal((sql.prepare("SELECT password_hash FROM _fm_accounts WHERE name='alice'").get() as { password_hash: string | null }).password_hash, null, 'no password survives');
    assert.equal(sql.prepare('SELECT * FROM _fm_api_tokens').all().length, 0);
    sql.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a current file with its first page or its table pages destroyed counts as absent, like an empty one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-damaged-live-'));
  try {
    const zero = (path: string, at: number) => {
      const fd = openSync(path, 'r+');
      try { writeSync(fd, Buffer.alloc(4096), 0, 4096, at); } finally { closeSync(fd); }
    };
    // The first page lost: the file is no longer a database at all (a failing disk, a cut-short copy). Or its second page,
    // where these small tables live.
    const damages: [string, (path: string) => void][] = [['first page zeroed', (p) => zero(p, 0)], ['table pages zeroed', (p) => zero(p, 4096)]];
    for (const [what, damage] of damages) {
      const source = join(dir, 'current.sqlite');
      rmSync(source, { force: true });
      db(source, true);
      damage(source);
      const restored = join(dir, 'restored.sqlite');
      rmSync(restored, { force: true });
      db(restored, false);
      retainCurrentCredentials(source, restored);
      const sql = new DatabaseSync(restored, { readOnly: true });
      assert.deepEqual(sql.prepare('SELECT name, password_hash FROM _fm_accounts ORDER BY name').all().map((r) => ({ ...r })), [{ name: 'alice', password_hash: null }, { name: 'gone', password_hash: null }], `${what}: no account keeps a password`);
      for (const table of ['_fm_api_tokens', '_fm_totp', '_fm_passkeys', '_fm_recovery_codes']) assert.equal((sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, `${what}: ${table} is empty`);
      assert.equal(sql.prepare("SELECT json FROM _fm_meta WHERE key = 'scim'").get(), undefined, `${what}: the SCIM token is gone`);
      sql.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('restore disables historical imported passwords when the account has no current credential', { skip: existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-imported-password-'));
  try {
    const current = join(dir, 'current.sqlite');
    importFmp12(fixture, current);
    ensureCredentialTables(current);
    let store = new Store(current);
    assert.equal(store.verify('Admin', '', ''), true, 'fixture Admin starts with its historical blank password');
    store.setPassword('Admin', 'historical-nonblank');
    assert.equal(store.verify('Admin', 'historical-nonblank', ''), true);
    store.close();
    const currentWithAccount = join(dir, 'current-with-account.sqlite');
    importFmp12(fixture, currentWithAccount);
    ensureCredentialTables(currentWithAccount);
    store = new Store(currentWithAccount);
    store.setPassword('Admin', 'current-password');
    store.close();

    for (const mode of ['missing-source', 'deleted-current']) {
      const restored = join(dir, `${mode}.sqlite`);
      importFmp12(fixture, restored);
      ensureCredentialTables(restored);
      const historical = new Store(restored);
      historical.setPassword('Admin', 'historical-nonblank');
      historical.close();
      if (mode === 'deleted-current') {
        const authoritative = new Store(current);
        authoritative.sql.prepare("DELETE FROM _fm_accounts WHERE name='Admin' COLLATE NOCASE").run();
        authoritative.close();
      }
      retainCurrentCredentials(mode === 'missing-source' ? join(dir, 'absent.sqlite') : current, restored);
      store = new Store(restored);
      assert.equal(store.verify('Admin', '', ''), false, `${mode}: historical blank password is refused`);
      assert.equal(store.verify('Admin', 'historical-nonblank', ''), false, `${mode}: historical non-blank password is refused`);
      store.close();
    }

    // When Admin remains authoritative, the current Tabularius password wins.
    const restored = join(dir, 'current-account.sqlite');
    importFmp12(fixture, restored);
    ensureCredentialTables(restored);
    retainCurrentCredentials(currentWithAccount, restored);
    store = new Store(restored);
    assert.equal(store.verify('Admin', 'current-password', ''), true);
    assert.equal(store.verify('Admin', 'historical-nonblank', ''), false);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a restore across file formats keeps the columns only the current file has, and refuses ones it cannot judge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-formats-'));
  try {
    const make = (path: string, format: number, tokenColumns: string, accountColumns: string, token: unknown[], account: unknown[]) => {
      const sql = new DatabaseSync(path);
      sql.exec(`CREATE TABLE _fm_accounts(name TEXT PRIMARY KEY, password_hash TEXT${accountColumns});
        CREATE TABLE _fm_api_tokens(id TEXT PRIMARY KEY, token_hash TEXT${tokenColumns});
        CREATE TABLE _fm_totp(account TEXT PRIMARY KEY, secret TEXT);
        CREATE TABLE _fm_passkeys(id TEXT PRIMARY KEY, account TEXT);
        CREATE TABLE _fm_recovery_codes(account TEXT, code_hash TEXT);
        CREATE TABLE _fm_meta(key TEXT PRIMARY KEY, json TEXT);`);
      sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?)").run(JSON.stringify(format));
      sql.prepare(`INSERT INTO _fm_accounts VALUES (${account.map(() => '?').join(',')})`).run(...account as string[]);
      sql.prepare(`INSERT INTO _fm_api_tokens VALUES (${token.map(() => '?').join(',')})`).run(...token as string[]);
      sql.close();
    };
    // The current file is in a format that gave tokens an expiry and accounts a sign-in block; the backup is from before.
    const current = join(dir, 'current.sqlite');
    make(current, 1, ', expires TEXT', ', blocked INTEGER NOT NULL DEFAULT 0', ['live', 'h', '2030-01-01'], ['alice', 'hash', 1]);
    const older = join(dir, 'older.sqlite');
    make(older, 0, '', '', ['old', 'h'], ['alice', 'oldhash']);
    retainCurrentCredentials(current, older);
    const sql = new DatabaseSync(older, { readOnly: true });
    assert.deepEqual({ ...(sql.prepare('SELECT id, expires FROM _fm_api_tokens').get() as object) }, { id: 'live', expires: '2030-01-01' }, 'the expiry survives');
    assert.equal((sql.prepare("SELECT blocked FROM _fm_accounts WHERE name = 'alice'").get() as { blocked: number }).blocked, 1, 'the block survives');
    sql.close();
    // A backup with a column the current file lacks cannot be judged.
    const newer = join(dir, 'newer.sqlite');
    make(newer, 1, ', note TEXT', '', ['x', 'h', 'n'], ['alice', 'h']);
    const plain = join(dir, 'plain.sqlite');
    make(plain, 0, '', '', ['live', 'h'], ['alice', 'h']);
    assert.throws(() => retainCurrentCredentials(plain, newer), /across file formats.*"note"/);
    // A backup from a newer build than this one is refused rather than left closed.
    const future = join(dir, 'future.sqlite');
    make(future, 999, '', '', ['x', 'h'], ['alice', 'h']);
    assert.throws(() => retainCurrentCredentials(plain, future), /newer Tabularius/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
