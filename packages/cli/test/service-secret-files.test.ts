import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installService, serviceSummary, type ServiceOptions } from '../src/service.ts';
import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';

const serviceModule = new URL('../src/service.ts', import.meta.url).href;

function options(dir: string, extra: string[]): ServiceOptions {
  return { platform: 'win32', folder: join(dir, 'data'), port: 8080, host: '127.0.0.1', system: false, extra, node: process.execPath, main: join(import.meta.dirname, '..', 'src', 'main.ts'), user: 'test', home: join(dir, 'home') };
}

test('service install stores an absolute token file path without storing or printing its contents', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-service-token-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 't');
  const token = 'correct-horse-battery';
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  const code = `
    import { mock } from 'node:test';
    const childProcess = await import('node:child_process');
    mock.module('node:child_process', { namedExports: { ...childProcess, spawnSync: () => ({ status: 0 }) } });
    const { installService } = await import(${JSON.stringify(serviceModule)});
    installService(${JSON.stringify(options(dir, ['--mcp-token-file', './t']))});
  `;
  const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-test-module-mocks', '--input-type=module', '-e', code], { cwd: dir, env: commandStubEnv(t), encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  const task = readFileSync(join(dir, 'home', 'openhbam-task.xml')).toString('utf16le');
  const record = readFileSync(join(dir, 'home', 'service.json'), 'utf8');
  assert.ok(task.includes(file), 'the service command uses the absolute path');
  assert.ok(record.includes(file), 'the saved service options use the absolute path');
  assert.ok(!`${task}\n${record}\n${result.stdout}\n${result.stderr}`.includes(token), 'no token value is stored or printed');
  assert.doesNotMatch(result.stderr, /written into the service file/);
  assert.match(result.stderr, /--mcp-token-file is named by path/);
});

test('service install rejects a readable token file before writing anything', { skip: process.platform === 'win32' ? 'file modes' : false }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-service-token-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 't');
  writeFileSync(file, 'correct-horse-battery');
  chmodSync(file, 0o644);
  assert.throws(() => installService(options(dir, ['--mcp-token-file', file])), /chmod 600/);
  assert.equal(existsSync(join(dir, 'home')), false);
  assert.deepEqual(readdirSync(dir), ['t']);
});

test('service install rejects duplicate file options before writing anything', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-service-token-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 't');
  writeFileSync(file, 'correct-horse-battery', { mode: 0o600 });
  assert.throws(() => installService(options(dir, ['--mcp-token-file', file, '--mcp-token-file', file])), /--mcp-token-file was given more than once/);
  assert.equal(existsSync(join(dir, 'home')), false);
});

test('inline token install summary keeps the existing note and names only inline options', () => {
  const lines = serviceSummary({ folder: '/srv/data', port: 8080, host: '127.0.0.1', extra: ['--mcp-token', 'inline-word'] }, []);
  assert.ok(lines.some((line) => /--mcp-token is written into the service file, which only your account can read/.test(line)));
  assert.ok(lines.every((line) => !line.includes('inline-word')));
});
