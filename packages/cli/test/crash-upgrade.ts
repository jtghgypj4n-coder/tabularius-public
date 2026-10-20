import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serviceFile } from '../src/service.ts';

// No npm install or service restart: these tests exercise the real folder swap
// with two tiny generated releases, and stub only the subprocess boundary.
const service = new URL('../src/service.ts', import.meta.url).href;
const hook = new URL('../../store/src/crash-point.ts', import.meta.url).href;
const checkpoints = ['after-stage', 'after-save', 'after-publish', 'after-cleanup', 'after-failed-save', 'after-rollback'];

function release(path: string, version: string): void {
  mkdirSync(join(path, 'packages/cli/src'), { recursive: true });
  writeFileSync(join(path, 'packages/cli/src/main.ts'), `console.log(JSON.stringify({ version: "${version}", args: process.argv.slice(2), execArgv: process.execArgv }));\n`);
  writeFileSync(join(path, 'package.json'), JSON.stringify({ version, engines: { node: '>=22.18.0' } }));
}

for (const step of checkpoints) test(`upgrade:${step}`, { concurrency: false }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-crash-upgrade-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, 'app'); const source = join(root, 'release');
  release(app, '1'); release(source, '2');
  const unit = serviceFile({ platform: 'linux', folder: root, port: 8080, host: '127.0.0.1', system: false, extra: [], node: process.execPath, main: join(app, 'packages/cli/src/main.ts'), user: 'test', home: join(root, 'home') }).text;
  const command = unit.match(/^ExecStart=(.*)$/m)![1].match(/"(?:[^"\\]|\\.)*"|\S+/g)!.map((s) => (s.startsWith('"') ? JSON.parse(s) as string : s).replaceAll('%%', '%'));
  const [node, ...args] = command;
  const run = (checkpoint?: string) => spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    cp.spawnSync = () => ({ status: ${checkpoint && ['after-failed-save', 'after-rollback'].includes(step) ? 1 : 0} });
    syncBuiltinESMExports();
    const { upgrade } = await import(${JSON.stringify(service)});
    const { armCrashPointForTest } = await import(${JSON.stringify(hook)});
    ${checkpoint ? `armCrashPointForTest(${JSON.stringify(checkpoint)});` : ''}
    await upgrade({ app: ${JSON.stringify(app)}, from: ${JSON.stringify(source)}, home: ${JSON.stringify(join(root, 'home'))} });
  `], { encoding: 'utf8', timeout: 20_000 });
  const child = run(`upgrade:${step}`);
  assert.equal(child.status, 73, child.stderr || child.stdout);
  // Start the saved service command, with no recovery helper imported from the checkout.
  const recovery = spawnSync(node, args, { encoding: 'utf8', timeout: 20_000 });
  assert.equal(recovery.status, 0, recovery.stderr);
  const started = JSON.parse(recovery.stdout);
  assert.deepEqual(started.args, ['serve', root, '--port', '8080', '--host', '127.0.0.1']);
  const version = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;
  assert.equal(version, ['after-publish', 'after-cleanup'].includes(step) ? '2' : '1');
  assert.deepEqual(started.execArgv, ['--no-warnings'], 'forked server workers must not inherit the recovery eval');
  assert.equal(started.version, version);
  assert.equal(readFileSync(join(app, 'packages/cli/src/main.ts'), 'utf8'), `console.log(JSON.stringify({ version: "${version}", args: process.argv.slice(2), execArgv: process.execArgv }));\n`);
  const again = run();
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '2');
  assert.equal(existsSync(app + '.incoming'), false);
});
