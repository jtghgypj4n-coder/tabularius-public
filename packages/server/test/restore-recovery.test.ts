import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../store/src/index.ts';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { backupFolder, claimFolder, restoreAt, restoreBackup, runningServer, sweepCrashLeftovers } from '../src/backup.ts';
import { commitRestore, recoverRestore } from '../src/restore-files.ts';
import { atomicWrite, writeDurable } from '../../store/src/durable.ts';

const journalName = '.restore-journal.json';
const targets = ['A.openhbam.sqlite', 'A.openhbam.sqlite-wal', 'B.openhbam.sqlite', 'Files/A', 'New.openhbam.sqlite'];

/** Starts claimant processes that claim on each "claim" line and release on each "release" line. */
async function claimants(t: { after(fn: () => unknown): void }, folder: string, count: number) {
  const code = `
    import { createInterface } from 'node:readline';
    import { claimFolder } from ${JSON.stringify(new URL('../src/backup.ts', import.meta.url).href)};
    let release;
    console.log(JSON.stringify({ type: 'ready' }));
    for await (const line of createInterface({ input: process.stdin })) {
      if (line === 'claim') {
        let error;
        try { release = claimFolder(${JSON.stringify(folder)}); }
        catch (caught) { error = String(caught); }
        console.log(JSON.stringify({ type: 'result', pid: process.pid, claimed: Boolean(release), error }));
      } else {
        release?.();
        release = undefined;
        console.log(JSON.stringify({ type: 'released' }));
      }
    }
  `;
  const children = Array.from({ length: count }, () => spawn(process.execPath, ['--input-type=module', '--eval', code], { stdio: ['pipe', 'pipe', 'inherit'] }));
  t.after(() => Promise.all(children.map(async (child) => {
    child.stdin.end();
    if (child.exitCode === null) await once(child, 'exit');
  })));
  const lines = children.map((child) => createInterface({ input: child.stdout })[Symbol.asyncIterator]());
  const next = () => Promise.all(lines.map(async (line) => JSON.parse((await line.next()).value)));
  await next();
  return {
    pids: children.map((child) => child.pid),
    async send(message: string) {
      const replies = next();
      for (const child of children) child.stdin.write(message + '\n');
      return replies;
    },
  };
}

test('two claimant processes racing a stale pid leave exactly one owner each time', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'restore-claim-race-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const pair = await claimants(t, folder, 2);
  for (let round = 1; round <= 30; round++) {
    // Even rounds race on an empty folder, odd ones on a stale pid file.
    if (round % 2) writeFileSync(join(folder, '.openhbam.pid'), '99999999');
    const claims = await pair.send('claim');
    const winners = claims.filter((result) => result.claimed);
    assert.equal(winners.length, 1, `round ${round}: ${JSON.stringify(claims)}`);
    assert.match(claims.find((result) => !result.claimed).error, /already hosted/);
    assert.equal(readFileSync(join(folder, '.openhbam.pid'), 'utf8'), String(winners[0].pid));
    await pair.send('release');
    assert.equal(existsSync(join(folder, '.openhbam.pid')), false);
  }
});

