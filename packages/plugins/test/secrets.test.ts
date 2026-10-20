// Plug-in secrets (plugins/src/secrets.ts): the file only the server's user can read, and what a damaged one says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPluginSecrets, writePluginSecret } from '../src/secrets.ts';

const posix = process.platform === 'win32' ? { skip: 'file modes' } : {};

function withData(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-secrets-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const put = (dir: string, id: string, text: string, mode = 0o600) => {
  mkdirSync(join(dir, 'plugins', 'secrets'), { recursive: true });
  const file = join(dir, 'plugins', 'secrets', `${id}.json`);
  writeFileSync(file, text, { mode });
  chmodSync(file, mode);
};

test('a plug-in with no secrets file has none', () => withData((dir) => {
  assert.deepEqual(readPluginSecrets(dir, 'org.example.a'), {});
}));

test('a secret is set, replaced and cleared, and the file is for the server\'s user alone', posix, () => withData((dir) => {
  writePluginSecret(dir, 'org.example.a', 'API_KEY', 'k-1');
  writePluginSecret(dir, 'org.example.a', 'LICENCE', 'l-1');
  assert.deepEqual(readPluginSecrets(dir, 'org.example.a'), { API_KEY: 'k-1', LICENCE: 'l-1' });
  writePluginSecret(dir, 'org.example.a', 'API_KEY', 'k-2');
  assert.equal(readPluginSecrets(dir, 'org.example.a').API_KEY, 'k-2');
  writePluginSecret(dir, 'org.example.a', 'LICENCE', undefined);
  assert.deepEqual(readPluginSecrets(dir, 'org.example.a'), { API_KEY: 'k-2' });
  const file = join(dir, 'plugins', 'secrets', 'org.example.a.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'plugins', 'secrets')).mode & 0o077, 0, 'the folder is closed to others too');
  assert.deepEqual(readdirSync(join(dir, 'plugins', 'secrets')).sort(), ['org.example.a.json', 'org.example.a.json.lock.db'], 'no temporary file is left behind, only the lock sidecar');
}));

test('each plug-in has its own file', () => withData((dir) => {
  writePluginSecret(dir, 'org.example.a', 'K', 'a');
  writePluginSecret(dir, 'org.example.b', 'K', 'b');
  assert.equal(readPluginSecrets(dir, 'org.example.a').K, 'a');
  assert.equal(readPluginSecrets(dir, 'org.example.b').K, 'b');
}));

test('a file others can read is refused, and the message never holds a value', posix, () => withData((dir) => {
  put(dir, 'org.example.a', '{"K":"super-secret"}', 0o644);
  assert.throws(() => readPluginSecrets(dir, 'org.example.a'), (e: Error) => /chmod 600/.test(e.message) && !e.message.includes('super-secret'));
  assert.throws(() => writePluginSecret(dir, 'org.example.a', 'K2', 'x'), /chmod 600/, 'a write does not quietly tighten and carry on');
  assert.ok(readFileSync(join(dir, 'plugins', 'secrets', 'org.example.a.json'), 'utf8').includes('super-secret'), 'and leaves the file as it was');
}));

test('a damaged file says so without its contents, and only text values are kept', () => withData((dir) => {
  put(dir, 'org.example.a', '{"K": "super-secret"');
  assert.throws(() => readPluginSecrets(dir, 'org.example.a'), (e: Error) => /isn't JSON/.test(e.message) && !e.message.includes('super-secret'));
  put(dir, 'org.example.b', '["super-secret"]');
  assert.throws(() => readPluginSecrets(dir, 'org.example.b'), /isn't an object/);
  put(dir, 'org.example.c', 'null');
  assert.throws(() => readPluginSecrets(dir, 'org.example.c'), /isn't an object/);
  put(dir, 'org.example.d', '{"A":"text","B":5,"C":null,"D":{"x":"y"},"E":true}');
  assert.deepEqual(readPluginSecrets(dir, 'org.example.d'), { A: 'text' });
  assert.equal(existsSync(join(dir, 'plugins', 'secrets', 'org.example.d.json.tmp')), false);
}));
