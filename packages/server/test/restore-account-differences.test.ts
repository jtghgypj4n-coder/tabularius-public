// A restore lists the accounts that are not the same in the backup as in the file it replaces, and stops until that has been
// read (--accept-account-changes on the command line). What it lists is what a person would otherwise find out by surprise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, createStore } from '../../store/src/index.ts';
import { AccountChangesError, accountDifferences, backupFolder, restoreAt, restoreBackup, type AccountDifference } from '../src/backup.ts';

const FILE = 'People.openhbam.sqlite';

function folderWith(t: { after(fn: () => void): void }): { folder: string; set: string; file: string; edit: (fn: (sql: DatabaseSync) => void) => void } {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-restore-accounts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const set = join(root, 'backups');
  mkdirSync(folder);
  mkdirSync(set);
  const file = join(folder, FILE);
  createStore(file);
  const edit = (fn: (sql: DatabaseSync) => void) => {
    const store = new Store(file);
    try { fn(store.sql); } finally { store.close(); }
  };
  return { folder, set, file, edit };
}

const add = (sql: DatabaseSync, name: string, extra = '') =>
  sql.prepare(`INSERT INTO _fm_accounts (name, password_hash, source${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (?, 'x', 'local'${extra ? ', ' + extra.split('=')[1] : ''})`).run(name);

/** A folder with two accounts, backed up, and then changed: Bea is gone, Dev is new, Cal is switched off and Eli has another privilege set. */
async function changedSince(t: { after(fn: () => void): void }) {
  const f = folderWith(t);
  f.edit((sql) => { add(sql, 'Bea'); add(sql, 'Cal'); add(sql, 'Eli'); sql.prepare("UPDATE _fm_accounts SET privilege_set = 'Reader' WHERE name = 'Eli'").run(); });
  const backup = (await backupFolder(f.folder, f.set, 0)).dir;
  f.edit((sql) => {
    sql.prepare("DELETE FROM _fm_accounts WHERE name = 'Bea'").run();
    add(sql, 'Dev');
    sql.prepare("UPDATE _fm_accounts SET inactive = 1 WHERE name = 'Cal'").run();
    sql.prepare("UPDATE _fm_accounts SET privilege_set = 'Editor' WHERE name = 'Eli'").run();
  });
  return { ...f, backup };
}

const namesOf = (list: AccountDifference[]) => list.map((d) => d.name).sort();

test('every kind of difference is listed, and a restore that was asked to stop does so before replacing anything', async (t) => {
  const { folder, backup, file, edit } = await changedSince(t);
  const seen: AccountDifference[] = [];
  await assert.rejects(restoreBackup(folder, backup, undefined, '', { refuseAccountChanges: true, differences: seen }), (e: unknown) => {
    assert.ok(e instanceof AccountChangesError);
    assert.deepEqual(namesOf(e.differences), ['Bea', 'Cal', 'Dev', 'Eli']);
    return true;
  });
  assert.deepEqual(namesOf(seen), ['Bea', 'Cal', 'Dev', 'Eli'], 'the list is also filled in for a caller that wants it');
  const said = (name: string) => seen.find((d) => d.name === name)!.change;
  assert.match(said('Bea'), /was removed after the backup, so it is back/);
  assert.match(said('Dev'), /added since the backup, so it is gone/);
  assert.match(said('Cal'), /switched off now but was on in the backup/);
  assert.match(said('Eli'), /privilege set Editor now but Reader in the backup/);
  assert.ok(seen.every((d) => d.file === FILE));
  // Nothing was replaced: Dev is still there, Bea is still gone, and no staged copy was left behind.
  let names: string[] = [];
  edit((sql) => { names = (sql.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[]).map((r) => r.name); });
  assert.ok(names.includes('Dev') && !names.includes('Bea'));
  assert.equal(existsSync(file + '.restoring'), false);
});

test('with the changes accepted the restore goes ahead and still reports them', async (t) => {
  const { folder, backup, edit } = await changedSince(t);
  const seen: AccountDifference[] = [];
  const done = await restoreBackup(folder, backup, undefined, '', { refuseAccountChanges: false, differences: seen });
  assert.deepEqual(done, [FILE]);
  assert.deepEqual(namesOf(seen), ['Bea', 'Cal', 'Dev', 'Eli']);
  let names: string[] = [];
  edit((sql) => { names = (sql.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[]).map((r) => r.name); });
  assert.ok(names.includes('Bea') && !names.includes('Dev'), 'the backup\'s accounts are what is there');
});

test('a restore with no account differences is not stopped, and a caller who does not ask for the stop is not stopped either', async (t) => {
  const { folder, set, edit } = folderWith(t);
  edit((sql) => add(sql, 'Bea'));
  const backup = (await backupFolder(folder, set, 0)).dir;
  const seen: AccountDifference[] = [];
  assert.deepEqual(await restoreBackup(folder, backup, undefined, '', { refuseAccountChanges: true, differences: seen }), [FILE]);
  assert.deepEqual(seen, []);
  edit((sql) => add(sql, 'Dev'));
  assert.deepEqual(await restoreBackup(folder, backup), [FILE], 'the library default is the old behaviour');
});

test('a restore over a file whose accounts cannot be read, or into a new folder, has nothing to compare and is not stopped', async (t) => {
  const { folder, set, file } = folderWith(t);
  const backup = (await backupFolder(folder, set, 0)).dir;
  rmSync(file);
  assert.deepEqual(accountDifferences(FILE, file, file), [], 'no current file');
  assert.deepEqual(await restoreBackup(folder, backup, undefined, '', { refuseAccountChanges: true }), [FILE]);
});

test('a point-in-time restore lists the same differences and stops the same way', async (t) => {
  const f = folderWith(t);
  f.edit((sql) => add(sql, 'Bea'));
  await backupFolder(f.folder, f.set, 0);
  f.edit((sql) => { sql.prepare("DELETE FROM _fm_accounts WHERE name = 'Bea'").run(); });
  await assert.rejects(restoreAt(f.folder, f.set, Date.now() + 60_000, undefined, '', { refuseAccountChanges: true }), (e: unknown) => e instanceof AccountChangesError && namesOf(e.differences).join() === 'Bea');
  assert.equal(existsSync(f.file + '.restoring'), false);
  const seen: AccountDifference[] = [];
  await restoreAt(f.folder, f.set, Date.now() + 60_000, undefined, '', { refuseAccountChanges: false, differences: seen });
  assert.deepEqual(namesOf(seen), ['Bea']);
});