test('a pid file naming our own pid is left from a restart and does not block startup', (t) => {
  // In a container the server is always pid 1, so the previous run's file names us.
  const folder = mkdtempSync(join(tmpdir(), 'restore-claim-own-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, '.openhbam.pid'), String(process.pid));
  const release = claimFolder(folder);
  assert.equal(readFileSync(join(folder, '.openhbam.pid'), 'utf8'), String(process.pid));
  release();
  assert.equal(existsSync(join(folder, '.openhbam.pid')), false);
});

test('release leaves a pid file it did not publish alone', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'restore-claim-foreign-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const pid = join(folder, '.openhbam.pid');
  const release = claimFolder(folder);
  // Another process took the folder over (here: a different pid replaced ours).
  rmSync(pid);
  writeFileSync(pid, String(process.ppid));
  release();
  assert.equal(readFileSync(pid, 'utf8'), String(process.ppid));
  // A same-content file that replaced ours is not ours either.
  rmSync(pid);
  const again = claimFolder(folder);
  const copy = pid + '.copy';
  writeFileSync(copy, String(process.pid));
  renameSync(copy, pid);
  again();
  assert.equal(readFileSync(pid, 'utf8'), String(process.pid));
});

function setup(t: { after(fn: () => void): void }): string {
  const folder = mkdtempSync(join(tmpdir(), 'restore-recovery-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, 'Files', 'A'), { recursive: true });
  mkdirSync(join(folder, 'Files', 'A.restoring'));
  for (const name of targets) {
    if (name !== 'New.openhbam.sqlite') writeFileSync(join(folder, name, ...(name === 'Files/A' ? ['data'] : [])), 'old');
    if (!name.endsWith('-wal')) writeFileSync(join(folder, name + '.restoring', ...(name === 'Files/A' ? ['data'] : [])), 'new');
  }
  return folder;
}

/** Exit in the injected rename itself, without running catch/finally or directory fsync. */
function crash(folder: string, after: number, recovery = false, names = targets): void {
  const code = `
    import * as fs from 'node:fs';
    import { join } from 'node:path';
    import { commitRestore, recoverRestore } from ${JSON.stringify(new URL('../src/restore-files.ts', import.meta.url).href)};
    import { writeDurable } from ${JSON.stringify(new URL('../../store/src/durable.ts', import.meta.url).href)};
    const folder = ${JSON.stringify(folder)};
    let renames = 0;
    const publish = (from, to) => writeDurable(from, to, {
      ...fs,
      renameSync(from, to) {
        if (${after} === 0) process.exit(73);
        fs.renameSync(from, to);
        if (++renames === ${after}) process.exit(73);
      },
    });
    ${recovery ? 'recoverRestore(folder, publish);' : `commitRestore(folder, ${JSON.stringify(names)}.map(name => ({
      target: join(folder, name),
      staged: name.endsWith('-wal') ? undefined : join(folder, name + '.restoring'),
    })), publish);`}
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr || String(child.error));
  assert.ok(existsSync(join(folder, journalName)));
}

function assertOld(folder: string): void {
  for (const name of targets) {
    if (name === 'New.openhbam.sqlite') assert.equal(existsSync(join(folder, name)), false);
    else assert.equal(readFileSync(join(folder, name, ...(name === 'Files/A' ? ['data'] : [])), 'utf8'), 'old');
  }
  assert.equal(existsSync(join(folder, journalName)), false);
  assert.ok(!readdirSync(folder, { recursive: true }).some((name) => String(name).includes('.restore-previous-')));
}

for (let after = 0; after <= 8; after++) {
  test(`startup rolls back a process exit after ${after} restore renames`, (t) => {
    const folder = setup(t);
    crash(folder, after);
    const journal = JSON.parse(readFileSync(join(folder, journalName), 'utf8'));
    assert.equal(journal.files.length, targets.length);
    assert.equal(journal.phase, 'pending');
    writeFileSync(join(folder, '.openhbam.pid'), String(process.ppid));
    assert.deepEqual(sweepCrashLeftovers(folder), []);
    assert.ok(existsSync(join(folder, journalName)), 'another server prevents recovery');
    rmSync(join(folder, '.openhbam.pid'));
    claimFolder(folder)();
    assertOld(folder);
    claimFolder(folder)();
    assertOld(folder);
  });
}

for (let after = 1; after <= 4; after++) {
  test(`startup resumes rollback after a second exit at recovery rename ${after}`, (t) => {
    const folder = setup(t);
    crash(folder, 8);
    crash(folder, after, true);
    claimFolder(folder)();
    assertOld(folder);
  });
}

test('startup finishes cleanup of a committed restore without rolling it back', (t) => {
  const folder = setup(t);
  crash(folder, 8);
  const path = join(folder, journalName);
  const journal = JSON.parse(readFileSync(path, 'utf8'));
  journal.phase = 'committed';
  atomicWrite(path, JSON.stringify(journal));
  // Simulate a crash partway through deleting the old versions.
  rmSync(join(folder, journal.files[0].saved));
  claimFolder(folder)();
  for (const name of targets) {
    if (name.endsWith('-wal')) assert.equal(existsSync(join(folder, name)), false);
    else assert.equal(readFileSync(join(folder, name, ...(name === 'Files/A' ? ['data'] : [])), 'utf8'), 'new');
  }
  assert.equal(existsSync(path), false);
  assert.ok(!readdirSync(folder, { recursive: true }).some((name) => String(name).includes('.restore-previous-')));
});

test('a corrupt journal blocks startup and preserves live data and evidence', (t) => {
  const folder = setup(t);
  crash(folder, 1);
  const path = join(folder, journalName);
  const journal = JSON.parse(readFileSync(path, 'utf8'));
  journal.files[1].target = '../outside';
  const content = JSON.stringify(journal);
  writeFileSync(path, content);
  assert.throws(() => claimFolder(folder), /restore journal/);
  assert.equal(readFileSync(path, 'utf8'), content);
  assert.ok(existsSync(join(folder, journal.files[0].saved)));
  assert.equal(existsSync(join(folder, '.openhbam.pid')), false);
  assert.throws(() => recoverRestore(folder), /restore journal/);
});

test('an active restore claim blocks startup and protects its pending journal', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'restore-claim-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const set = join(root, 'set');
  mkdirSync(folder); mkdirSync(set);
  const name = 'A.openhbam.sqlite';
  createStore(join(folder, name));
  createStore(join(set, name));

  const restoring = restoreBackup(folder, set);
  assert.equal(runningServer(folder), process.pid);
  assert.throws(() => claimFolder(folder), /already hosted/);

  const target = join(folder, 'probe');
  const staged = target + '.restoring';
  writeFileSync(target, 'old');
  writeFileSync(staged, 'new');
  commitRestore(folder, [{ target, staged }], (from, to) => {
    writeDurable(from, to);
    if (from === target) {
      assert.ok(existsSync(join(folder, journalName)));
      assert.deepEqual(sweepCrashLeftovers(folder), []);
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import { claimFolder, sweepCrashLeftovers } from ${JSON.stringify(new URL('../src/backup.ts', import.meta.url).href)};
        const folder = ${JSON.stringify(folder)};
        try {
          claimFolder(folder);
          throw new Error('server claim unexpectedly succeeded');
        } catch (error) {
          if (!/already hosted/.test(String(error))) throw error;
        }
        if (sweepCrashLeftovers(folder).length) throw new Error('recovery touched an active restore');
      `], { encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr || String(child.error));
      assert.ok(existsSync(join(folder, journalName)), 'recovery leaves the active restore journal alone');
      assert.equal(existsSync(target), false);
      assert.equal(readFileSync(to, 'utf8'), 'old');
    }
  });
  assert.deepEqual(await restoring, [name]);
  assert.equal(runningServer(folder), undefined);
  assert.equal(readFileSync(target, 'utf8'), 'new');

  const { serve } = await import('../src/index.ts');
  const { server, host } = await serve({ dir: folder, port: 0, watch: false, log: () => {} });
  try {
    assert.ok(host.get('A'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});


test('server startup recovers before opening hosted databases', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'restore-startup-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const name = 'A.openhbam.sqlite';
  for (const suffix of ['', '.restoring']) {
    const path = join(folder, name + suffix);
    createStore(path);
    const db = new DatabaseSync(path);
    try {
      db.exec('CREATE TABLE restore_marker (value TEXT)');
      db.prepare('INSERT INTO restore_marker VALUES (?)').run(suffix ? 'new' : 'old');
    } finally { db.close(); }
  }
  crash(folder, 1, false, [name]);
  assert.equal(existsSync(join(folder, name)), false);
  const { serve } = await import('../src/index.ts');
  const { server, host } = await serve({ dir: folder, port: 0, watch: false, log: () => {} });
  try {
    assert.equal(host.get('A')?.sql.prepare('SELECT value FROM restore_marker').get()?.value, 'old');
    assert.equal(existsSync(join(folder, journalName)), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('a restore is not refused by a stale pid file naming our own pid', async (t) => {
  // A container's restore runs as the same pid as the server whose unclean stop left the file.
  const root = mkdtempSync(join(tmpdir(), 'restore-own-pid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const set = join(root, 'set');
  mkdirSync(folder); mkdirSync(set);
  createStore(join(folder, 'A.openhbam.sqlite'));
  createStore(join(set, 'A.openhbam.sqlite'));
  writeFileSync(join(folder, '.openhbam.pid'), String(process.pid));
  assert.deepEqual(await restoreBackup(folder, set), ['A.openhbam.sqlite']);
  assert.equal(existsSync(join(folder, '.openhbam.pid')), false);
});

test('a point-in-time restore holds the folder claim until it finishes', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'restore-at-claim-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const dest = join(root, 'Backups');
  mkdirSync(folder);
  createStore(join(folder, 'A.openhbam.sqlite'));
  await backupFolder(folder, dest);
  const restoring = restoreAt(folder, dest, Date.now(), 'A');
  assert.equal(runningServer(folder), process.pid);
  assert.throws(() => claimFolder(folder), /already hosted/);
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { claimFolder } from ${JSON.stringify(new URL('../src/backup.ts', import.meta.url).href)};
    try {
      claimFolder(${JSON.stringify(folder)});
      throw new Error('server claim unexpectedly succeeded');
    } catch (error) {
      if (!/already hosted/.test(String(error))) throw error;
    }
  `], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || String(child.error));
  assert.equal((await restoring).length, 1);
  assert.equal(runningServer(folder), undefined);
  // Released on failure too.
  await assert.rejects(restoreAt(folder, dest, Date.now() - 3_600_000, 'A'), /no backup of A from before/);
  assert.equal(runningServer(folder), undefined);
  claimFolder(folder)();
});

test('a claim through a symlink alias is the same folder as the held claim', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'restore-claim-alias-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const alias = join(root, 'alias');
  mkdirSync(folder);
  symlinkSync(folder, alias);
  const release = claimFolder(folder, 'restore');
  try {
    assert.throws(() => claimFolder(alias), /already hosted/);
    writeFileSync(join(folder, journalName), '{}');
    assert.deepEqual(sweepCrashLeftovers(alias), [], 'recovery through the alias leaves the active restore alone');
    assert.ok(existsSync(join(folder, journalName)));
    rmSync(join(folder, journalName));
  } finally {
    release();
  }
  assert.equal(existsSync(join(folder, '.openhbam.pid')), false);
});

test('a read-only claim database refuses the claim, since it could not lock anyone out', { skip: process.getuid?.() === 0 }, () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-ro-claim-'));
  const lockPath = join(folder, '.openhbam-claim.sqlite');
  new DatabaseSync(lockPath).close();
  chmodSync(lockPath, 0o444);
  try {
    assert.throws(() => claimFolder(folder), (error: Error) => error.message.includes(lockPath) && /must be writable by the user running Tabularius/.test(error.message));
    assert.equal(existsSync(join(folder, '.openhbam.pid')), false);
  } finally {
    chmodSync(lockPath, 0o644);
    rmSync(folder, { recursive: true, force: true });
  }
});
