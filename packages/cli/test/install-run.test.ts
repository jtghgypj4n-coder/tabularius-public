// scripts/install.sh run for real in a temporary home, against a stand-in app with no dependencies (so `npm ci`
// needs no network): the Tabularius command it writes, the PATH hint, a second run over the first, and --uninstall
// leaving the hosted folder alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const real = join(import.meta.dirname, '..', '..', '..', 'scripts', 'install.sh');
const skip = process.platform === 'win32' ? 'install.sh runs on macOS and Linux' : false;

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-install-'));
  const app = join(root, 'app');
  mkdirSync(join(app, 'scripts'), { recursive: true });
  mkdirSync(join(app, 'packages', 'cli', 'src'), { recursive: true });
  copyFileSync(real, join(app, 'scripts', 'install.sh'));
  chmodSync(join(app, 'scripts', 'install.sh'), 0o755);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'stand-in', version: '1.0.0', private: true }));
  writeFileSync(join(app, 'package-lock.json'), JSON.stringify({ name: 'stand-in', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'stand-in', version: '1.0.0' } } }));
  // The stand-in command line prints what it was asked.
  writeFileSync(join(app, 'packages', 'cli', 'src', 'main.ts'), 'console.log("ran " + process.argv.slice(2).join(" "));\n');
  const home = join(root, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, TABULARIUS_HOME: join(home, '.openhbam'), TABULARIUS_BIN: join(home, 'bin'), PATH: process.env.PATH ?? '' };
  const run = (...args: string[]) => spawnSync('sh', [join(app, 'scripts', 'install.sh'), ...args], { env, encoding: 'utf8', timeout: 120_000 });
  return { root, app, home, env, run, bin: join(home, 'bin', 'tabularius') };
}

test('install writes a Tabularius command that runs the app, says to add its folder to PATH, and a second run is the same', { skip }, () => {
  const t = setup();
  try {
    const first = t.run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stderr, /Installed .*bin\/tabularius/);
    assert.match(first.stderr, /Add .*bin to your PATH/);
    assert.ok(existsSync(t.bin));
    const ran = spawnSync(t.bin, ['serve', 'x'], { env: t.env, encoding: 'utf8' });
    assert.equal(ran.stdout.trim(), 'ran serve x');
    const launcher = readFileSync(t.bin, 'utf8');
    const second = t.run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(t.bin, 'utf8'), launcher);
    // With the folder on PATH there is nothing to add.
    const onPath = spawnSync('sh', [join(t.app, 'scripts', 'install.sh')], { env: { ...t.env, PATH: `${join(t.home, 'bin')}:${t.env.PATH}` }, encoding: 'utf8' });
    assert.doesNotMatch(onPath.stderr, /to your PATH/);
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});

test('install refuses an option it does not know and writes nothing', { skip }, () => {
  const t = setup();
  try {
    const r = t.run('--frobnicate');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown option --frobnicate/);
    assert.ok(!existsSync(t.bin));
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});

test('--uninstall asks the app to remove the service and leaves the hosted folder and the command alone', { skip }, () => {
  const t = setup();
  try {
    const hosted = join(t.home, 'Databases');
    mkdirSync(hosted);
    writeFileSync(join(hosted, 'Mine.fmp12'), 'data');
    assert.equal(t.run().status, 0);
    const r = t.run('--uninstall');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ran service uninstall --platform (darwin|linux)/);
    assert.equal(readFileSync(join(hosted, 'Mine.fmp12'), 'utf8'), 'data');
    assert.ok(existsSync(t.bin));
  } finally {
    rmSync(t.root, { recursive: true, force: true });
  }
});
