import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const main = new URL('../src/main.ts', import.meta.url).href;
const server = new URL('../../server/src/index.ts', import.meta.url).href;

for (const [command, option, property] of [
  ['serve', '--mcp-token', 'mcpToken'],
  ['serve', '--replication-token', 'replicationToken'],
  ['standby', '--token', 'token'],
]) test(`AR-cli-plugins-tooling-02 leading-dash secret ${option}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-dispatch-'));
  try {
    for (const suffix of [['-synthetic-token-123'], ['--synthetic-token-123'], [], [''], ['   ']]) {
      const valid = !!suffix[0]?.trim();
      const args = [command, dir, ...(command === 'standby' ? ['--primary', 'https://primary.example.invalid'] : []), option, ...suffix];
      const code = `
        import { mock } from 'node:test';
        import assert from 'node:assert/strict';
        const original = await import(${JSON.stringify(server)});
        const calls = [];
        let started = 0;
        mock.module(${JSON.stringify(server)}, { namedExports: {
          ...original,
          serve: (options) => { calls.push(options); return new Promise(() => {}); },
          Standby: class {
            constructor(options) { calls.push(options); }
            start() { started++; }
          },
        } });
        process.argv = ['node', ${JSON.stringify(main)}, ...${JSON.stringify(args)}];
        await import(${JSON.stringify(main)});
        assert.equal(calls.length, ${valid ? 1 : 0});
        assert.equal(process.exitCode, ${valid ? 0 : 1});
        assert.equal(started, ${valid && command === 'standby' ? 1 : 0});
        ${valid ? `assert.equal(calls[0][${JSON.stringify(property)}], ${JSON.stringify(suffix[0])});` : ''}
        process.exitCode = 0;
      `;
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TABULARIUS_') && key !== 'PORT'));
      const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-test-module-mocks', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60_000, env });
      assert.equal(result.status, 0, result.stderr);
      if (!valid) assert.ok(result.stderr.includes(`${option} needs a non-empty value`), result.stderr);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-cli-plugins-tooling-02 dispatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dispatch-'));
  try {
    for (const args of [[], ['--account', 'Review'], ['--account'], ['--account', ''], ['--account', '--ai-exclude']]) {
      const valid = args.length === 0 || args[1] === 'Review';
      const code = `
        import { mock } from 'node:test';
        import assert from 'node:assert/strict';
        const original = await import(${JSON.stringify(server)});
        const calls = [];
        mock.module(${JSON.stringify(server)}, { namedExports: { ...original, serveStdio: (...args) => calls.push(args) } });
        process.argv = ['node', ${JSON.stringify(main)}, 'mcp', ${JSON.stringify(dir)}, ...${JSON.stringify(args)}];
        process.env.TABULARIUS_PASSWORD = 'synthetic-password';
        await import(${JSON.stringify(main)});
        assert.equal(calls.length, ${valid ? 1 : 0});
        assert.equal(process.exitCode, ${valid ? 0 : 1});
        ${valid ? `assert.deepEqual(calls[0][1], ${args.length === 0 ? '{ admin: true }' : "{ account: 'Review', password: 'synthetic-password' }"});` : ''}
        process.exitCode = 0;
      `;
      const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-test-module-mocks', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60_000 });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
