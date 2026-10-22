import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { backupFolder, backupSets, claimFolder, restoreBackup, sweepCrashLeftovers } from '../src/backup.ts';
import { verifyExternal } from '../src/backup-external.ts';
import { commitRestore, recoverRestore } from '../src/restore-files.ts';

function setup(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), 'backup-write-fault-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const live = join(root, 'live');
  const backups = join(root, 'backups');
  fs.mkdirSync(join(live, 'Files/A'), { recursive: true });
  createStore(join(live, 'A.openhbam.sqlite'));
  const source = join(live, 'Files/A/data');
  fs.writeFileSync(source, 'original container');
  return { live, backups, source };
}

function hook(t: TestContext, method: 'copyFileSync' | 'writeFileSync', replacement: (...args: any[]) => any) {
  t.mock.method(fs, method, replacement);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

for (const fault of ['ENOSPC', 'truncated', 'corrupted', 'writer'] as const) {
  test(`backup refuses ${fault} during external copy and retains the previous set`, async (t) => {
    const { live, backups, source } = setup(t);
    const previous = await backupFolder(live, backups, 1, '');
    fs.writeFileSync(source, 'changed container, requiring a new copy');
    const copy = fs.copyFileSync;
    hook(t, 'copyFileSync', (from, to, flags) => {
      if (String(from) !== source) return copy(from, to, flags);
      copy(from, to, flags);
      if (fault === 'writer') {
        const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
          import { writeFileSync } from 'node:fs';
          writeFileSync(${JSON.stringify(source)}, 'concurrent writer');
        `], { encoding: 'utf8', timeout: 15_000 });
        assert.equal(child.status, 0, child.stderr || String(child.error));
      }
      else if (fault === 'corrupted') fs.writeFileSync(to, Buffer.alloc(fs.statSync(to).size, 42));
      else fs.truncateSync(to, 4);
      if (fault === 'ENOSPC') throw Object.assign(new Error(`ENOSPC: no space left on device, copy '${to}'`), { code: 'ENOSPC' });
    });
    await assert.rejects(backupFolder(live, backups, 1, ''), /ENOSPC|changed|checksum|copy/i);
    assert.deepEqual(backupSets(backups), [previous.dir.split('/').at(-1)]);
    assert.equal(fs.readFileSync(join(previous.dir, 'Files/A/data'), 'utf8'), 'original container');
    assert.ok(!fs.readdirSync(backups).some((n) => n.endsWith('.partial')));
    assert.equal(fs.readFileSync(source, 'utf8'), fault === 'writer' ? 'concurrent writer' : 'changed container, requiring a new copy');
  });
}

for (const key of ['', 'key']) test(`backup replaces a damaged previous external copy with a fresh copy${key ? ' (encrypted)' : ''}`, async (t) => {
  const { live, backups, source } = setup(t);
  const previous = await backupFolder(live, backups, 0, key);
  const damaged = join(previous.dir, 'Files/A/data' + (key ? '.enc' : ''));
  // Same-length damage must be detected too, without depending on clock resolution.
  fs.writeFileSync(damaged, Buffer.alloc(fs.statSync(damaged).size, 42));
  fs.utimesSync(damaged, new Date(0), new Date(0));
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  const next = await backupFolder(live, backups, 0, key);
  assert.ok(warnings.some((message) => message.includes(previous.dir) && /damaged/.test(message)));
  assert.deepEqual(await verifyExternal(next.dir, key || undefined), {});
  assert.notEqual(fs.statSync(damaged).ino, fs.statSync(join(next.dir, 'Files/A/data' + (key ? '.enc' : ''))).ino);
  await restoreBackup(live, next.dir, undefined, key);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original container');
});

for (const key of ['', 'key']) test(`restore rejects a truncated database without replacing live data${key ? ' (encrypted)' : ''}`, async (t) => {
  const { live, backups, source } = setup(t);
  const set = await backupFolder(live, backups, 1, key);
  const name = 'A.openhbam.sqlite';
  const damaged = join(set.dir, name + (key ? '.enc' : ''));
  fs.truncateSync(damaged, Math.floor(fs.statSync(damaged).size / 2));
  const before = fs.readFileSync(join(live, name));
  fs.writeFileSync(source, 'live data');
  await assert.rejects(restoreBackup(live, set.dir, undefined, key), /checksum|changed/);
  assert.deepEqual(fs.readFileSync(join(live, name)), before);
  assert.equal(fs.readFileSync(source, 'utf8'), 'live data');
  claimFolder(live)();
});

for (const key of ['', 'key']) test(`backup detects external edits even with unchanged size and mtime${key ? ' (encrypted)' : ''}`, async (t) => {
  const { live, backups, source } = setup(t);
  const at = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(source, at, at);
  await backupFolder(live, backups, 2, key);
  const edited = 'x'.repeat(fs.statSync(source).size);
  fs.writeFileSync(source, edited);
  fs.utimesSync(source, at, at);
  const set = await backupFolder(live, backups, 2, key);
  await restoreBackup(live, set.dir, undefined, key);
  assert.equal(fs.readFileSync(source, 'utf8'), edited);
});

test('disk full midway through restore staging preserves live bytes and releases the claim', async (t) => {
  const { live, backups, source } = setup(t);
  const set = await backupFolder(live, backups, 1, '');
  fs.writeFileSync(source, 'live container');
  const target = join(live, 'A.openhbam.sqlite');
  const before = fs.readFileSync(target);
  const copy = fs.copyFileSync;
  hook(t, 'copyFileSync', (from, to, flags) => {
    copy(from, to, flags);
    if (String(to).includes('A.restoring')) {
      fs.truncateSync(to, 4);
      throw Object.assign(new Error(`ENOSPC: no space left on device, copy '${to}'`), { code: 'ENOSPC' });
    }
  });
  await assert.rejects(restoreBackup(live, set.dir), /ENOSPC/);
  assert.deepEqual(fs.readFileSync(target), before);
  assert.equal(fs.readFileSync(source, 'utf8'), 'live container');
  assert.ok(!fs.readdirSync(live, { recursive: true }).some((n) => String(n).includes('.restoring')));
  claimFolder(live)();
});

test('disk full writing the restore commit decision rolls back before returning an error', (t) => {
  const { live } = setup(t);
  const target = join(live, 'value');
  const staged = target + '.restoring';
  fs.writeFileSync(target, 'old'); fs.writeFileSync(staged, 'new');
  const write = fs.writeFileSync;
  hook(t, 'writeFileSync', (path, data, options) => {
    if (String(path).includes('.restore-journal.json.') && String(data).includes('"committed"')) {
      write(path, '{', options);
      throw Object.assign(new Error('ENOSPC: no space left writing restore journal'), { code: 'ENOSPC' });
    }
    return write(path, data, options);
  });
  assert.throws(() => commitRestore(live, [{ target, staged }]), /ENOSPC/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old');
  assert.equal(fs.existsSync(join(live, '.restore-journal.json')), false);
});

test('a truncated restore journal reports its path and preserves recovery evidence', (t) => {
  const { live, source } = setup(t);
  const path = join(live, '.restore-journal.json');
  fs.writeFileSync(path, '{');
  assert.throws(() => recoverRestore(live), /restore-journal\.json.*(invalid|JSON|read)/i);
  assert.equal(fs.readFileSync(path, 'utf8'), '{');
  assert.equal(fs.readFileSync(source, 'utf8'), 'original container');
});

for (const operation of ['backup', 'restore']) {
  test(`${operation}: a process exit inside a partial file write preserves the previous generation`, async (t) => {
    const { live, backups, source } = setup(t);
    const previous = await backupFolder(live, backups, 1, '');
    fs.writeFileSync(source, 'new live data, needing a fresh copy');
    const db = join(live, 'A.openhbam.sqlite');
    const before = fs.readFileSync(db);
    const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { backupFolder, restoreBackup } from ${JSON.stringify(new URL('../src/backup.ts', import.meta.url).href)};
      const copy = fs.copyFileSync;
      fs.copyFileSync = (from, to, flags) => {
        if (${JSON.stringify(operation)} === 'backup' ? String(from) === ${JSON.stringify(source)} : String(to).endsWith('.sqlite.restoring')) {
          fs.writeFileSync(to, fs.readFileSync(from).subarray(0, 4));
          process.exit(73);
        }
        return copy(from, to, flags);
      };
      syncBuiltinESMExports();
      if (${JSON.stringify(operation)} === 'backup') await backupFolder(${JSON.stringify(live)}, ${JSON.stringify(backups)}, 1, '');
      else await restoreBackup(${JSON.stringify(live)}, ${JSON.stringify(previous.dir)}, undefined, '');
    `], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(child.status, 73, child.stderr || String(child.error));
    claimFolder(live)();
    assert.deepEqual(fs.readFileSync(db), before);
    assert.equal(fs.readFileSync(source, 'utf8'), 'new live data, needing a fresh copy');
    assert.deepEqual(backupSets(backups), [previous.dir.split('/').at(-1)]);
    assert.equal(fs.readFileSync(join(previous.dir, 'Files/A/data'), 'utf8'), 'original container');
    sweepCrashLeftovers(live, backups, Date.now() + 2 * 86_400_000);
    if (operation === 'backup') await backupFolder(live, backups, 1, '');
    else await restoreBackup(live, previous.dir, undefined, '');
    assert.equal(fs.readFileSync(source, 'utf8'), operation === 'backup' ? 'new live data, needing a fresh copy' : 'original container');
    assert.ok(!fs.readdirSync(live, { recursive: true }).some((n) => String(n).includes('.restoring')));
    assert.ok(!fs.readdirSync(backups).some((n) => n.endsWith('.partial')));
  });
}

test('a directory fsync failure after the committed journal rename reports a committed restore', (t) => {
  const { live } = setup(t);
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const live = ${JSON.stringify(live)};
    const target = join(live, 'value');
    const staged = target + '.restoring';
    fs.writeFileSync(target, 'old'); fs.writeFileSync(staged, 'new');
    const rename = fs.renameSync;
    const sync = fs.fsyncSync;
    let fail = false;
    let injected = false;
    const warnings = [];
    console.warn = (message) => warnings.push(message);
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (String(to).endsWith('.restore-journal.json') && fs.readFileSync(to, 'utf8').includes('"committed"')) fail = true;
    };
    fs.fsyncSync = (fd) => {
      if (fail && !injected && fs.fstatSync(fd).isDirectory()) {
        injected = true;
        throw Object.assign(new Error('injected commit directory fsync failure'), { code: 'EIO' });
      }
      sync(fd);
    };
    syncBuiltinESMExports();
    // Import after installing the fault: durable.ts captures its filesystem operations.
    const { commitRestore, recoverRestore } = await import(${JSON.stringify(new URL('../src/restore-files.ts', import.meta.url).href)});
    assert.doesNotThrow(() => commitRestore(live, [{ target, staged }]));
    assert.ok(injected);
    assert.equal(fs.readFileSync(target, 'utf8'), 'new');
    assert.ok(warnings.some((message) => /Restore committed.*durability is uncertain.*fsync failure/.test(message)));
    recoverRestore(live);
    assert.equal(fs.readFileSync(target, 'utf8'), 'new');
  `], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(child.status, 0, child.stderr || String(child.error));
});
