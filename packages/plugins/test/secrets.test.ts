// Plug-in secrets (plugins/src/secrets.ts): the file only the server's user can read, and what a damaged one says.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { readPluginSecrets, writePluginSecret } from '../src/secrets.ts';
import { pluginStatus, readPlugin } from '../src/index.ts';
import { evaluate } from '../../calc/src/index.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';

after(() => stopJavaScript());

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

test('AR-cli-plugins-tooling-04', () => withData((dir) => {
  const text = 'SENTINEL_SECRET';
  put(dir, 'org.example.a', text);
  const folder = join(dir, 'plugins', 'secrets');
  chmodSync(folder, 0o755);
  const previous = process.umask(0o022);
  try {
    for (const action of [() => readPluginSecrets(dir, 'org.example.a'), () => writePluginSecret(dir, 'org.example.a', 'K', 'new')]) {
      assert.throws(action, (e: Error) => {
        assert.match(e.message, /isn't JSON/);
        assert.equal(e.message.includes(text), false);
        assert.equal(e.cause, undefined);
        return true;
      });
    }
    for (const name of readdirSync(folder)) {
      if (process.platform !== 'win32') assert.equal(statSync(join(folder, name)).mode & 0o077, 0, name);
    }
    if (process.platform !== 'win32') assert.equal(statSync(folder).mode & 0o077, 0);
    assert.equal(readFileSync(join(folder, 'org.example.a.json'), 'utf8'), text);
  } finally { process.umask(previous); }
}));

test('AR-cli-plugins-tooling-04 recovery', () => withData((dir) => {
  put(dir, 'org.example.a', 'SENTINEL_SECRET');
  const folder = join(dir, 'plugins', 'secrets');
  const previous = process.umask(0o022);
  try {
    assert.throws(() => readPluginSecrets(dir, 'org.example.a'));
    const copies = readdirSync(folder).filter((name) => name.includes('.damaged-'));
    assert.equal(copies.length, 1);
    const copy = join(folder, copies[0]);
    assert.equal(readFileSync(copy, 'utf8'), 'SENTINEL_SECRET');
    if (process.platform !== 'win32') assert.equal(statSync(copy).mode & 0o777, 0o600);
    chmodSync(copy, 0o644);
    assert.throws(() => readPluginSecrets(dir, 'org.example.a'));
    if (process.platform !== 'win32') assert.equal(statSync(copy).mode & 0o777, 0o600);
  } finally { process.umask(previous); }
}));

test('AR-cli-plugins-tooling-04 deleted recovery copy preserves the content-free error', () => withData((dir) => {
  const text = 'SENTINEL_SECRET';
  const id = 'org.example.a';
  put(dir, id, text);
  const folder = join(dir, 'plugins', 'secrets');
  const checkError = (e: Error) => {
    assert.equal(e.message, `plugins/secrets/${id}.json isn't JSON; repair or replace the file`);
    assert.equal(e.message.includes(text), false);
    assert.equal(e.cause, undefined);
    return true;
  };
  assert.throws(() => readPluginSecrets(dir, id), checkError);
  const copies = readdirSync(folder).filter((name) => name.includes('.damaged-'));
  assert.equal(copies.length, 1);
  rmSync(join(folder, copies[0]));
  assert.throws(() => readPluginSecrets(dir, id), checkError);
  assert.throws(() => writePluginSecret(dir, id, 'K', 'new'), checkError);
  assert.equal(readFileSync(join(folder, `${id}.json`), 'utf8'), text);
}));

test('AR-cli-plugins-tooling-04 consumers', () => withData((dir) => {
  const id = 'org.example.a';
  const plugin = join(dir, 'plugins', 'a');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ id, name: 'Probe', version: '1.0.0', api: '^1.0', publisher: 'Test', main: 'main.js',
    functions: [{ name: 'Secret_Probe', min: 0 }], permissions: { secrets: ['KEY'] } }));
  writeFileSync(join(plugin, 'main.js'), 'const functions = { Secret_Probe: () => tabularius.secrets.get("KEY") };');
  put(dir, id, 'SENTINEL_SECRET');
  const status = pluginStatus(dir);
  assert.ok(status.problems.some((p) => p.includes("isn't JSON")));
  assert.equal(JSON.stringify(status).includes('SENTINEL_SECRET'), false);
  const { calls } = readPlugin(plugin, dir);
  assert.throws(() => evaluate('Secret_Probe ()', { plugin: () => ({ min: 0, call: calls.Secret_Probe }) }), (e: Error) => {
    assert.match(e.message, /isn't JSON/);
    assert.equal(e.message.includes('SENTINEL_SECRET'), false);
    return true;
  });
}));

test('round2: malformed secret files never quote content in messages, stacks or causes', () => withData((dir) => {
  const canary = 'Q9x7Z4v2';
  for (const [i, content] of [canary, `{"K":${canary}}`, `{"K":"${canary}"} trailing`].entries()) {
    const id = `org.example.broken${i}`;
    put(dir, id, content);
    for (const action of [() => readPluginSecrets(dir, id), () => writePluginSecret(dir, id, 'K', 'replacement')]) {
      // Repeated reads exercise the damaged-state cache as well as the first parse.
      for (let attempt = 0; attempt < 2; attempt++) assert.throws(action, (error: Error) => {
        assert.match(error.message, /isn't JSON/);
        assert.ok(!inspect(error, { depth: 10 }).includes(canary));
        return true;
      });
    }
    assert.equal(readFileSync(join(dir, 'plugins', 'secrets', `${id}.json`), 'utf8'), content);
  }
}));

test('round2: damaged secret recovery copies remain private under a permissive umask', posix, () => withData((dir) => {
  const content = '{"K":"synthetic-recovery-value"';
  put(dir, 'org.example.private', content);
  const previous = process.umask(0o022);
  try { assert.throws(() => readPluginSecrets(dir, 'org.example.private')); }
  finally { process.umask(previous); }
  const folder = join(dir, 'plugins', 'secrets');
  const copies = readdirSync(folder).filter((name) => name.includes('.damaged-'));
  assert.equal(copies.length, 1);
  assert.equal(readFileSync(join(folder, copies[0]), 'utf8'), content);
  assert.equal(statSync(join(folder, copies[0])).mode & 0o077, 0);
}));
