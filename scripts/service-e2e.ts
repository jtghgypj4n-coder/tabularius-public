// End to end: installs the server as a real service on this machine, then
// upgrades it, then upgrades it to a version that can't start and checks that
// the one before is put back. Run in CI on macOS, Linux and Windows
// (.github/workflows/ci.yml); it needs sudo (macOS, Linux) or an
// administrator (Windows), as it installs a system service.
//
//   node scripts/service-e2e.ts
//
// It works on copies: an "origin" repository cloned from this checkout and an
// install cloned from that, so the upgrades come from commits made here and
// nothing is pushed anywhere.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkHealth, healthUrl, waitForRestart } from '../packages/cli/src/service.ts';

const repo = resolve(import.meta.dirname, '..');
// Not under /tmp: a systemd system unit gets a private one.
const base = mkdtempSync(join(process.env.RUNNER_TEMP ?? homedir(), 'tabularius-e2e-'));
const origin = join(base, 'origin');
const app = join(base, 'app');
const home = join(base, 'home');
const folder = join(base, 'Databases');
const port = 18_080;
const env = { ...process.env, TABULARIUS_HOME: home };
const url = healthUrl({ port, host: '127.0.0.1', extra: [] });
const step = (m: string) => console.log(`\n=== ${m}`);

function sh(cmd: string, args: string[], opts: { cwd?: string; ok?: boolean; shell?: boolean } = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8', shell: opts.shell });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  if (!opts.ok && r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}${r.error ? `: ${r.error.message}` : ''}`);
  return r;
}
const git = (cwd: string, ...args: string[]) => sh('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', '-C', cwd, ...args]).stdout.trim();
const cli = (...args: string[]) => sh(process.execPath, ['--no-warnings', join(app, 'packages', 'cli', 'src', 'main.ts'), ...args], { ok: true });
const commit = (message: string, change: () => void) => {
  change();
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', message);
  return git(origin, 'rev-parse', 'HEAD');
};
async function databases(): Promise<string[]> {
  // A fresh connection each time: a kept-alive one to the server before a restart fails.
  const r = await fetch(`http://127.0.0.1:${port}/`, { headers: { connection: 'close' } }).then((x) => x.json() as Promise<{ databases: string[] }>, () => ({ databases: [] }));
  return r.databases;
}

let installed = false;
try {
  step('copies of this checkout to upgrade from');
  git(base, 'clone', '-q', '--no-hardlinks', repo, origin);
  git(origin, 'checkout', '-q', '-B', 'main');
  git(base, 'clone', '-q', '-b', 'main', origin, app);
  sh(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, shell: process.platform === 'win32' });
  mkdirSync(folder, { recursive: true });
  assert.equal(cli('new', folder, 'Kept').status, 0);

  step('install as a system service');
  const t0 = Date.now();
  const install = cli('service', 'install', folder, '--port', String(port), '--host', '127.0.0.1', '--system', '--', '--list-files-publicly');
  assert.equal(install.status, 0, 'service install');
  installed = true;
  assert.ok(await waitForRestart(url, t0, 90_000), `the service answers at ${url}`);
  assert.deepEqual(await databases(), ['Kept']);

  step('upgrade to a new version');
  const good = commit('a new version', () => writeFileSync(join(origin, 'E2E-VERSION'), '2\n'));
  const up = cli('upgrade', '--wait', '90');
  assert.equal(up.status, 0, 'upgrade');
  assert.equal(git(app, 'rev-parse', 'HEAD'), good);
  assert.equal((await checkHealth(url))?.status, 'ok');
  assert.deepEqual(await databases(), ['Kept'], 'the hosted file is still there');
  const backups = join(folder, 'Backups');
  assert.ok(existsSync(backups) && readdirSync(backups).length > 0, 'backed up before restarting');

  step('upgrade to a version that cannot start: the one before comes back');
  commit('a version that cannot start', () => appendFileSync(join(origin, 'packages', 'server', 'src', 'index.ts'), "\nthrow new Error('broken on purpose by the service test');\n"));
  const bad = cli('upgrade', '--wait', '45');
  assert.notEqual(bad.status, 0, 'the upgrade reports that it failed');
  assert.match(bad.stderr, /was put back and is running/);
  assert.equal(git(app, 'rev-parse', 'HEAD'), good, 'the checkout is back on the good version');
  assert.equal((await checkHealth(url))?.status, 'ok');
  assert.deepEqual(await databases(), ['Kept']);

  step('uninstall');
  assert.equal(cli('service', 'uninstall').status, 0);
  installed = false;
  let gone = false;
  for (let i = 0; i < 60 && !gone; i++) {
    gone = !(await checkHealth(url));
    if (!gone) await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(gone, 'nothing answers once it is uninstalled');
  assert.ok(existsSync(join(folder, 'Kept.openhbam.sqlite')), 'hosted files stay');
  console.log('\nservice end to end: ok');
} catch (e) {
  // What the service itself said, to see why.
  step('the service\'s own output');
  if (process.platform === 'linux') sh('sudo', ['journalctl', '-u', 'openhbam', '--no-pager', '-n', '150'], { ok: true });
  else if (process.platform === 'darwin') sh('cat', [join(home, 'logs', 'server.log')], { ok: true });
  else sh('schtasks', ['/Query', '/TN', 'openhbam', '/V', '/FO', 'LIST'], { ok: true });
  throw e;
} finally {
  if (installed) cli('service', 'uninstall');
}
