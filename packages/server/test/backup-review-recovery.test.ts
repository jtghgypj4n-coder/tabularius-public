import './backup-review-guard.ts';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { claimFolder } from '../src/backup.ts';
import { commitRestore, recoverRestore } from '../src/restore-files.ts';
import { writeDurable, syncPath } from '../../store/src/durable.ts';
import { watchDatabase, DiskTrouble, FileDamaged, type DamageWatch } from '../../store/src/damage.ts';
import { pageCheck } from '../src/backup-verify.ts';

function folder(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), 'tabularius-review-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function child(code: string, status = 73) {
  const result = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, status, result.stderr || String(result.error));
}
const restoreURL = new URL('../src/restore-files.ts', import.meta.url).href;
const durableURL = new URL('../../store/src/durable.ts', import.meta.url).href;
const backupURL = new URL('../src/backup.ts', import.meta.url).href;
const crashURL = new URL('../../store/src/crash-point.ts', import.meta.url).href;

for (const point of ['restore:after-save', 'restore:after-publish']) {
  test(`Unicode batch survives ${point} followed by a second kill during rollback`, (t) => {
    const root = folder(t);
    const names = ['État 🧪.openhbam.sqlite', 'État 🧪.openhbam.sqlite-wal', 'Files/e\u0301'];
    const files = names.map((name, i) => {
      const target = join(root, name);
      fs.mkdirSync(join(root, 'Files'), { recursive: true });
      if (i === 2) {
        fs.mkdirSync(target); fs.mkdirSync(target + '.restoring');
        fs.writeFileSync(join(target, 'data'), 'old');
        fs.writeFileSync(join(target + '.restoring', 'data'), 'new');
      } else {
        fs.writeFileSync(target, 'old');
        fs.writeFileSync(target + '.restoring', 'new');
      }
      return { target, staged: target + '.restoring' };
    });
    child(`import { commitRestore } from ${JSON.stringify(restoreURL)};
      import { armCrashPointForTest } from ${JSON.stringify(crashURL)};
      armCrashPointForTest(${JSON.stringify(point)}, 3);
      commitRestore(${JSON.stringify(root)}, ${JSON.stringify(files)});`);
    child(`import { recoverRestore } from ${JSON.stringify(restoreURL)};
      import { writeDurable } from ${JSON.stringify(durableURL)};
      recoverRestore(${JSON.stringify(root)}, (from, to) => { writeDurable(from, to); process.exit(73); });`);
    for (let repeat = 0; repeat < 2; repeat++) {
      claimFolder(root)();
      files.forEach(({ target }, i) => assert.equal(fs.readFileSync(i === 2 ? join(target, 'data') : target, 'utf8'), 'old'));
    }
    assert.equal(fs.existsSync(join(root, '.restore-journal.json')), false);
  });
}

for (const code of ['ENOSPC', 'EACCES']) {
  test(`restore ${code} on the second replacement rolls back the first and its WAL`, (t) => {
    const root = folder(t);
    const files = ['one', 'one-wal', 'two'].map((name) => {
      const target = join(root, name);
      fs.writeFileSync(target, 'old');
      if (name !== 'one-wal') fs.writeFileSync(target + '.restoring', 'new');
      return { target, ...(name !== 'one-wal' ? { staged: target + '.restoring' } : {}) };
    });
    assert.throws(() => commitRestore(root, files, (from, to) => {
      if (from === files[2].staged) throw Object.assign(new Error('publication refused'), { code });
      writeDurable(from, to);
    }), /publication refused/);
    for (const { target } of files) assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    recoverRestore(root);
    assert.equal(fs.existsSync(join(root, '.restore-journal.json')), false);
  });
}

