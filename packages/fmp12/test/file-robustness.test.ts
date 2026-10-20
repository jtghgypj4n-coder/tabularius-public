import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BLOCK_SIZE, FmpDatabase, FmpError, FmpFile, fileSource } from '../src/index.ts';
import type { BlockSource } from '../src/file.ts';

// Each test runs in a killable process: a node:test timeout alone cannot
// interrupt an infinite synchronous block walk. No fixture files are used.
function boundedTest(name: string, run: () => void): void {
  test(name, () => {
    if (process.env.FMP12_ROBUSTNESS_CASE === name) {
      run();
      return;
    }
    const env: NodeJS.ProcessEnv = { ...process.env, FMP12_ROBUSTNESS_CASE: name };
    // An inherited runner context makes Node silently skip nested --test runs.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--test', '--test-reporter=tap', '--test-name-pattern',
      `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, import.meta.filename,
    ], {
      env,
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^# pass 1$/m, result.stdout + result.stderr);
  });
}

function generatedFile(): Buffer {
  // Sector 0: magic/header; sector 1: block-count header; sectors 2-3: leaves.
  const bytes = Buffer.alloc(4 * BLOCK_SIZE);
  bytes.set([0, 1, 0, 0, 0, 2, 0, 1, 0, 5, 0, 2, 0, 2, 0xc0]);
  bytes.write('HBAM7', 15, 'ascii');
  bytes[521] = 0x1e;
  bytes.writeUInt32BE(3, BLOCK_SIZE + 8);
  bytes.writeUInt16BE(1, BLOCK_SIZE + 12);
  bytes.writeUInt32BE(3, 2 * BLOCK_SIZE + 8);
  bytes.writeUInt32BE(2, 3 * BLOCK_SIZE + 4);
  // A one-byte key/value followed by zero padding, one per leaf.
  bytes.set([1, 7, 42], 2 * BLOCK_SIZE + 20);
  bytes.set([1, 8, 43], 3 * BLOCK_SIZE + 20);
  return bytes;
}

function encryptedFile(passphrase = 'test passphrase'): Buffer {
  const bytes = generatedFile();
  bytes.write('HBAMe', 15, 'ascii');
  bytes.fill(0x35, 0xfa, 0xfa + 16);
  const key = pbkdf2Sync(Buffer.from(passphrase, 'utf16le'), bytes.subarray(0xfa, 0xfa + 16), 18000, 32, 'sha1');
  for (let id = 1; id <= 3; id++) {
    const offset = id * BLOCK_SIZE;
    const iv = Buffer.alloc(16, id);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(false);
    const body = Buffer.concat([cipher.update(bytes.subarray(offset, offset + 4064)), cipher.final()]);
    bytes.set(body, offset);
    bytes.set(iv, offset + 4064);
  }
  return bytes;
}

function withTempFile(bytes: Uint8Array, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'fmp12-robustness-'));
  try {
    const path = join(dir, 'generated.fmp12');
    writeFileSync(path, bytes);
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function boundedResult(bytes: Uint8Array, passphrase?: string): void {
  const started = performance.now();
  const limit = Math.floor(bytes.length / BLOCK_SIZE);
  try {
    const file = new FmpFile(bytes, passphrase);
    const leaves = [...file.leaves()];
    assert.ok(leaves.length <= limit);
    assert.equal(new Set(leaves.map((b) => b.id)).size, leaves.length);
    const order = [...file.leafOrder()];
    assert.ok(order.length <= limit);
    assert.equal(new Set(order).size, order.length);
    assert.deepEqual(order, leaves.map((b) => b.id));
    for (const chunks of [file.chunks(), file.chunks(undefined, [7]), file.catalogChunks()]) {
      let count = 0;
      for (const _ of chunks) assert.ok(++count <= limit * BLOCK_SIZE);
    }
    assert.ok(file.readFraction() >= 0 && file.readFraction() <= 1);
  } catch (error) {
    assert.ok(error instanceof FmpError, `expected FmpError, got ${String(error)}`);
  }
  assert.ok(performance.now() - started < 1000, 'one mutation exceeded one second');
}

boundedTest('rejected opens release their descriptor across 2000 attempts', () => {
  const fdDir = existsSync('/proc/self/fd') ? '/proc/self/fd' : '/dev/fd';
  withTempFile(Buffer.alloc(8192), (path) => {
    const before = readdirSync(fdDir).length;
    for (let i = 0; i < 2000; i++) assert.throws(() => FmpDatabase.open(path), FmpError);
    assert.equal(readdirSync(fdDir).length, before);
  });
  // Also cover failures after the header has been accepted and key derivation.
  for (const passphrase of [undefined, 'wrong passphrase']) {
    withTempFile(encryptedFile(), (path) => {
      const before = readdirSync(fdDir).length;
      assert.throws(() => FmpDatabase.open(path, passphrase), FmpError);
      assert.equal(readdirSync(fdDir).length, before);
    });
  }
});

boundedTest('reads reject partial and empty blocks after disk truncation', () => {
  for (const encrypted of [false, true]) {
    for (const remaining of [0, 512]) {
      withTempFile(encrypted ? encryptedFile() : generatedFile(), (path) => {
        const file = FmpDatabase.open(path, encrypted ? 'test passphrase' : undefined);
        try {
          truncateSync(path, 2 * BLOCK_SIZE + remaining);
          assert.throws(() => file.file.block(2), FmpError);
          assert.throws(() => [...file.file.leaves()], FmpError);
          assert.throws(() => file.file.leafOrder(), FmpError);
        } finally {
          file.close();
        }
      });
    }
  }
  withTempFile(generatedFile(), (path) => {
    const source = fileSource(path);
    try {
      truncateSync(path, 512);
      assert.throws(() => new FmpFile(source), FmpError);
    } finally {
      source.close?.();
    }
  });
});

boundedTest('generated plaintext and encrypted files decode real leaf data', () => {
  for (const bytes of [generatedFile(), encryptedFile()]) {
    const file = new FmpFile(bytes, 'test passphrase');
    assert.equal(file.blockCount, 3);
    assert.deepEqual([...file.leafOrder()], [2, 3]);
    assert.deepEqual([...file.chunks()].map(({ chunk }) => chunk.type === 'kv' ? [...chunk.data] : []), [[42], [43]]);
    boundedResult(bytes, 'test passphrase');
  }
});

boundedTest('truncation at every 512 bytes fails cleanly', () => {
  for (const bytes of [generatedFile(), encryptedFile()]) {
    for (let end = 0; end < bytes.length; end += 512) {
      assert.throws(() => new FmpFile(bytes.subarray(0, end), 'test passphrase'), FmpError);
    }
  }
});

boundedTest('invalid block counts are rejected before traversal or allocation', () => {
  for (const count of [0, 4, 0x7fffffff, 0xffffffff]) {
    const bytes = generatedFile();
    bytes.writeUInt32BE(count, BLOCK_SIZE + 8);
    assert.throws(() => new FmpFile(bytes), FmpError);
  }
});

boundedTest('cycles self loops wrong levels and prev pointers remain bounded', () => {
  for (const [offset, value] of [
    [3 * BLOCK_SIZE + 8, 2], // 2 -> 3 -> 2
    [2 * BLOCK_SIZE + 8, 2], // first leaf self-loop
    [3 * BLOCK_SIZE + 8, 3], // later leaf self-loop
    [2 * BLOCK_SIZE + 8, 1], // link into the count header
    [2 * BLOCK_SIZE + 8, 0xffffffff], // out-of-file next pointer
    [2 * BLOCK_SIZE + 12, 0xffff0000], // wrong level
    [3 * BLOCK_SIZE + 12, 0xffff0000],
    [2 * BLOCK_SIZE + 4, 3], // no leaf with prev=0
    [3 * BLOCK_SIZE + 4, 0xffffffff],
  ]) {
    const bytes = generatedFile();
    bytes.writeUInt32BE(value, offset);
    boundedResult(bytes);
  }
});

boundedTest('malformed magic format and encrypted headers fail cleanly', () => {
  for (const offset of [0, 14, 15, 19]) {
    const bytes = generatedFile();
    bytes[offset] ^= 0xff;
    assert.throws(() => new FmpFile(bytes), FmpError);
  }
  const encrypted = encryptedFile();
  assert.throws(() => new FmpFile(encrypted), FmpError);
  assert.throws(() => new FmpFile(encrypted, 'wrong passphrase'), FmpError);
  boundedResult(encryptedFile(''), '');
  for (const offset of [0xfa, 0xfa + 15, BLOCK_SIZE, 2 * BLOCK_SIZE - 32]) {
    const bytes = Buffer.from(encrypted);
    bytes[offset] ^= 0xff; // salt, ciphertext and IV corruption
    boundedResult(bytes, 'test passphrase');
  }
  const fakeEncrypted = generatedFile();
  fakeEncrypted.write('HBAMe', 15, 'ascii');
  boundedResult(fakeEncrypted, 'test passphrase');
  const longCreator = generatedFile();
  longCreator[541] = 255;
  boundedResult(longCreator);
});
