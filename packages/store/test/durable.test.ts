import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonStateSync, syncPath, type DurableFs, updateJsonStateSync, writeDurable, writeJsonStateSync, writeStateFileSync, withStateLock } from '../src/durable.ts';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function fakeFs(code: string, failure: 'file' | 'directory' | 'open' = 'directory') {
  const calls: string[] = [];
  const fs: DurableFs = {
    statSync(path) { return { isDirectory: () => path === '/data' }; },
    openSync(path) {
      calls.push(`open:${path}`);
      if (failure === 'open' && path === '/data') throw Object.assign(new Error(code), { code });
      return path === '/data' ? 2 : 1;
    },
    fsyncSync(fd) {
      calls.push(`sync:${fd}`);
      if (fd === (failure === 'file' ? 1 : 2)) throw Object.assign(new Error(code), { code });
    },
    closeSync(fd) { calls.push(`close:${fd}`); },
    renameSync() { calls.push('rename'); },
  };
  return { fs, calls };
}

for (const code of ['EPERM', 'EISDIR', 'EINVAL']) {
  test(`durable publication tolerates unsupported directory sync (${code})`, () => {
    const { fs, calls } = fakeFs(code);
    writeDurable('/data/staged', '/data/live', fs);
    assert.deepEqual(calls, ['open:/data/staged', 'sync:1', 'close:1', 'rename',
      ...(process.platform === 'win32' ? [] : ['open:/data', 'sync:2', 'close:2'])]);
    // Exercise unsupported directory fsync even on Windows CI.
    assert.doesNotThrow(() => syncPath('/data', fs, 'linux'));
    assert.doesNotThrow(() => syncPath('/data', fakeFs(code, 'open').fs, 'linux'));
  });

  test(`file fsync errors still prevent publication (${code})`, () => {
    const { fs, calls } = fakeFs(code, 'file');
    assert.throws(() => writeDurable('/data/staged', '/data/live', fs), { code });
    assert.deepEqual(calls, ['open:/data/staged', 'sync:1', 'close:1']);
  });
}

test('Windows skips opening directories but still flushes files', () => {
  const { fs, calls } = fakeFs('EPERM');
  syncPath('/data', fs, 'win32');
  assert.deepEqual(calls, []);
  syncPath('/data/file', fs, 'win32');
  assert.deepEqual(calls, ['open:/data/file', 'sync:1', 'close:1']);
});

test('directory IO failures are not hidden', () => {
  assert.throws(() => syncPath('/data', fakeFs('EIO').fs, 'linux'), { code: 'EIO' });
});

const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');