test('two processes claiming a Unicode folder through different aliases have exactly one owner', { timeout: 30_000 }, async (t) => {
  const root = folder(t);
  const live = join(root, 'données'); const alias = join(root, 'alias');
  fs.mkdirSync(live);
  fs.symlinkSync(live, alias, 'junction');
  const children = [live, alias].map((dir, i) => spawn(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
    import { claimFolder } from ${JSON.stringify(backupURL)};
    let release;
    process.on('message', (message) => {
      if (message === 'claim') {
        try { release = claimFolder(${JSON.stringify(dir)}, ${JSON.stringify(i ? 'restore' : 'server')}); process.send({ claimed: true }); }
        catch { process.send({ claimed: false }); }
      } else { release?.(); process.exit(0); }
    });
    process.send({ ready: true });
  `], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }));
  t.after(async () => {
    await Promise.all(children.map(async (c) => {
      if (c.exitCode !== null || c.signalCode !== null) return;
      const exited = once(c, 'exit'); c.kill(); await exited;
    }));
  });
  await Promise.all(children.map((c) => once(c, 'message')));
  const replies = children.map((c) => once(c, 'message'));
  for (const c of children) c.send('claim');
  const claims = await Promise.all(replies);
  assert.equal(claims.filter(([r]) => r.claimed).length, 1);
  const owner = children[claims.findIndex(([r]) => r.claimed)];
  const exited = once(owner, 'exit'); owner.kill('SIGKILL'); await exited;
  // The dead owner's pid and SQLite claim lock are recoverable immediately.
  claimFolder(alias, 'restore')();
});

test('a real SQLite page limit rolls back a multi-statement write without poisoning the store', (t) => {
  const path = join(folder(t), 'full.sqlite');
  const raw = new DatabaseSync(path);
  raw.exec('CREATE TABLE data(value BLOB); PRAGMA max_page_count = 5');
  const watch: DamageWatch = {};
  const db = watchDatabase(raw, 'synthetic', watch);
  try {
    db.exec('BEGIN; INSERT INTO data VALUES (zeroblob(16))');
    assert.throws(() => db.exec('INSERT INTO data VALUES (zeroblob(100000))'), DiskTrouble);
    if (db.isTransaction) db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT count(*) AS n FROM data').get()!.n, 0);
    assert.equal(watch.damage, undefined);
    db.exec('INSERT INTO data VALUES (zeroblob(8))');
    assert.equal(pageCheck(path).state, 'ok');
  } finally { db.close(); }
});

test('read-only integrity checking reports permissions as unreadable, never corruption', { skip: process.getuid?.() === 0 || process.platform === 'win32' }, (t) => {
  const path = join(folder(t), 'permission.sqlite');
  const db = new DatabaseSync(path); db.exec('CREATE TABLE data(value)'); db.close();
  fs.chmodSync(path, 0);
  try { assert.equal(pageCheck(path).state, 'unreadable'); }
  finally { fs.chmodSync(path, 0o600); }
  assert.equal(pageCheck(path).state, 'ok');
});

test('integrity read errors poison subsequent operations but SQLITE_FULL does not', (t) => {
  const db = new DatabaseSync(join(folder(t), 'read-error.sqlite'));
  const watch: DamageWatch = {};
  t.mock.method(db, 'exec', () => { throw Object.assign(new Error('synthetic short read'), { errcode: 522 }); });
  watchDatabase(db, 'synthetic', watch);
  try {
    assert.throws(() => db.exec('SELECT 1'), FileDamaged);
    assert.throws(() => db.prepare('SELECT 1'), FileDamaged);
    assert.ok(watch.damage);
  } finally { db.close(); }
});

test('directory fsync fallback is platform-specific and never hides a file flush failure', () => {
  let opens = 0;
  const disk = {
    statSync: (path: string) => ({ isDirectory: () => path === 'dir' }),
    openSync: () => { opens++; throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
    closeSync: () => {}, fsyncSync: () => {}, renameSync: () => {},
  };
  syncPath('dir', disk, 'win32'); assert.equal(opens, 0);
  syncPath('dir', disk, 'linux'); assert.equal(opens, 1);
  for (const platform of ['win32', 'darwin', 'linux'] as const) assert.throws(() => syncPath('file', disk, platform), /denied/);
});
