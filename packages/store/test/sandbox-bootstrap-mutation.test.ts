// Exercise the child-process restrictions independently of the VM realm. These
// defenses must also work if guest code ever reaches a host-side capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { callJavaScript, JS_RESULT_LIMIT } from '../src/javascript.ts';

test('sandbox bootstrap refuses host-side module loads, sockets and DNS lookups', () => {
  let child: string | undefined;
  const descriptor = Object.getOwnPropertyDescriptor(workerThreads, 'Worker')!;
  // Capture the actual program supplied by the module, including any loader-injected
  // mutation. Reading the source file would miss mutations supplied by a load hook.
  Object.defineProperty(workerThreads, 'Worker', { ...descriptor, value: function (_source: unknown, options: workerThreads.WorkerOptions) {
    child = (options.workerData as { child: string }).child;
    throw new Error('captured bootstrap');
  } });
  syncBuiltinESMExports();
  try { assert.throws(() => callJavaScript({ name: 'BootstrapProbe', parameters: [], source: 'return 1' }, [])); }
  finally { Object.defineProperty(workerThreads, 'Worker', descriptor); syncBuiltinESMExports(); }
  assert.equal(typeof child, 'string');
  const program = `
    const mutationProbe = { assert: require('node:assert/strict'), net: require('node:net'), dns: require('node:dns') };
    ${child}
    try {
      mutationProbe.assert.throws(() => require('node:fs'), /Modules are not available/);
      mutationProbe.assert.throws(() => mutationProbe.net.connect(1, '127.0.0.1'), /network is not available/);
      mutationProbe.assert.throws(() => mutationProbe.dns.lookup('localhost', () => {}), /network is not available/);
      mutationProbe.assert.equal(typeof globalThis.fetch, 'undefined');
      mutationProbe.assert.equal(typeof process.getBuiltinModule, 'undefined');
      process.stdout.write('bootstrap verified\\n');
      process.exit(0);
    } catch (error) { process.stderr.write(String(error)); process.exit(1); }
  `;
  const result = spawnSync(process.execPath, ['--permission', '--disallow-code-generation-from-strings', '--no-warnings', '-e', program, String(JS_RESULT_LIMIT)], {
    input: '', encoding: 'utf8', timeout: 10_000, env: {},
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'bootstrap verified\n', 'the probes ran to completion rather than being swallowed by the child error handler');
});
