import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { decryptFile, decryptFileSync, encryptFile, encryptFileSync } from '../src/encrypt.ts';

const moduleUrl = pathToFileURL(join(import.meta.dirname, '..', 'src', 'encrypt.ts')).href;

function child(mode: string): void {
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { open } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const { encryptFileSync, encryptFile, decryptFileSync, decryptFile } = await import(process.argv[1]);
    const mode = process.argv[2];
    const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-encrypt-io-'));
    const src = join(dir, 'src'); const enc = join(dir, 'enc'); const plain = join(dir, 'plain');
    fs.writeFileSync(src, 'short writes must be retried');
    const originalSync = fs.writeSync;
    const sample = await open(src, 'r'); const proto = Object.getPrototypeOf(sample); await sample.close();
    const originalAsync = proto.write;
    const partialSync = (fd, buffer, offset = 0, length = buffer.length - offset, position = null) =>
      originalSync(fd, buffer, offset, Math.max(1, length - 1), position);
    const partialAsync = async function(buffer, offset = 0, length = buffer.length - offset, position = null) {
      return originalAsync.call(this, buffer, offset, Math.max(1, length - 1), position);
    };
    try {
      if (mode.startsWith('decrypt') || mode.startsWith('zero-decrypt') || mode === 'descriptors') encryptFileSync(src, enc, 'key');
      if (mode === 'encrypt-sync' || mode === 'decrypt-sync') {
        fs.writeSync = partialSync; syncBuiltinESMExports();
      } else if (mode === 'encrypt-async' || mode === 'decrypt-async') proto.write = partialAsync;
      if (mode === 'encrypt-sync') {
        encryptFileSync(src, enc, 'key');
        fs.writeSync = originalSync; syncBuiltinESMExports();
        decryptFileSync(enc, plain, 'key');
      } else if (mode === 'encrypt-async') {
        await encryptFile(src, enc, 'key');
        proto.write = originalAsync;
        await decryptFile(enc, plain, 'key');
      } else if (mode === 'decrypt-sync') decryptFileSync(enc, plain, 'key');
      else if (mode === 'decrypt-async') await decryptFile(enc, plain, 'key');
      else if (mode === 'zero-sync') {
        fs.writeSync = () => 0; syncBuiltinESMExports();
        assert.throws(() => encryptFileSync(src, enc, 'key'), /write|progress/i);
        assert.equal(fs.existsSync(enc), false);
      } else if (mode === 'zero-async') {
        proto.write = async () => ({ bytesWritten: 0, buffer: Buffer.alloc(0) });
        await assert.rejects(encryptFile(src, enc, 'key'), /write|progress/i);
        assert.equal(fs.existsSync(enc), false);
      } else if (mode === 'zero-decrypt-sync') {
        fs.writeSync = () => 0; syncBuiltinESMExports();
        assert.throws(() => decryptFileSync(enc, plain, 'key'), /write|progress/i);
        assert.equal(fs.existsSync(plain), false);
      } else if (mode === 'zero-decrypt-async') {
        proto.write = async () => ({ bytesWritten: 0, buffer: Buffer.alloc(0) });
        await assert.rejects(decryptFile(enc, plain, 'key'), /write|progress/i);
        assert.equal(fs.existsSync(plain), false);
      } else if (mode === 'descriptors') {
        const fdDir = fs.existsSync('/proc/self/fd') ? '/proc/self/fd' : '/dev/fd';
        const count = () => fs.readdirSync(fdDir).length;
        const before = count();
        for (let i = 0; i < 12; i++) {
          assert.throws(() => encryptFileSync(src, join(dir, 'missing', 'enc'), 'key'));
          await assert.rejects(encryptFile(src, join(dir, 'missing', 'enc'), 'key'));
          assert.throws(() => decryptFileSync(enc, join(dir, 'missing', 'plain'), 'key'));
          await assert.rejects(decryptFile(enc, join(dir, 'missing', 'plain'), 'key'));
        }
        assert.ok(count() <= before + 1, 'open descriptor count grew');
      }
      if (['encrypt-sync', 'encrypt-async', 'decrypt-sync', 'decrypt-async'].includes(mode))
        assert.deepEqual(fs.readFileSync(plain), fs.readFileSync(src));
    } finally {
      fs.writeSync = originalSync; syncBuiltinESMExports(); proto.write = originalAsync;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  `;
  const result = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, moduleUrl, mode], {
    encoding: 'utf8', timeout: 12_000,
  });
  assert.equal(result.status, 0, `${mode}: ${result.error?.message ?? result.stderr}`);
}

test('AR-server-backup-ops-10: all four file paths retry short writes', () => {
  for (const mode of ['encrypt-sync', 'encrypt-async', 'decrypt-sync', 'decrypt-async']) child(mode);
});

test('AR-server-backup-ops-10: zero progress fails and removes output', () => {
  for (const mode of ['zero-sync', 'zero-async', 'zero-decrypt-sync', 'zero-decrypt-async']) child(mode);
});

test('AR-server-backup-ops-11: failed destination opens retain no descriptors', () => child('descriptors'));

test('decrypted plaintext written synchronously stays private to the account whatever the umask', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-encrypt-mode-'));
  const before = process.umask(0);
  try {
    writeFileSync(join(dir, 'plain'), 'secret records');
    encryptFileSync(join(dir, 'plain'), join(dir, 'enc'), 'key');
    decryptFileSync(join(dir, 'enc'), join(dir, 'out'), 'key');
    assert.equal(statSync(join(dir, 'out')).mode & 0o077, 0);
  } finally {
    process.umask(before);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('decrypted plaintext written asynchronously stays private to the account whatever the umask; encrypted output is unchanged', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-encrypt-mode-async-'));
  const before = process.umask(0);
  try {
    writeFileSync(join(dir, 'plain'), 'secret records');
    encryptFileSync(join(dir, 'plain'), join(dir, 'enc-sync'), 'key');
    await encryptFile(join(dir, 'plain'), join(dir, 'enc-async'), 'key');
    // The encrypted file keeps the default creation mode; only plaintext is forced to be private.
    assert.equal(statSync(join(dir, 'enc-sync')).mode & 0o777, 0o666);
    assert.equal(statSync(join(dir, 'enc-async')).mode & 0o777, 0o666);
    await decryptFile(join(dir, 'enc-async'), join(dir, 'out'), 'key');
    assert.equal(statSync(join(dir, 'out')).mode & 0o077, 0);
    assert.equal(readFileSync(join(dir, 'out'), 'utf8'), 'secret records');
  } finally {
    process.umask(before);
    rmSync(dir, { recursive: true, force: true });
  }
});
