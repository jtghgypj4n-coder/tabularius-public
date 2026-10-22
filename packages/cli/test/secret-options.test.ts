import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const server = new URL('../../server/src/index.ts', import.meta.url).href;

function cleanEnv(t: Parameters<typeof commandStubEnv>[0], home: string): NodeJS.ProcessEnv {
  const env = commandStubEnv(t);
  for (const key of ['TABULARIUS_MCP_TOKEN', 'TABULARIUS_MCP_TOKEN_FILE', 'TABULARIUS_REPLICATION_TOKEN', 'TABULARIUS_REPLICATION_TOKEN_FILE', 'PORT']) delete env[key];
  return { ...env, TABULARIUS_HOME: home };
}

test('serve reads an MCP token file and applies it to the endpoint', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-serve-'));
  const token = 'correct-horse-battery';
  const file = join(dir, 'mcp-token');
  const replicationFile = join(dir, 'replication-token');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  writeFileSync(replicationFile, 'replication-horse-battery\n', { mode: 0o600 });
  const child = spawn(process.execPath, ['--no-warnings', main, 'serve', dir, '--port', '0', '--no-backups', '--mcp-token-file', file, '--replication-token-file', replicationFile], { env: cleanEnv(t, join(dir, 'home')), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  // Hooks run in the order they are added: stop the server before its folder is removed, or it is still writing there.
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve did not start: ${output}`)), 15_000);
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      const found = /Web client: (http:\/\/[^\s/]+)/.exec(output);
      if (found) { clearTimeout(timer); resolve(found[1]); }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.once('close', (code) => { clearTimeout(timer); reject(new Error(`serve exited ${code}: ${output}`)); });
    child.once('error', reject);
  });
  const request = (value: string) => fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${value}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'token-file-test', version: '1' } } }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await request(token)).status, 200);
  assert.equal((await request('different-horse-battery')).status, 401);
  await new Promise<void>((resolve, reject) => {
    const expected = `--token-file ${replicationFile}`;
    if (output.includes(expected)) return resolve();
    const timer = setTimeout(() => reject(new Error(`startup did not name the token file: ${output}`)), 3000);
    const take = () => { if (output.includes(expected)) { clearTimeout(timer); child.stdout.off('data', take); resolve(); } };
    child.stdout.on('data', take);
  });
  assert.ok(!output.includes(token), 'the token stays out of startup output');
  assert.ok(!output.includes('replication-horse-battery'), 'the replication token stays out of startup output');
});

test('serve rejects conflicting options and short replication files before startup', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-options-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  writeFileSync(file, 'short\n', { mode: 0o600 });
  const env = cleanEnv(t, join(dir, 'home'));
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, 'serve', dir, '--port', '0', ...args], { env, encoding: 'utf8', timeout: 15_000 });
  const conflict = run('--mcp-token', 'inline-word', '--mcp-token-file', file);
  assert.equal(conflict.status, 1, conflict.stderr);
  assert.match(conflict.stderr, /--mcp-token.*--mcp-token-file/);
  const short = run('--replication-token-file', file);
  assert.equal(short.status, 1, short.stderr);
  assert.match(short.stderr, /--replication-token must be at least 16 characters/);
  assert.ok(!short.stderr.includes('short'), 'the token stays out of errors');
});

test('standby passes the token file contents to Standby without contacting a primary', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-standby-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  writeFileSync(file, 'correct-horse-battery\n', { mode: 0o600 });
  const code = `
    import { mock } from 'node:test';
    import assert from 'node:assert/strict';
    const original = await import(${JSON.stringify(server)});
    const calls = [];
    mock.module(${JSON.stringify(server)}, { namedExports: { ...original, Standby: class {
      constructor(options) { calls.push(options); }
      start() {}
    } } });
    process.argv = ['node', ${JSON.stringify(main)}, 'standby', ${JSON.stringify(dir)}, '--primary', 'https://primary.example.invalid', '--token-file', ${JSON.stringify(file)}];
    await import(${JSON.stringify(new URL('../src/main.ts', import.meta.url).href)});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].token, 'correct-horse-battery');
  `;
  const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-test-module-mocks', '--input-type=module', '-e', code], { env: cleanEnv(t, join(dir, 'home')), encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('correct-horse-battery'));
});

test('standby reads the file environment variable and an explicit file wins over an inline environment value', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-standby-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'token');
  writeFileSync(file, 'correct-horse-battery\n', { mode: 0o600 });
  for (const explicit of [false, true]) {
    const code = `
      import { mock } from 'node:test';
      import assert from 'node:assert/strict';
      const original = await import(${JSON.stringify(server)});
      const calls = [];
      mock.module(${JSON.stringify(server)}, { namedExports: { ...original, Standby: class {
        constructor(options) { calls.push(options); }
        start() {}
      } } });
      process.argv = ['node', ${JSON.stringify(main)}, 'standby', ${JSON.stringify(dir)}, '--primary', 'https://primary.example.invalid', ...${JSON.stringify(explicit ? ['--token-file', file] : [])}];
      await import(${JSON.stringify(new URL('../src/main.ts', import.meta.url).href)});
      assert.equal(calls[0].token, 'correct-horse-battery');
    `;
    const env = cleanEnv(t, join(dir, 'home'));
    if (explicit) env.TABULARIUS_REPLICATION_TOKEN = 'inline-environment-word';
    else env.TABULARIUS_REPLICATION_TOKEN_FILE = file;
    const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-test-module-mocks', '--input-type=module', '-e', code], { env, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
  }
});
