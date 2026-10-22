import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serviceSummary, type ServiceOptions } from '../src/service.ts';

const options: ServiceOptions = { platform: 'win32', folder: 'C:\\Data', port: 8080, host: '127.0.0.1', system: false, extra: ['--mcp-token', ['local', 'secret'].join('-')], node: 'C:\\node.exe', main: 'C:\\app\\main.ts', user: 'Example', home: 'C:\\Users\\Example\\.openhbam' };
test('service summary does not claim Windows secrets are owner-only', () => {
  const message = serviceSummary(options, []).join('\n');
  assert.doesNotMatch(message, /only your account can read/);
  assert.match(message, /ACL/);
});

import { listenForStop, requestStop } from '../src/stop-request.ts';
import { stopOwnServer } from '../src/service.ts';

test('Windows stop listener ignores stale/malformed requests and invokes graceful cleanup once', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-stop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['setInterval'] });
  const pid = 12345;
  const file = join(root, `.openhbam-stop-${pid}`);
  requestStop(root, pid);
  let stops = 0;
  const dispose = listenForStop(root, () => stops++, 'win32', pid);
  t.after(dispose);
  assert.equal(existsSync(file), false);
  t.mock.timers.tick(300);
  assert.equal(stops, 0);
  writeFileSync(file, 'other pid');
  t.mock.timers.tick(300);
  assert.equal(stops, 0);
  rmSync(file);
  requestStop(root, pid);
  requestStop(root, pid);
  t.mock.timers.tick(300);
  assert.equal(stops, 1);
  assert.equal(existsSync(file), false);
  t.mock.timers.tick(300);
  assert.equal(stops, 1);
});

test('Windows stop waits for cleanup and refuses force termination on timeout or permission failure', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-stop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.openhbam.pid'), '12345');
  const signals: unknown[] = [];
  let requested = 0;
  const control = { kill: (_pid: number, signal?: string | number) => { signals.push(signal); return true as const; }, exited: () => true, request: () => { requested++; } };
  assert.equal(stopOwnServer(root, 'win32', control), true);
  assert.equal(requested, 1);
  assert.deepEqual(signals, [0]);
  control.exited = () => false;
  assert.throws(() => stopOwnServer(root, 'win32', control), /not stop gracefully/);
  assert.deepEqual(signals, [0, 0]);
  control.request = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  assert.throws(() => stopOwnServer(root, 'win32', control), { code: 'EACCES' });
});

test('POSIX listener makes no Windows request file and stop still uses SIGTERM', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-stop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.openhbam.pid'), '12345');
  listenForStop(root, () => assert.fail('unexpected stop'), 'linux')();
  const signals: unknown[] = [];
  stopOwnServer(root, 'linux', { kill: (_pid, signal) => { signals.push(signal); return true as const; }, exited: () => true, request: () => assert.fail('unexpected request') });
  assert.deepEqual(signals, ['SIGTERM']);
});

import { publishUpgrade } from '../src/service.ts';
test('upgrade restores the previous app if publishing the staged directory fails', () => {
  const paths = new Set(['app', 'staged']);
  const calls: string[] = [];
  const move = (from: string, to: string) => {
    calls.push(`${from}:${to}`);
    if (from === 'staged') throw Object.assign(new Error('locked'), { code: 'EPERM' });
    assert.ok(paths.delete(from)); paths.add(to);
  };
  assert.throws(() => publishUpgrade('app', 'staged', move), { code: 'EPERM' });
  assert.ok(paths.has('app') && paths.has('staged'));
  assert.deepEqual(calls, ['app:app.previous', 'staged:app', 'app.previous:app']);
});

import { diagnosticRoot } from '../src/diagnostics.ts';
test('diagnostic repository root decodes spaces and drive letters from file URLs', () => {
  assert.equal(diagnosticRoot('file:///C:/Program%20Files/app/packages/cli/src/diagnostics.ts', 'win32'), 'C:\\Program Files\\app');
  assert.equal(diagnosticRoot('file:///srv/my%20app/packages/cli/src/diagnostics.ts', 'linux'), '/srv/my app');
});

import { resolveAiKey } from '../src/ai-key.ts';
test('Windows key loading accepts CRLF without pretending chmod protects the key', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-key-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'key');
  const secret = ['generated', 'value'].join('-');
  writeFileSync(file, '\uFEFF' + secret + '\r\n', { mode: 0o644 });
  assert.equal(resolveAiKey({}, file, undefined, 'win32').apiKey, secret);
});

test('stopping through a signal disposes the file listener before a second request can force exit', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-stop-dispose-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['setInterval'] });
  let stops = 0;
  const dispose = listenForStop(root, () => stops++, 'win32', 12345);
  dispose();
  requestStop(root, 12345);
  t.mock.timers.tick(500);
  assert.equal(stops, 0);
});
