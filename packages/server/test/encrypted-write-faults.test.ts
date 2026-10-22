import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptFile, decryptFile, encryptFileSync, decryptFileSync } from '../src/encrypt.ts';

for (const async of [false, true]) for (const fault of ['short', 'ENOSPC', 'zero']) {
  test(`${async ? 'async' : 'sync'} encrypted backup/restore handles ${fault} writes`, async (t) => {
    const root = fs.mkdtempSync(join(tmpdir(), 'encrypted-write-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'source'); const encrypted = join(root, 'encrypted'); const restored = join(root, 'restored');
    const original = Buffer.alloc(512, 42);
    fs.writeFileSync(source, original);
    for (const decrypt of [false, true]) {
      // Generate a valid encrypted input before arming the decryption fault.
      if (decrypt) encryptFileSync(source, encrypted, 'key');
      const dest = decrypt ? restored : encrypted;
      let written = 0;
      const limit = (length: number) => {
        if (fault !== 'short' && written >= 45) {
          if (fault === 'zero') return 0;
          throw Object.assign(new Error(`ENOSPC: no space left writing ${dest}`), { code: 'ENOSPC' });
        }
        const n = Math.min(length, 15);
        written += n;
        return n;
      };
      if (async) {
        const open = promises.open;
        t.mock.method(promises, 'open', async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (String(args[0]) === dest) {
            const write = handle.write.bind(handle);
            t.mock.method(handle, 'write', (buffer: Buffer, offset = 0, length = buffer.length) => write(buffer, offset, limit(length)));
          }
          return handle;
        });
      } else {
        const write = fs.writeSync;
        t.mock.method(fs, 'writeSync', (fd: number, buffer: Buffer, offset = 0, length = buffer.length) => write(fd, buffer, offset, limit(length)));
      }
      syncBuiltinESMExports();
      try {
        const run = async () => {
          if (async) await (decrypt ? decryptFile(encrypted, restored, 'key') : encryptFile(source, encrypted, 'key'));
          else if (decrypt) decryptFileSync(encrypted, restored, 'key');
          else encryptFileSync(source, encrypted, 'key');
        };
        if (fault === 'short') await run();
        else await assert.rejects(run(), fault === 'zero' ? /write.*progress|zero.byte/i : /ENOSPC/);
      } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
      if (fault === 'short') {
        if (!decrypt) decryptFileSync(encrypted, restored, 'key');
        assert.deepEqual(fs.readFileSync(restored), original);
      }
      assert.deepEqual(fs.readFileSync(source), original);
    }
  });
}

for (const async of [false, true]) test(`${async ? 'async' : 'sync'} encryption closes its input when the output cannot be opened`, async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'encrypted-open-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'); const encrypted = join(root, 'encrypted'); const output = join(root, 'output');
  fs.writeFileSync(source, 'original');
  encryptFileSync(source, encrypted, 'key');
  for (const decrypt of [false, true]) {
    let inputFd: number | undefined;
    const failure = () => { throw Object.assign(new Error('ENOSPC: cannot open output'), { code: 'ENOSPC' }); };
    if (async) {
      const open = promises.open;
      t.mock.method(promises, 'open', async (...args: Parameters<typeof open>) => {
        if (String(args[0]) === output) return failure();
        const handle = await open(...args); inputFd = handle.fd; return handle;
      });
    } else {
      const open = fs.openSync;
      t.mock.method(fs, 'openSync', (...args: Parameters<typeof open>) => {
        if (String(args[0]) === output) return failure();
        inputFd = open(...args); return inputFd;
      });
    }
    syncBuiltinESMExports();
    try {
      await assert.rejects(async () => {
        if (async) await (decrypt ? decryptFile(encrypted, output, 'key') : encryptFile(source, output, 'key'));
        else if (decrypt) decryptFileSync(encrypted, output, 'key');
        else encryptFileSync(source, output, 'key');
      }, /ENOSPC/);
      assert.notEqual(inputFd, undefined);
      assert.throws(() => fs.fstatSync(inputFd!), { code: 'EBADF' });
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  }
});
