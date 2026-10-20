import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpTokens, MCP_TOKENS_FILE } from '../src/mcp-tokens.ts';

test('MCP authentication skips a contended last-used write promptly and throttles retries', { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-lock-'));
  let writeAttempts = 0;
  const tokens = new McpTokens(dir, () => { writeAttempts++; });
  const token = tokens.create({ database: 'A', account: 'Admin' }).token;
  const source = `import { withStateLock } from ${JSON.stringify(new URL('../../store/src/durable.ts', import.meta.url).href)};
    withStateLock(process.argv[1], () => { process.send('held'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, join(dir, MCP_TOKENS_FILE)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const exited = once(child, 'exit');
  try {
    await once(child, 'message');
    const start = performance.now();
    assert.deepEqual(tokens.check(token), { database: 'A', account: 'Admin' });
    assert.ok(performance.now() - start < 2000, 'authentication must not wait for the 6000 ms holder');
    assert.equal(tokens.list()[0].lastUsed, undefined);
    for (let i = 0; i < 20; i++) assert.ok(tokens.check(token));
    assert.equal(writeAttempts, 1, 'the 20 retries must not make another state-lock attempt');
    child.kill(); await exited;
    assert.ok(new McpTokens(dir).check(token));
    assert.ok(new McpTokens(dir).list()[0].lastUsed);
  } finally { child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); }
});
