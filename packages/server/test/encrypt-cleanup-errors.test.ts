import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupPath, withFilesystemHook } from '../../store/src/fs-boundary.ts';
import { decryptFile, decryptFileSync, encryptFile, encryptFileSync } from '../src/encrypt.ts';

function setup(t: TestContext, asynchronous: boolean, decrypt: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-encrypt-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), dest = join(dir, 'dest');
  writeFileSync(source, Buffer.alloc(256, 42));
  if (decrypt) {
    const encrypted = join(dir, 'encrypted');
    encryptFileSync(source, encrypted, 'generated passphrase');
    renameSync(encrypted, source);
  }
  const workError = new Error('injected read failure');
  const warnings = t.mock.method(console, 'warn', (..._args: unknown[]) => {});
  const run = async (options: { cleanupPath?: typeof cleanupPath; afterClose?: (fd: number) => void; failWork?: boolean } = {}) => {
    if (decrypt && options.failWork) writeFileSync(source, 'invalid encrypted header');
    if (asynchronous) {
      const operations = {
        cleanupPath: options.cleanupPath,
        close: async (file: import('node:fs/promises').FileHandle) => {
          const fd = file.fd;
          await file.close();
          options.afterClose?.(fd);
        },
      };
      if (decrypt) await decryptFile(source, dest, 'generated passphrase', operations);
      else await encryptFile(source, dest, 'generated passphrase', options.failWork ? async () => { throw workError; } : undefined, operations);
    } else {
      const operations = {
        cleanupPath: options.cleanupPath,
        close: (fd: number) => { closeSync(fd); options.afterClose?.(fd); },
      };
      if (decrypt) decryptFileSync(source, dest, 'generated passphrase', operations);
      else encryptFileSync(source, dest, 'generated passphrase', options.failWork ? () => { throw workError; } : undefined, operations);
    }
  };
  const isWorkError = (error: unknown) => decrypt
    ? error instanceof Error && /is not a Tabularius encrypted/.test(error.message)
    : error === workError;
  return { dir, source, dest, run, isWorkError, warnings };
}

for (const asynchronous of [false, true]) for (const decrypt of [false, true]) {
  const label = `${asynchronous ? 'async' : 'sync'} ${decrypt ? 'decryption' : 'encryption'}`;

  test(`${label}: failed cleanup capture removes the opened output`, async (t) => {
    const s = setup(t, asynchronous, decrypt), failure = new Error('cleanup capture failed');
    await assert.rejects(s.run({ cleanupPath: () => { throw failure; } }), (error) => error === failure);
    assert.equal(existsSync(s.dest), false);
  });

  for (const replacement of ['file', 'symlink']) test(`${label}: failed cleanup capture preserves a replacement ${replacement}`, async (t) => {
    const s = setup(t, asynchronous, decrypt), failure = new Error('cleanup capture failed');
    await assert.rejects(s.run({ cleanupPath: () => {
      renameSync(s.dest, join(s.dir, 'moved'));
      if (replacement === 'symlink') symlinkSync(s.source, s.dest);
      else writeFileSync(s.dest, 'replacement');
      throw failure;
    } }), (error) => error === failure);
    assert.deepEqual(readFileSync(s.dest), replacement === 'symlink' ? readFileSync(s.source) : Buffer.from('replacement'));
  });

  for (const failedClose of [1, 2]) test(`${label}: close ${failedClose} reports its first error and closes each descriptor once`, async (t) => {
    const s = setup(t, asynchronous, decrypt), failure = new Error('first close failed');
    const closed: number[] = [];
    await assert.rejects(s.run({ afterClose: (fd) => {
      closed.push(fd);
      if (closed.length === failedClose) throw failure;
    } }), (error) => error === failure);
    assert.equal(closed.length, 2);
    assert.equal(new Set(closed).size, 2);
    assert.equal(existsSync(s.dest), false);
  });

  test(`${label}: cleanup failure preserves the work error and reports the cleanup error`, async (t) => {
    const s = setup(t, asynchronous, decrypt), failure = new Error('cleanup failed');
    await assert.rejects(s.run({ failWork: true, cleanupPath: (dest) => {
      const cleanup = cleanupPath(dest);
      return () => { cleanup(); throw failure; };
    } }), s.isWorkError);
    assert.equal(existsSync(s.dest), false);
    assert.ok(s.warnings.mock.calls.some((call) => call.arguments.includes(failure)));
  });

  test(`${label}: close failures during unwinding preserve the work error and still remove output`, async (t) => {
    const s = setup(t, asynchronous, decrypt), closed: number[] = [];
    await assert.rejects(s.run({ failWork: true, afterClose: (fd) => {
      closed.push(fd);
      throw new Error('close during unwinding failed');
    } }), s.isWorkError);
    assert.equal(closed.length, 2);
    assert.equal(new Set(closed).size, 2);
    assert.equal(existsSync(s.dest), false);
  });

  test(`${label}: a work failure leaves no partial output`, async (t) => {
    const s = setup(t, asynchronous, decrypt);
    await assert.rejects(s.run({ failWork: true }), s.isWorkError);
    assert.equal(existsSync(s.dest), false);
  });
}

for (const asynchronous of [false, true]) test(`${asynchronous ? 'async' : 'sync'} synthetic encryption round trip`, async (t) => {
  const s = setup(t, asynchronous, false), restored = join(s.dir, 'restored');
  await s.run();
  if (asynchronous) await decryptFile(s.dest, restored, 'generated passphrase');
  else decryptFileSync(s.dest, restored, 'generated passphrase');
  assert.deepEqual(readFileSync(restored), readFileSync(s.source));
});

test('standalone store cleanup still throws its own failure', (t) => {
  const s = setup(t, false, false), failure = new Error('standalone cleanup failed');
  const cleanup = cleanupPath(s.source);
  assert.throws(() => withFilesystemHook((event) => {
    if (event.operation === 'remove') throw failure;
  }, cleanup), (error) => error === failure);
  assert.equal(existsSync(s.source), true);
});
