// scripts/install.sh installing from a copy (--from) in a throwaway home, against a stand-in app that records
// how the installer called it: an install over an older one is an upgrade, --upgrade and --uninstall refuse
// when nothing is installed, and a missing copy, an unknown option or an unsupported system stop with a reason.
// install-run.test.ts covers the command, the PATH hint and --uninstall. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'install.sh');
const skip = spawnSync('sh', ['-c', 'true']).status === 0 ? false : 'no sh';

/** A stand-in for the program: it appends the arguments it was called with to $TABULARIUS_HOME/calls. */
function fakeApp(dir: string, version: string): string {
  const app = join(dir, `app-${version}`);
  mkdirSync(join(app, 'packages', 'cli', 'src'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'fake-tabularius', version, private: true }));
  writeFileSync(join(app, 'package-lock.json'), JSON.stringify({ name: 'fake-tabularius', version, lockfileVersion: 3, requires: true, packages: { '': { name: 'fake-tabularius', version } } }));
  writeFileSync(join(app, 'packages', 'cli', 'src', 'main.ts'),
    `import { appendFileSync } from 'node:fs';\nimport { join } from 'node:path';\n`
    + `appendFileSync(join(process.env.TABULARIUS_HOME ?? '.', 'calls'), '${version} ' + process.argv.slice(2).join(' ') + '\\n');\n`);
  return app;
}

/** The installer, copied to a place that is not a checkout, so it installs into $TABULARIUS_HOME/app. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-install-'));
  const installer = join(root, 'scripts', 'install.sh');
  mkdirSync(join(root, 'scripts'));
  copyFileSync(script, installer);
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home);
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('sh', [installer, ...args], { env: { ...process.env, HOME: root, TABULARIUS_HOME: home, TABULARIUS_BIN: bin, ...env }, encoding: 'utf8' });
  const calls = () => (existsSync(join(home, 'calls')) ? readFileSync(join(home, 'calls'), 'utf8').trim().split('\n') : []);
  return { root, home, bin, run, calls };
}

test('installing again from a copy is an upgrade of the installed app, not a second install', { skip }, () => {
  const t = setup();
  try {
    assert.equal(t.run(['--from', fakeApp(t.root, '1')]).status, 0);
    const second = fakeApp(t.root, '2');
    const r = t.run(['--from', second]);
    assert.equal(r.status, 0, r.stderr);
    // The installed (old) app is asked to upgrade, and is given where the new version is.
    assert.deepEqual(t.calls(), [`1 upgrade --from ${second}`]);
    assert.ok(readdirSync(join(t.home, 'app')).includes('package.json'));
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});


test('--upgrade and --uninstall refuse when nothing is installed', { skip }, () => {
  const t = setup();
  try {
    for (const flag of ['--upgrade', '--uninstall']) {
      const r = t.run([flag]);
      assert.notEqual(r.status, 0, flag);
      assert.match(r.stderr, /isn't installed/, flag);
    }
    assert.ok(!existsSync(t.bin), 'nothing was put on the machine');
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});


test('a missing copy, an unknown option and an unsupported system stop the installer with a reason', { skip }, () => {
  const t = setup();
  try {
    const missing = t.run(['--from', join(t.root, 'nope')]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /isn't there/);
    const unknown = t.run(['--wat']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown option --wat/);
    const odd = t.run(['--from', fakeApp(t.root, '1'), '--print', '--service', '/srv/x'], { TABULARIUS_OS: 'Plan9' });
    assert.notEqual(odd.status, 0);
    assert.match(odd.stderr, /unsupported system Plan9/);
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});
