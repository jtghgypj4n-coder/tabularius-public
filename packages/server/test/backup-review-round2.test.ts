import './backup-review-guard.ts';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, STORE_FORMAT, StoreFormatError } from '../../store/src/index.ts';
import { AccountChangesError, accountDifferences, backupFolder, backupSets, claimFolder, restoreAt, restoreBackup, retainCurrentCredentials } from '../src/backup.ts';
import { pageCheck, testRestore, verifySet } from '../src/backup-verify.ts';

const file = 'Données 🧪.openhbam.sqlite';
function setup(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), 'tabularius-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const live = join(root, 'live');
  const dest = join(root, 'backups');
  fs.mkdirSync(live);
  const path = join(live, file);
  createStore(path);
  const store = new Store(path);
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value' }] }]);
  store.create('Items', { Value: 'before' });
  store.close();
  return { root, live, dest, path };
}
function edit(path: string, action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(path);
  try { action(db); } finally { db.close(); }
}

for (const route of ['set', 'point'] as const) {
  test(`account difference refusal preserves distinct Unicode accounts through ${route} restore`, async (t) => {
    const { live, dest, path } = setup(t);
    // Legacy/imported accounts can have names that SQLite NOCASE keeps distinct.
    edit(path, (db) => {
      for (const name of ['Éva', 'éva']) db.prepare("INSERT INTO _fm_accounts(name,password_hash,source,inactive) VALUES (?,NULL,'local',0)").run(name);
    });
    const set = (await backupFolder(live, dest, 0, '')).dir;
    edit(path, (db) => db.prepare('UPDATE _fm_accounts SET inactive = 1 WHERE name = ?').run('Éva'));
    const before = fs.readFileSync(path);
    const options = { refuseAccountChanges: true };
    await assert.rejects(route === 'set' ? restoreBackup(live, set, undefined, '', options) : restoreAt(live, dest, Date.now() + 1000, undefined, '', options), (error: unknown) => {
      assert.ok(error instanceof AccountChangesError);
      assert.deepEqual(error.differences.map((d) => d.name), ['Éva']);
      return true;
    });
    assert.deepEqual(fs.readFileSync(path), before);
    assert.equal(fs.existsSync(path + '.restoring'), false);
  });
}

test('ASCII case changes remain the same account, while composed and decomposed Unicode names remain distinct', (t) => {
  const { root, path } = setup(t);
  const staged = join(root, 'staged.sqlite');
  fs.copyFileSync(path, staged);
  edit(path, (db) => db.prepare("INSERT INTO _fm_accounts(name,source) VALUES (?, 'local')").run('ALICE'));
  edit(staged, (db) => db.prepare("INSERT INTO _fm_accounts(name,source) VALUES (?, 'local')").run('alice'));
  assert.deepEqual(accountDifferences(file, path, staged), []);
  edit(path, (db) => db.prepare("INSERT INTO _fm_accounts(name,source) VALUES (?, 'local')").run('É'));
  edit(staged, (db) => db.prepare("INSERT INTO _fm_accounts(name,source) VALUES (?, 'local')").run('E\u0301'));
  assert.equal(accountDifferences(file, path, staged).length, 2);
});

for (const when of ['before', 'during-staging'] as const) {
  test(`point-in-time restore respects cancellation ${when} and releases its claim`, async (t) => {
    const { live, dest, path } = setup(t);
    const second = join(live, 'Zeta.openhbam.sqlite');
    fs.copyFileSync(path, second);
    await backupFolder(live, dest, 0, '');
    const paths = [path, second];
    for (const p of paths) edit(p, (db) => db.exec("UPDATE Items SET Value = 'current'"));
    const before = paths.map((p) => fs.readFileSync(p));
    const controller = new AbortController();
    const reason = new Error('stop review restore');
    if (when === 'before') controller.abort(reason);
    else {
      const copy = fs.copyFileSync;
      const mocked = t.mock.method(fs, 'copyFileSync', (from: fs.PathLike, to: fs.PathLike, flags?: number) => {
        copy(from, to, flags);
        if (String(to) === second + '.restoring') controller.abort(reason);
      });
      syncBuiltinESMExports();
      t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
    }
    await assert.rejects(restoreAt(live, dest, Date.now() + 1000, undefined, '', { signal: controller.signal }), (error: unknown) => error === reason);
    paths.forEach((p, i) => {
      assert.deepEqual(fs.readFileSync(p), before[i]);
      assert.equal(fs.existsSync(p + '.restoring'), false);
    });
    claimFolder(live)();
  });
}

