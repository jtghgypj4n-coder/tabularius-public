// Checks a single-file build (scripts/build-release.ts) on the machine it was
// built for: it unpacks itself, runs commands, hosts a FileMaker file
// (converted on a worker thread), serves the admin console and web client,
// runs as several processes, and runs JavaScript custom functions in their sandbox.
//
//   node scripts/release-smoke.ts dist/tabularius-<version>-<os>-<cpu>

import '../packages/store/src/legacy-env.ts';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMcpE2E } from './mcp-e2e.ts';

// dist/tabularius-* also matches the bill of materials and checksums written beside the program.
const exe = resolve(process.argv.slice(2).find((a) => !/\.(?:sbom\.cdx\.json|sha256|pack|md)$/.test(a)) ?? '');
assert.ok(existsSync(exe), `no program at ${exe}`);
const fixture = join(import.meta.dirname, '..', 'fixtures', 'fmp12', 'Charts.fmp12');
assert.ok(existsSync(fixture), 'run npm run fixtures first');
const work = mkdtempSync(join(tmpdir(), 'tabularius-smoke-'));
const env = { ...process.env, TABULARIUS_HOME: join(work, 'home') };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function serving(args: string[], port: number) {
  const folder = join(work, `Databases-${port}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  assert.equal(spawnSync(exe, ['new', folder, 'Empty'], { env }).status, 0, 'tabularius new');
  copyFileSync(fixture, join(folder, 'Charts.fmp12'));
  const server = spawn(exe, ['serve', folder, '--port', String(port), '--no-backups', '--list-files-publicly', ...args], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    let names: string[] = [];
    let exited: number | null = null;
    server.once('exit', (code) => (exited = code ?? -1));
    for (let i = 0; i < 240 && !names.includes('Charts'); i++) {
      if (exited !== null) assert.fail(`the server stopped (exit ${exited})`);
      names = await fetch(`${base}/`).then((r) => r.json() as Promise<{ databases: string[] }>).then((r) => r.databases, () => []);
      if (!names.includes('Charts')) await sleep(250);
    }
    assert.deepEqual(names.sort(), ['Charts', 'Empty'], 'the .fmp12 file is converted and hosted');
    for (const path of ['/admin/', '/app/', '/tabularius/health']) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200, path);
    }
    const app = await (await fetch(`${base}/app/`)).text();
    const script = /src="([^"]+\.js)"/.exec(app)?.[1];
    if (script) assert.equal((await fetch(new URL(script, `${base}/app/`))).status, 200, 'the web client\'s code');
  } finally {
    // Windows doesn't stop a process's children with it: stop the workers too.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f']);
    else server.kill();
    if (server.exitCode === null && server.signalCode === null) await new Promise((r) => server.once('exit', r));
  }
}

try {
  const help = spawnSync(exe, ['--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /tabularius serve <folder>/);
  assert.doesNotMatch(help.stderr, /ExperimentalWarning/);
  const info = spawnSync(exe, ['info', fixture], { env, encoding: 'utf8' });
  assert.equal(info.status, 0, info.stderr);
  assert.equal(JSON.parse(info.stdout).tables, 10);
  // A JavaScript custom function runs, in its sandbox: no files, no process.
  const runtime = join(env.TABULARIUS_HOME, 'runtime', readdirSync(join(env.TABULARIUS_HOME, 'runtime')).find((d) => !d.includes('.partial-'))!);
  const check = join(work, 'js-check.mjs');
  writeFileSync(check, [
    `import { callJavaScript, stopJavaScript } from ${JSON.stringify(pathToFileURL(join(runtime, 'packages', 'store', 'src', 'javascript.ts')).href)};`,
    `const run = (source) => { try { return callJavaScript({ name: 'Fn', parameters: [], source }, []).value; } catch (e) { return '? ' + e.message; } };`,
    `console.log(JSON.stringify([run('return 2 + 3'), run('return typeof process + "," + typeof require')]));`,
    'void stopJavaScript();',
  ].join('\n'));
  const js = spawnSync(exe, [check], { env, encoding: 'utf8' });
  assert.equal(js.status, 0, js.stderr);
  assert.deepEqual(JSON.parse(js.stdout.trim().split('\n').pop()!), [5, 'undefined,undefined'], 'JavaScript custom functions');
  await serving([], 18_091);
  await serving(['--workers', '2'], 18_092);
  await runMcpE2E(exe); // an AI app connecting to the built program
  console.log('single-file build: ok');
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10 });
}
