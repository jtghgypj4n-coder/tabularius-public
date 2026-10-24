import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import { createStore, Store } from '../../store/src/index.ts';
import { ContainerFiles, limitedCommand, THUMBNAIL_PASSTHROUGH_BYTES } from '../src/containers.ts';

// A 1 x 1 PNG header followed by padding: only the header decides whether a picture is "no bigger than asked for".
const picture = (bytes: number) => {
  const head = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8]);
  const out = new Uint8Array(bytes);
  out.set(head);
  return out;
};

class ConvertingWorker extends EventEmitter {
  unref(): this { return this; }
  postMessage(message: { id: number }): void { setImmediate(() => this.emit('message', { id: message.id, png: Uint8Array.of(9, 9, 9) })); }
  async terminate(): Promise<number> { return 0; }
}

test('a picture is served as it is only up to 128 KiB; a bigger one that is no bigger than asked for is converted', async (t) => {
  assert.equal(THUMBNAIL_PASSTHROUGH_BYTES, 128 * 1024);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-thumb-limit-'));
  const files = new ContainerFiles({ createWorker: () => new ConvertingWorker() as unknown as Worker });
  createStore(join(dir, 'A.sqlite'));
  const store = new Store(join(dir, 'A.sqlite'), 'A');
  t.after(() => { store.close(); files.stop(); rmSync(dir, { recursive: true, force: true }); });
  const make = (id: number, size: number) => (files as unknown as { makeAdmitted(s: Store, id: number, size: number, bytes: number, signal: AbortSignal): Promise<{ mime: string; data: Uint8Array } | undefined> })
    .makeAdmitted(store, id, 64, size, new AbortController().signal);
  const small = store.addContainer({ filename: 'small.png', mime: 'image/png', data: picture(THUMBNAIL_PASSTHROUGH_BYTES) });
  const big = store.addContainer({ filename: 'big.png', mime: 'image/png', data: picture(THUMBNAIL_PASSTHROUGH_BYTES + 1) });
  assert.deepEqual((await make(small, THUMBNAIL_PASSTHROUGH_BYTES))?.data, picture(THUMBNAIL_PASSTHROUGH_BYTES));
  assert.deepEqual((await make(big, THUMBNAIL_PASSTHROUGH_BYTES + 1))?.data, Uint8Array.of(9, 9, 9));
});

test('on Linux a converter runs under prlimit, or under ulimit in sh, with address space, CPU time and file size limits', () => {
  const converter = { cmd: '/usr/bin/pdftoppm', args: ['-png', 'in', 'out'] };
  const withPrlimit = limitedCommand(converter.cmd, converter.args, 'linux', { prlimit: '/usr/bin/prlimit', sh: '/bin/sh' });
  assert.equal(withPrlimit.limits, 'prlimit');
  assert.equal(withPrlimit.cmd, '/usr/bin/prlimit');
  assert.deepEqual(withPrlimit.args, ['--as=536870912', '--cpu=20', '--fsize=16777216', '--', converter.cmd, ...converter.args]);
  const withSh = limitedCommand(converter.cmd, converter.args, 'linux', { sh: '/bin/sh' });
  assert.equal(withSh.limits, 'ulimit');
  assert.equal(withSh.cmd, '/bin/sh');
  assert.deepEqual(withSh.args.slice(0, 1), ['-c']);
  assert.deepEqual(withSh.args.slice(3), [converter.cmd, ...converter.args]);
  assert.match(withSh.args[1], /^ulimit -v 524288; ulimit -t 20; ulimit -f 32768; exec "\$@"$/);
  // No input reaches the shell text: names and arguments are separate argv entries.
  assert.equal(limitedCommand('/bin/x; rm -rf /', ["$(id)"], 'linux', { sh: '/bin/sh' }).args[1], withSh.args[1]);
});

test('where no limit can be applied the converter runs as it was: macOS, Windows, or a Linux with neither prlimit nor sh', () => {
  for (const [platform, tools] of [['darwin', { prlimit: '/usr/bin/prlimit', sh: '/bin/sh' }], ['win32', { sh: 'C:\\sh.exe' }], ['linux', {}]] as const) {
    const run = limitedCommand('/bin/tool', ['a'], platform, tools);
    assert.deepEqual([run.cmd, run.args, run.limits], ['/bin/tool', ['a'], 'none'], platform);
  }
});

test('the limits really are in force in the child on Linux', { skip: process.platform !== 'linux' }, () => {
  const probe = limitedCommand('/bin/sh', ['-c', 'ulimit -v; ulimit -t; ulimit -f'], 'linux', { prlimit: undefined, sh: '/bin/sh' });
  assert.equal(probe.limits, 'ulimit');
  assert.equal(execFileSync(probe.cmd, probe.args).toString(), '524288\n20\n32768\n');
  const real = limitedCommand('/bin/sh', ['-c', 'ulimit -v; ulimit -t; ulimit -f'], 'linux', { prlimit: '/usr/bin/prlimit', sh: '/bin/sh' });
  try {
    assert.equal(execFileSync(real.cmd, real.args).toString(), '524288\n20\n32768\n');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // no prlimit on this machine
  }
});
