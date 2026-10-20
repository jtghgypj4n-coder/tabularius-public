// Services on each system (tabularius service), and upgrading in place (tabularius upgrade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPort, healthUrl, installService, installed, portFree, stopOwnServer, upgrade, winArg, serviceFile, defaults, validateServicePublicUrl, type Installed } from '../src/service.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const print = (...args: string[]) => execFileSync(process.execPath, ['--no-warnings', main, 'service', 'print', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

test('Windows: a Task Scheduler task at logon, or at boot as the system account, started again when it stops', () => {
  const user = print('C:\\Data bases', '--platform', 'win32', '--', '--name', 'Sales "East"');
  assert.match(user, /<LogonTrigger><Enabled>true<\/Enabled><UserId>[^<]+<\/UserId><\/LogonTrigger>/);
  assert.match(user, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(user, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>255<\/Count><\/RestartOnFailure>/);
  assert.match(user, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/, 'no time limit: a server runs for good');
  assert.match(user, /<Arguments>--no-warnings --eval .* \S+main\.ts serve "C:\\Data bases" --port 8080 --host 0\.0\.0\.0 --name "Sales \\"East\\""<\/Arguments>/);
  assert.match(user, /<WorkingDirectory>C:\\Data bases<\/WorkingDirectory>/);
  const system = print('C:\\Data', '--platform', 'win32', '--system', '--port', '443');
  assert.match(system, /<BootTrigger><Enabled>true<\/Enabled><\/BootTrigger>/);
  assert.match(system, /<UserId>S-1-5-18<\/UserId>/);
  assert.doesNotMatch(system, /LogonTrigger/);
  // Well-formed, where xmllint is installed (the file is written as UTF-16; here it is checked as text).
  if (spawnSync('xmllint', ['--version']).status === 0) {
    for (const text of [user, system]) {
      const r = spawnSync('xmllint', ['--noout', '-'], { input: text.replace('encoding="UTF-16"', 'encoding="UTF-8"') });
      assert.equal(r.status, 0, r.stderr.toString());
    }
  }
});

test('Windows arguments are quoted the way programs split them', () => {
  assert.equal(winArg('plain'), 'plain');
  assert.equal(winArg('two words'), '"two words"');
  assert.equal(winArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(winArg('C:\\with space\\'), '"C:\\with space\\\\"', 'a trailing backslash would escape the closing quote');
  assert.equal(winArg(''), '""');
});

test('service.json keeps command line secrets private on Unix', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-service-mode-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  for (const cmd of ['schtasks', 'loginctl']) writeFileSync(join(bin, cmd), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = bin;
    installService({ platform: 'win32', folder: join(dir, 'data'), port: 8080, host: '127.0.0.1', system: false, extra: ['--mcp-token', 'private-token'], node: process.execPath, main, user: 'test', home });
    assert.match(readFileSync(join(home, 'service.json'), 'utf8'), /private-token/);
    assert.equal(statSync(join(home, 'service.json')).mode & 0o777, 0o600);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Linux user service file with command line secrets is private and uses LF', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-linux-unit-mode-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  for (const cmd of ['systemctl', 'loginctl']) writeFileSync(join(bin, cmd), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    const moduleUrl = new URL('../src/service.ts', import.meta.url).href;
    const code = `import { installService } from ${JSON.stringify(moduleUrl)}; installService({ platform: 'linux', folder: ${JSON.stringify(join(dir, 'data'))}, port: 8080, host: '127.0.0.1', system: false, extra: ['--mcp-token', 'private-token'], node: process.execPath, main: '/opt/tabularius/packages/cli/src/main.ts', user: 'test', home: ${JSON.stringify(home)} });`;
    const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env, HOME: home, PATH: bin }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const file = join(home, '.config', 'systemd', 'user', 'openhbam.service');
    const text = readFileSync(file, 'utf8');
    assert.match(text, /private-token/);
    assert.doesNotMatch(text, /\r/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('installed treats an inaccessible service record as absent', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-service-inaccessible-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  writeFileSync(join(home, 'service.json'), '{}');
  chmodSync(home, 0);
  try {
    assert.equal(installed(home), undefined);
  } finally {
    chmodSync(home, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the health check address follows the service\'s port, address and https', () => {
  assert.equal(healthUrl({ port: 8080, host: '0.0.0.0', extra: [] }), 'http://127.0.0.1:8080/tabularius/health');
  assert.equal(healthUrl({ port: 443, host: '0.0.0.0', extra: ['--https', 'files.example.com'] }), 'https://127.0.0.1:443/tabularius/health');
  for (const host of ['::', '::1', '[::1]']) assert.equal(healthUrl({ port: 8080, host, extra: [] }), 'http://[::1]:8080/tabularius/health');
});

test('a service is not installed on a port another program holds; a free one is named', async () => {
  const other = createServer();
  await new Promise<void>((done) => other.listen(0, '0.0.0.0', done));
  const home = mkdtempSync(join(tmpdir(), 'tabularius-port-'));
  try {
    const port = (other.address() as { port: number }).port;
    assert.equal(await portFree(port, '0.0.0.0'), false);
    await assert.rejects(checkPort({ port, host: '0.0.0.0', home, folder: home }), new RegExp(`port ${port} is in use by another program.*Port \\d+ is free: install with --port \\d+`));
    await assert.rejects(checkPort({ port, host: '127.0.0.1', home, folder: home }), /in use/);
    other.close();
    await new Promise((r) => setTimeout(r, 50));
    await checkPort({ port, host: '0.0.0.0', home, folder: home });
  } finally {
    other.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('the installed tabularius service may keep its own port when installed again', async () => {
  const own = createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', uptimeSeconds: 5 })));
  await new Promise<void>((done) => own.listen(0, '127.0.0.1', done));
  const home = mkdtempSync(join(tmpdir(), 'tabularius-port-'));
  try {
    const port = (own.address() as { port: number }).port;
    writeFileSync(join(home, 'service.json'), JSON.stringify({ platform: 'linux', folder: home, port, host: '127.0.0.1', system: false, extra: [] } satisfies Installed));
    await checkPort({ port, host: '127.0.0.1', home, folder: home });
  } finally {
    own.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a LaunchDaemon's server is stopped by its own process id, for launchd to start again", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pid-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const exited = new Promise((done) => child.once('exit', (_code, signal) => done(signal)));
  try {
    assert.equal(stopOwnServer(dir), false, 'no server');
    writeFileSync(join(dir, '.openhbam.pid'), String(child.pid));
    const serviceUrl = new URL('../src/service.ts', import.meta.url).href;
    const stopper = spawn(process.execPath, ['--input-type=module', '-e', `import { stopOwnServer } from ${JSON.stringify(serviceUrl)}; process.exitCode = stopOwnServer(${JSON.stringify(dir)}) ? 0 : 1;`]);
    const [code, signal] = await Promise.all([
      new Promise<number | null>((resolve) => stopper.once('exit', resolve)),
      exited,
    ]);
    assert.equal(code, 0);
    assert.equal(signal, 'SIGTERM');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a server too busy to hear the stop signal is stopped outright after the grace period', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pid-'));
  // Ignores SIGTERM, as a server stuck in one long request does.
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000)']);
  const exited = new Promise((done) => child.once('exit', (_code, signal) => done(signal)));
  const grace = process.env.TABULARIUS_STOP_GRACE_MS;
  process.env.TABULARIUS_STOP_GRACE_MS = '1000';
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`signal-handler child exited before ready (${code})`)));
    });
    writeFileSync(join(dir, '.openhbam.pid'), String(child.pid));
    const started = Date.now();
    assert.equal(stopOwnServer(dir), true);
    assert.ok(Date.now() - started < 5000);
    assert.equal(await exited, 'SIGKILL');
  } finally {
    if (grace === undefined) delete process.env.TABULARIUS_STOP_GRACE_MS;
    else process.env.TABULARIUS_STOP_GRACE_MS = grace;
    if (child.exitCode === null) child.kill('SIGKILL');
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('all service generators reject invalid public URLs before producing configuration', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    for (const value of ['example.com', '', 'https://example.com/path']) {
      assert.throws(() => serviceFile({ ...defaults(platform), folder: '/data', port: 8080, host: '::1', system: false, extra: ['--public-url', value] }), /give a full address/);
    }
  }
});

test('service preflight uses flag over environment without changing persisted arguments', () => {
  const was = process.env.TABULARIUS_PUBLIC_URL;
  process.env.TABULARIUS_PUBLIC_URL = 'example.com';
  try {
    assert.throws(() => validateServicePublicUrl([]), /give a full address/);
    assert.throws(() => validateServicePublicUrl(['--public-url']), /give a full address/);
    const extra = ['--public-url', 'https://例え.テスト/'];
    assert.doesNotThrow(() => validateServicePublicUrl(extra));
    assert.deepEqual(extra, ['--public-url', 'https://例え.テスト/']);
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      assert.throws(() => serviceFile({ ...defaults(platform), folder: '/data', port: 8080, host: '::1', system: false, extra: [] }), /give a full address/);
    }
  } finally {
    if (was === undefined) delete process.env.TABULARIUS_PUBLIC_URL;
    else process.env.TABULARIUS_PUBLIC_URL = was;
  }
});