test('JSON state writes use atomic durable replacement and leave no shared temporary file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-json-state-'));
  try {
    const file = join(dir, 'state.json');
    writeJsonStateSync(file, { a: 1 }, { mode: 0o600 });
    writeJsonStateSync(file, { b: 2 }, { mode: 0o600 });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { b: 2 });
    assert.deepEqual(readdirSync(dir), ['state.json']);
    assert.equal(existsSync(`${file}.tmp`), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('four processes keep all 2000 interleaved JSON state updates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-json-lock-'));
  const file = join(dir, 'counter.json');
  const moduleUrl = pathToFileURL(join(process.cwd(), 'packages/store/src/durable.ts')).href;
  const source = `import { updateJsonStateSync } from ${JSON.stringify(moduleUrl)};\n` +
    `for (let i = 0; i < 500; i++) updateJsonStateSync(process.argv[1], { count: 0 }, (x) => ({ count: x.count + 1 }));`;
  try {
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, file], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`increment child exited ${code}`)));
    });
    await Promise.all([run(), run(), run(), run()]);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { count: 2000 });
    assert.deepEqual(readdirSync(dir).sort(), ['counter.json', 'counter.json.lock.db']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a nested lock on the same file runs inside the outer one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-nested-lock-'));
  try {
    const file = join(dir, 'state.json');
    const result = withStateLock(file, () => {
      const inner = updateJsonStateSync(file, { count: 0 }, (x) => ({ count: x.count + 1 }));
      return withStateLock(file, () => updateJsonStateSync(file, { count: 0 }, (x) => ({ count: x.count + inner.count })));
    });
    assert.deepEqual(result, { count: 2 });
    // The outer lock is released afterwards: a fresh acquisition with no wait succeeds.
    withStateLock(file, () => {}, 0);
    assert.deepEqual(readdirSync(dir).sort(), ['state.json', 'state.json.lock.db']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asRoot = process.getuid?.() === 0;

test('a read-only lock db is refused before the action runs', { skip: asRoot || process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ro-lock-'));
  try {
    const file = join(dir, 'state.json');
    writeFileSync(`${file}.lock.db`, '');
    fs.chmodSync(`${file}.lock.db`, 0o444);
    let ran = false;
    assert.throws(() => withStateLock(file, () => { ran = true; }),
      new RegExp(`${escape(`${file}.lock.db`)} is read-only, so it can't lock ${escape(file)}: make it writable by the user Tabularius runs as \\(chown/chmod\\), or delete it while Tabularius is stopped$`));
    assert.equal(ran, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing state folder names the folder and keeps ENOENT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-missing-lock-'));
  try {
    const file = join(dir, 'nope', 'state.json');
    assert.throws(() => updateJsonStateSync(file, {}, () => ({})),
      (e: NodeJS.ErrnoException) => e.code === 'ENOENT' && e.message === `couldn't lock ${file}: the folder ${join(dir, 'nope')} does not exist`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a read-only state folder names the lock file and what to do', { skip: asRoot || process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rodir-lock-'));
  try {
    const file = join(dir, 'state.json');
    fs.chmodSync(dir, 0o555);
    assert.throws(() => updateJsonStateSync(file, {}, () => ({})),
      new RegExp(`couldn't open the lock file ${escape(`${file}.lock.db`)} for ${escape(file)} \\(.+\\): ${escape(dir)} must be writable by the user Tabularius runs as`));
  } finally { fs.chmodSync(dir, 0o755); rmSync(dir, { recursive: true, force: true }); }
});

test('a damaged lock db is refused every time and left for the operator to delete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-damaged-lock-'));
  try {
    const file = join(dir, 'state.json');
    writeFileSync(`${file}.lock.db`, 'hello world, not sqlite');
    const damaged = new RegExp(`${escape(`${file}.lock.db`)} is damaged, so it can't lock ${escape(file)}: delete it while Tabularius is stopped`);
    for (let i = 0; i < 2; i++) assert.throws(() => updateJsonStateSync(file, { n: 0 }, (c) => ({ n: c.n + 1 }), { lockWaitMs: 0 }), damaged);
    assert.equal(readFileSync(`${file}.lock.db`, 'utf8'), 'hello world, not sqlite');
    assert.equal(existsSync(file), false);
    // Once it is deleted, the next write makes a new one.
    rmSync(`${file}.lock.db`);
    assert.deepEqual(updateJsonStateSync(file, { n: 0 }, (c) => ({ n: c.n + 1 })), { n: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a lock db that is a folder names it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dir-lock-'));
  try {
    const file = join(dir, 'state.json');
    fs.mkdirSync(`${file}.lock.db`);
    assert.throws(() => updateJsonStateSync(file, {}, () => ({}), { lockWaitMs: 0 }),
      new RegExp(`couldn't open the lock file ${escape(`${file}.lock.db`)} for ${escape(file)} `));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a nested lock reached through a symlink runs inside the outer one', { skip: process.platform === 'win32' }, () => {
  const dir = fs.realpathSync(mkdtempSync(join(tmpdir(), 'tabularius-link-lock-')));
  try {
    const file = join(dir, 'state.json');
    fs.symlinkSync(dir, `${dir}-link`);
    const viaLink = join(`${dir}-link`, 'state.json');
    // First use: the lock db does not exist yet when the outer key is taken.
    assert.equal(withStateLock(file, () => withStateLock(viaLink, () => 7, 0), 0), 7);
    assert.equal(withStateLock(viaLink, () => withStateLock(file, () => 8, 0), 0), 8);
  } finally { rmSync(`${dir}-link`, { force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test('an action that returns a promise is refused and the lock is released', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-async-lock-'));
  try {
    const file = join(dir, 'state.json');
    let pending: Promise<number> | undefined;
    // @ts-expect-error the type refuses an async action too
    assert.throws(() => withStateLock(file, () => (pending = Promise.resolve(1))), /withStateLock needs a synchronous action/);
    await pending;
    withStateLock(file, () => {}, 0);
    // Nested calls are checked as well.
    // @ts-expect-error the type refuses an async action too
    assert.throws(() => withStateLock(file, () => withStateLock(file, async () => 1)), /withStateLock needs a synchronous action/);
    withStateLock(file, () => {}, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two processes adding different schedules retain both', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-schedule-lock-'));
  const moduleUrl = pathToFileURL(join(process.cwd(), 'packages/server/src/schedules.ts')).href;
  const source = `import { Schedules } from ${JSON.stringify(moduleUrl)};\n` +
    `const host = { dir: process.argv[1], onAdd: [], names: () => [], scriptOptions: () => ({}) };` +
    `const schedules = new Schedules(host); process.send?.('ready'); process.once('message', () => {` +
    ` schedules.create({ kind: 'backup', name: process.argv[2], everyMinutes: 60 }); schedules.stop(); });`;
  const children = ['alpha', 'beta'].map((name) => spawn(process.execPath, ['--input-type=module', '-e', source, dir, name], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
  try {
    await Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
      child.once('message', () => resolve());
      child.once('error', reject);
    })));
    const exited = children.map((child) => new Promise<void>((resolve, reject) => {
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`schedule child exited ${code}`)));
      child.once('error', reject);
    }));
    children.forEach((child) => child.send('go'));
    await Promise.all(exited);
    const stored = JSON.parse(readFileSync(join(dir, '.openhbam-schedules.json'), 'utf8')) as { schedules: { name: string }[] };
    assert.deepEqual(stored.schedules.map((s) => s.name).sort(), ['alpha', 'beta']);
  } finally {
    children.forEach((child) => child.kill());
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unreadable JSON state names the file and preserves its bytes in a damaged copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-json-state-'));
  try {
    const file = join(dir, 'settings.json');
    const bytes = '{torn';
    writeFileSync(file, bytes);
    assert.throws(() => readJsonStateSync(file), new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const damaged = readdirSync(dir).filter((name) => name.startsWith('settings.json.damaged-'));
    assert.equal(damaged.length, 1);
    assert.equal(readFileSync(join(dir, damaged[0]), 'utf8'), bytes);
    assert.equal(readFileSync(file, 'utf8'), bytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('repeated reads of unchanged malformed state keep one damaged copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-json-state-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{not json');
    for (let i = 0; i < 3; i++) assert.throws(() => readJsonStateSync(file), /could not be read/);
    const damaged = readdirSync(dir).filter((name) => name.startsWith('settings.json.damaged-'));
    assert.equal(damaged.length, 1);
    writeFileSync(file, '{changed malformed content');
    assert.throws(() => readJsonStateSync(file), /could not be read/);
    assert.equal(readdirSync(dir).filter((name) => name.startsWith('settings.json.damaged-')).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a close error still removes the temporary state file without retrying close', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-json-state-'));
  const close = fs.closeSync;
  let calls = 0;
  fs.closeSync = ((fd: number) => {
    calls++;
    close(fd);
    throw Object.assign(new Error('simulated close error'), { code: 'EIO' });
  }) as typeof fs.closeSync;
  syncBuiltinESMExports();
  try {
    assert.throws(() => writeStateFileSync(join(dir, 'state.json'), '{}'), /simulated close error/);
    assert.equal(calls, 1);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    fs.closeSync = close;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory sync error is reported but does not fail an already replaced state file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-json-state-'));
  const fsync = fs.fsyncSync;
  const warn = console.warn;
  let warned = false;
  fs.fsyncSync = ((fd: number) => {
    if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('simulated directory sync error'), { code: 'EIO' });
    return fsync(fd);
  }) as typeof fs.fsyncSync;
  console.warn = () => { warned = true; };
  syncBuiltinESMExports();
  try {
    const file = join(dir, 'state.json');
    assert.doesNotThrow(() => writeJsonStateSync(file, { saved: true }));
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { saved: true });
    assert.equal(warned, true);
  } finally {
    fs.fsyncSync = fsync;
    console.warn = warn;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sensitive state that is not JSON reports a file name with no path, no parse text and no contents, and keeps a private recovery copy', { skip: process.platform === 'win32' ? 'file modes' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sensitive-'));
  try {
    const file = join(dir, 'secrets.json');
    writeFileSync(file, '{"K": "synthetic-secret-value"', { mode: 0o600 });
    for (let read = 0; read < 2; read++) {
      assert.throws(() => readJsonStateSync(file, { sensitive: true }), (e: Error) => {
        const shown = `${e.message} ${(e.cause as Error | undefined)?.message ?? ''}`;
        return e.message === 'secrets.json could not be read: not valid JSON' && !shown.includes(dir) && !shown.includes('synthetic-secret-value') && !/position|Unexpected|token/i.test(shown);
      }, `read ${read + 1}`);
    }
    const copies = readdirSync(dir).filter((name) => name.startsWith('secrets.json.damaged-'));
    assert.equal(copies.length, 1, 'one recovery copy for this content, however often it is read');
    assert.equal(statSync(join(dir, copies[0])).mode & 0o077, 0, 'the recovery copy is private to its owner');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