for (const code of ['ENOSPC', 'EACCES']) {
  test(`backup ${code} after copying preserves the previous set and permits retry`, async (t) => {
    const { live, dest, path } = setup(t);
    const first = (await backupFolder(live, dest, 1, '')).dir;
    const before = fs.readFileSync(join(first, file));
    const write = fs.writeFileSync;
    let hit = false;
    const mocked = t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
      if (String(args[0]).includes('.partial') && String(args[1]).includes('finished')) {
        hit = true;
        throw Object.assign(new Error('injected write failure'), { code });
      }
      return write(...args);
    });
    syncBuiltinESMExports();
    t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
    await assert.rejects(backupFolder(live, dest, 1, ''), /injected write failure/);
    assert.equal(hit, true);
    assert.deepEqual(fs.readFileSync(join(first, file)), before);
    assert.equal(backupSets(dest).length, 1);
    assert.equal(fs.readdirSync(dest).some((n) => n.endsWith('.partial')), false);
    mocked.mock.restore();
    syncBuiltinESMExports();
    assert.equal((await verifySet((await backupFolder(live, dest, 1, '')).dir)).ok, true);
    assert.equal(pageCheck(path).state, 'ok');
  });
}

test('queued backups with repeated and backward times publish distinct verified sets', async (t) => {
  const { live, dest } = setup(t);
  const now = Date.UTC(2026, 9, 18, 12);
  const results = await Promise.all([now, now, now - 86_400_000].map((at) => backupFolder(live, dest, 0, '', { now: () => at })));
  assert.equal(new Set(results.map((r) => r.dir)).size, 3);
  for (const result of results) assert.equal((await verifySet(result.dir)).ok, true);
});

test('format refusal handles unsafe integers and Unicode digits without modifying either file', (t) => {
  const { root, path } = setup(t);
  for (const value of ['9007199254740993', '"١"', '1e309']) {
    const staged = join(root, 'staged.sqlite');
    fs.copyFileSync(path, staged);
    edit(staged, (db) => db.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'storeFormat'").run(value));
    const before = fs.readFileSync(staged);
    assert.throws(() => retainCurrentCredentials(path, staged), StoreFormatError);
    assert.deepEqual(fs.readFileSync(staged), before);
  }
  edit(path, (db) => assert.equal(db.prepare("SELECT json FROM _fm_meta WHERE key = 'storeFormat'").get()!.json, String(STORE_FORMAT)));
});

test('cross-format credential reconciliation rolls back if a later table is incompatible', (t) => {
  const { root, path } = setup(t);
  const staged = join(root, 'staged.sqlite');
  fs.copyFileSync(path, staged);
  edit(staged, (db) => {
    db.prepare("UPDATE _fm_meta SET json = '0' WHERE key = 'storeFormat'").run();
    db.exec('ALTER TABLE _fm_recovery_codes ADD COLUMN future_guard TEXT');
    db.exec("INSERT INTO _fm_totp(account,secret,created) VALUES ('synthetic', 'old', '2026-01-01')");
  });
  const before = fs.readFileSync(staged);
  assert.throws(() => retainCurrentCredentials(path, staged), /cannot restore across file formats/);
  assert.deepEqual(fs.readFileSync(staged), before);
});

test('an empty generated store is identified by the test restore without claiming usable records', async (t) => {
  const { root } = setup(t);
  const empty = join(root, 'empty'); fs.mkdirSync(empty);
  createStore(join(empty, file));
  const result = await testRestore((await backupFolder(empty, join(root, 'empty-backups'), 0, '')).dir, '');
  assert.equal(result.ok, false);
  assert.match(String(result.files[file]), /no tables.*tabularius new/);
});
