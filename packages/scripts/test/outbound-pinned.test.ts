import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { curlAddressAllowed } from '../src/outbound.ts';

test('an invalid upstream status becomes an MBS error and leaves the host running', () => {
  const child = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('./curl-status-child.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `child exited ${child.status}: ${child.stderr}`);
  assert.match(child.stdout, /handled MBS error and completed another request/);
});

test('CURL address guard rejects local and metadata addresses, including IPv4-mapped IPv6', () => {
  for (const host of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254',
    '100.100.100.200', '[::1]', '[fc00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:a00:1]']) {
    assert.equal(curlAddressAllowed(`http://${host}/`), false, host);
  }
  assert.equal(curlAddressAllowed('https://8.8.8.8/'), true);
});

test('CURL address guard also rejects IPv4-compatible, SIIT, Teredo, discard-only and site-local IPv6 and 6to4 relay IPv4', () => {
  for (const host of ['[::7f00:1]', '[::127.0.0.1]', '[::ffff:0:7f00:1]', '[64:ff9b:1::1]', '[fec0::1]', '[2001::1]', '[100::1]', '192.88.99.1']) {
    assert.equal(curlAddressAllowed(`http://${host}/`), false, host);
  }
  for (const host of ['[2606:4700::1111]', '[2001:4860:4860::8888]', '[::ffff:8.8.8.8]', '8.8.8.8']) {
    assert.equal(curlAddressAllowed(`http://${host}/`), true, host);
  }
});
