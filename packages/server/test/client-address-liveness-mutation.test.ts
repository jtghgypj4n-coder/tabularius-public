import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useForwardedFor } from '../src/client-address.ts';

test('forwarding whitespace parsing terminates and attributes valid requests', (t) => {
  assert.equal(typeof useForwardedFor, 'function');
  const dir = mkdtempSync(join(tmpdir(), 'forwarding-mutation-'));
  const marker = join(dir, 'called');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\n: > "' + marker + '"\nexit 99\n', { mode: 0o755 });
  }
  // Forward mutation loader hooks explicitly, without forwarding test-runner flags.
  const preloads: string[] = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (arg === '--import') preloads.push(arg, process.execArgv[++i]);
    else if (arg.startsWith('--import=')) preloads.push(arg);
  }
  const source = `
    import { useForwardedFor, clientAddress, trustedProxyAddresses } from ${JSON.stringify(new URL('../src/client-address.ts', import.meta.url).href)};
    const trust = trustedProxyAddresses(['192.0.2.1']);
    const results = [];
    for (const forwarded of ['for=203.0.113.1', ' for=203.0.113.1 ', '\\tfor=203.0.113.1\\t']) {
      const req = { socket: { remoteAddress: '192.0.2.1' }, headers: { forwarded } };
      results.push([useForwardedFor(req, 'forwarded', trust), clientAddress(req)]);
    }
    console.log(JSON.stringify(results));
  `;
  // Unmodified execution is well below one second: at least 3x deadline headroom.
  // A child boundary turns a synchronous infinite loop into an assertion failure.
  const child = spawnSync(process.execPath, [...preloads, '--no-warnings', '--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', env: { ...process.env, PATH: dir },
  });
  assert.equal(existsSync(marker), false, 'no operational or network command may run');
  assert.equal(child.error, undefined, 'forwarding parser must finish within 3 seconds');
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), Array.from({ length: 3 }, () => [true, '203.0.113.1']));
});
