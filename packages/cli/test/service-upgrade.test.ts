// Services on each system (tabularius service), and upgrading in place (tabularius upgrade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { DatabaseSync } from 'node:sqlite';
import { checkPort, healthUrl, installService, installed, portFree, stopOwnServer, upgrade, winArg, serviceFile, defaults, validateServicePublicUrl, type Installed } from '../src/service.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

/** A git repository to upgrade from, and a checkout of it, with a package that installs nothing. */
function repos() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upgrade-'));
  const origin = join(dir, 'origin');
  const app = join(dir, 'app');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', '-C', cwd, ...args], { stdio: 'pipe' }).toString().trim();
  mkdirSync(origin);
  git(origin, 'init', '-q');
  writeFileSync(join(origin, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true }));
  writeFileSync(join(origin, 'package-lock.json'), JSON.stringify({ name: 'app', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'app', version: '1.0.0' } } }));
  writeFileSync(join(origin, 'VERSION'), '1');
  git(origin, 'add', '.');
  git(origin, 'commit', '-qm', 'one');
  git(dir, 'clone', '-q', origin, app);
  const release = (v: string) => {
    writeFileSync(join(origin, 'VERSION'), v);
    git(origin, 'commit', '-qam', v);
  };
  const home = join(dir, 'home');
  mkdirSync(home);
  return { dir, app, home, release, head: () => git(app, 'rev-parse', 'HEAD'), git };
}
const hasGit = spawnSync('git', ['--version']).status === 0 && spawnSync('npm', ['--version']).status === 0 ? false : 'needs git and npm';

test('upgrading pulls the new version, refuses a checkout with local changes, and says when there is nothing new', { skip: hasGit }, async () => {
  const r = repos();
  try {
    const was = r.head();
    await upgrade({ app: r.app, home: r.home });
    assert.equal(r.head(), was, 'already up to date');
    r.release('2');
    await upgrade({ app: r.app, home: r.home });
    assert.notEqual(r.head(), was);
    writeFileSync(join(r.app, 'VERSION'), 'mine');
    await assert.rejects(upgrade({ app: r.app, home: r.home }), /local changes/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('with a service: backs up, restarts, waits for it to answer, and goes back when the new version does not start', { skip: hasGit }, async () => {
  const r = repos();
  // A stand-in for the service: answers its health check as a server that has just started.
  let up = true;
  const server = createServer((req, res) => {
    if (!up) return res.destroy();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', uptimeSeconds: 0 }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const port = (server.address() as { port: number }).port;
    const service: Installed = { platform: 'linux', folder: join(r.dir, 'Databases'), port, host: '127.0.0.1', system: false, extra: [] };
    writeFileSync(join(r.home, 'service.json'), JSON.stringify(service));
    const restarts: string[] = [];
    const backups: string[] = [];
    const backup = async (folder: string) => {
      backups.push(folder);
      return join(folder, 'Backups', 'x');
    };

    r.release('2');
    await upgrade({ app: r.app, home: r.home, backup, restart: () => restarts.push(r.head()), waitMs: 5000 });
    assert.deepEqual(backups, [service.folder], 'backed up before the restart');
    assert.equal(restarts.length, 1);
    const good = r.head();

    // The next version never answers: the one before is put back and started again.
    r.release('3');
    up = false;
    let attempt = 0;
    await assert.rejects(
      upgrade({ app: r.app, home: r.home, backup, restart: () => { if (++attempt === 2) up = true; }, waitMs: 1500 }),
      /did not start, so \w+ was put back and is running/,
    );
    assert.equal(r.head(), good);
  } finally {
    server.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('upgrading from a git bundle, with no remote to reach', { skip: hasGit }, async () => {
  const r = repos();
  try {
    r.release('2');
    const bundle = join(r.dir, 'tabularius.bundle');
    r.git(join(r.dir, 'origin'), 'bundle', 'create', bundle, 'HEAD', 'main');
    r.git(r.app, 'remote', 'set-url', 'origin', 'https://github.invalid/private.git');
    await upgrade({ app: r.app, home: r.home, from: bundle });
    assert.equal(readFileSync(join(r.app, 'VERSION'), 'utf8'), '2');
    await upgrade({ app: r.app, home: r.home, from: bundle }); // already there: nothing to do
    assert.equal(readFileSync(join(r.app, 'VERSION'), 'utf8'), '2');
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('upgrading from a tarball or folder swaps it in, and puts the old one back when it does not start', { skip: hasGit }, async () => {
  const r = repos();
  let up = false;
  const server = createServer((req, res) => {
    if (!up) return res.destroy();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', uptimeSeconds: 0 }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    // A release: one folder holding the files, with the program in it.
    const release = (v: string) => {
      const dir = join(r.dir, `release-${v}`, `tabularius-${v}`);
      mkdirSync(join(dir, 'packages', 'cli', 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', 'cli', 'src', 'main.ts'), '');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version: v, private: true, engines: { node: `>=${process.versions.node}` } }));
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'app', version: v, lockfileVersion: 3, requires: true, packages: { '': { name: 'app', version: v } } }));
      writeFileSync(join(dir, 'VERSION'), v);
      return dir;
    };
    const tarball = join(r.dir, 'tabularius-2.0.0.tar.gz');
    execFileSync('tar', ['-czf', tarball, '-C', dirname(release('2.0.0')), 'tabularius-2.0.0']);
    await upgrade({ app: r.app, home: r.home, from: tarball });
    assert.equal(readFileSync(join(r.app, 'VERSION'), 'utf8'), '2.0.0');
    assert.ok(existsSync(join(r.app + '.previous', 'VERSION')), 'the previous version is kept beside it');

    await assert.rejects(upgrade({ app: r.app, home: r.home, from: join(r.dir, 'nothing.tar') }), /isn't there/);
    writeFileSync(join(r.dir, 'other.tar'), '');
    execFileSync('tar', ['-cf', join(r.dir, 'other.tar'), '-C', r.dir, 'home']);
    await assert.rejects(upgrade({ app: r.app, home: r.home, from: join(r.dir, 'other.tar') }), /doesn't hold Tabularius/);
    assert.equal(readFileSync(join(r.app, 'VERSION'), 'utf8'), '2.0.0', 'left as it was');

    // With a service: a folder whose version never answers goes back to the one before.
    const port = (server.address() as { port: number }).port;
    writeFileSync(join(r.home, 'service.json'), JSON.stringify({ platform: 'linux', folder: join(r.dir, 'Databases'), port, host: '127.0.0.1', system: false, extra: [] } satisfies Installed));
    let attempt = 0;
    await assert.rejects(
      upgrade({ app: r.app, home: r.home, from: release('3.0.0'), restart: () => { if (++attempt === 2) up = true; }, waitMs: 1500 }),
      /upgrade to 3\.0\.0 did not start, so 2\.0\.0 was put back and is running/,
    );
    assert.equal(readFileSync(join(r.app, 'VERSION'), 'utf8'), '2.0.0');
  } finally {
    server.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('an incompatible folder or tarball leaves the installed app, previous version and service untouched', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-node-upgrade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, 'app');
  const home = join(dir, 'home');
  const source = join(dir, 'release');
  for (const folder of [app, home, `${app}.previous`, join(source, 'packages', 'cli', 'src')]) mkdirSync(folder, { recursive: true });
  const pkg = JSON.stringify({ name: 'app', version: '1.0.0', private: true });
  writeFileSync(join(app, 'package.json'), pkg);
  writeFileSync(join(app, 'VERSION'), 'installed');
  writeFileSync(join(`${app}.previous`, 'VERSION'), 'previous');
  const service = JSON.stringify({ platform: 'linux', folder: dir, port: 8080, host: '127.0.0.1', system: false, extra: [] } satisfies Installed);
  writeFileSync(join(home, 'service.json'), service);
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const ranges = [`>=${major}.${minor}.${patch + 1}`, `>=${major}.${minor + 1}`, `>=${major + 1}.0`];
  let backups = 0;
  let restarts = 0;
  const before = statSync(app);
  const unchanged = () => {
    assert.deepEqual(readdirSync(app).sort(), ['VERSION', 'package.json']);
    assert.equal(readFileSync(join(app, 'VERSION'), 'utf8'), 'installed');
    assert.equal(readFileSync(join(app, 'package.json'), 'utf8'), pkg);
    assert.equal(statSync(app).ino, before.ino);
    assert.equal(statSync(app).mtimeMs, before.mtimeMs);
    assert.equal(readFileSync(join(`${app}.previous`, 'VERSION'), 'utf8'), 'previous');
    assert.equal(readFileSync(join(home, 'service.json'), 'utf8'), service);
    assert.equal(existsSync(`${app}.incoming`), false);
    assert.equal(existsSync(`${app}.failed`), false);
    assert.equal(backups, 0);
    assert.equal(restarts, 0);
  };
  writeFileSync(join(source, 'packages', 'cli', 'src', 'main.ts'), '');
  for (const range of ranges) {
    writeFileSync(join(source, 'package.json'), JSON.stringify({ version: '2.0.0', engines: { node: range } }));
    await assert.rejects(upgrade({ app, home, from: source, backup: async () => { backups++; return ''; }, restart: () => { restarts++; } }), /needs Node >=.*running Node/);
    unchanged();
  }
  const tarball = join(dir, 'release.tar');
  execFileSync('tar', ['-cf', tarball, '-C', dir, 'release']);
  await assert.rejects(upgrade({ app, home, from: tarball, restart: () => { restarts++; } }), /needs Node >=.*running Node/);
  unchanged();
  for (const [contents, message] of [
    [JSON.stringify({ version: '2.0.0' }), /missing engines\.node/],
    [JSON.stringify({ version: '2.0.0', engines: { node: 22 } }), /non-string engines\.node/],
    [JSON.stringify({ version: '2.0.0', engines: { node: '^22.18.0' } }), /unsupported engines\.node/],
  ] as const) {
    writeFileSync(join(source, 'package.json'), contents);
    await assert.rejects(upgrade({ app, home, from: source, backup: async () => { backups++; return ''; }, restart: () => { restarts++; } }), message);
    unchanged();
    execFileSync('tar', ['-cf', tarball, '-C', dir, 'release']);
    await assert.rejects(upgrade({ app, home, from: tarball, backup: async () => { backups++; return ''; }, restart: () => { restarts++; } }), message);
    unchanged();
  }
  for (const contents of ['{', JSON.stringify({ engines: { node: '^22.18.0' } })]) {
    writeFileSync(join(source, 'package.json'), contents);
    await assert.rejects(upgrade({ app, home, from: source }));
    unchanged();
  }
});

test('an invalid folder is rejected before touching an existing incoming directory', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-node-order-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, 'app');
  const source = join(dir, 'release');
  const incoming = `${app}.incoming`;
  for (const folder of [app, incoming, join(source, 'packages', 'cli', 'src')]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(app, 'VERSION'), 'installed');
  writeFileSync(join(incoming, 'KEEP'), 'untouched');
  writeFileSync(join(source, 'packages', 'cli', 'src', 'main.ts'), '');
  const before = statSync(incoming);
  for (const contents of [JSON.stringify({ version: '2.0.0' }), JSON.stringify({ engines: { node: 22 } }), JSON.stringify({ engines: { node: '^22.18.0' } })]) {
    writeFileSync(join(source, 'package.json'), contents);
    await assert.rejects(upgrade({ app, home: dir, from: source }), /engines\.node/);
    assert.equal(readFileSync(join(incoming, 'KEEP'), 'utf8'), 'untouched');
    assert.equal(statSync(incoming).ino, before.ino);
    assert.equal(statSync(incoming).mtimeMs, before.mtimeMs);
    assert.equal(readFileSync(join(app, 'VERSION'), 'utf8'), 'installed');
  }
});

test('upgrade --from exits 1 for an incompatible folder before changing the installed app or service', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-node-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, 'app');
  const home = join(dir, 'home');
  const source = join(dir, 'release');
  for (const folder of [app, home, join(source, 'packages', 'cli', 'src')]) mkdirSync(folder, { recursive: true });
  // Run the real CLI through a temporary installation path, preserving it for relative imports.
  symlinkSync(join(import.meta.dirname, '..', '..'), join(app, 'packages'), 'junction');
  symlinkSync(join(import.meta.dirname, '..', '..', '..', 'node_modules'), join(app, 'node_modules'), 'junction');
  const pkg = JSON.stringify({ type: 'module', engines: { node: '>=22.18' }, version: '1.0.0' });
  writeFileSync(join(app, 'package.json'), pkg);
  const service = JSON.stringify({ platform: 'linux', folder: dir, port: 8080, host: '127.0.0.1', system: false, extra: [] } satisfies Installed);
  writeFileSync(join(home, 'service.json'), service);
  const next = Number(process.versions.node.split('.')[0]) + 1;
  writeFileSync(join(source, 'packages', 'cli', 'src', 'main.ts'), '');
  for (const [release, message] of [
    [{ engines: { node: `>=${next}.0` }, version: '2.0.0' }, new RegExp(`needs Node >=${next}\\.0; running Node`)],
    [{ version: '2.0.0' }, /missing engines\.node/],
    [{ engines: { node: 22 }, version: '2.0.0' }, /non-string engines\.node/],
    [{ engines: { node: '^22.18.0' }, version: '2.0.0' }, /unsupported engines\.node/],
  ] as const) {
    writeFileSync(join(source, 'package.json'), JSON.stringify(release));
    const r = spawnSync(process.execPath, ['--no-warnings', '--preserve-symlinks', '--preserve-symlinks-main', join(app, 'packages', 'cli', 'src', 'main.ts'), 'upgrade', '--from', source], {
      encoding: 'utf8', env: { ...process.env, TABULARIUS_HOME: home }, timeout: 15_000,
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, message);
    assert.equal(readFileSync(join(app, 'package.json'), 'utf8'), pkg);
    assert.equal(readFileSync(join(home, 'service.json'), 'utf8'), service);
    assert.equal(existsSync(`${app}.previous`), false);
    assert.equal(existsSync(`${app}.incoming`), false);
  }
});

test('a restart that fails puts the previous version back, so the install matches the server still running', { skip: hasGit }, async () => {
  const r = repos();
  try {
    const service: Installed = { platform: 'darwin', folder: join(r.dir, 'Databases'), port: 1, host: '127.0.0.1', system: true, extra: [] };
    writeFileSync(join(r.home, 'service.json'), JSON.stringify(service));
    const was = r.head();
    r.release('2');
    await assert.rejects(
      upgrade({ app: r.app, home: r.home, restart: () => { throw new Error('sudo: a terminal is required'); }, waitMs: 500 }),
      /restarting the service failed \(sudo: a terminal is required\), so \w+ was put back; the server is still running/,
    );
    assert.equal(r.head(), was);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a new version whose server never comes up is given up on early, not after the whole wait', { skip: hasGit }, async () => {
  const r = repos();
  try {
    const folder = join(r.dir, 'Databases');
    mkdirSync(folder);
    const service: Installed = { platform: 'linux', folder, port: 1, host: '127.0.0.1', system: false, extra: [] };
    writeFileSync(join(r.home, 'service.json'), JSON.stringify(service));
    r.release('2');
    const started = Date.now();
    await assert.rejects(
      upgrade({ app: r.app, home: r.home, restart: () => {}, waitMs: 60_000, deadMs: 1500 }),
      /did not start, so \w+ was put back, but it isn't answering either/,
    );
    assert.ok(Date.now() - started < 15_000, `gave up after ${Date.now() - started} ms`);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});


test('upgrade refuses invalid persisted public URLs before fetching, backing up or restarting', { skip: hasGit }, async () => {
  const r = repos();
  try {
    const service: Installed = { platform: 'linux', folder: r.dir, port: 8080, host: '127.0.0.1', system: false, extra: ['--public-url', 'example.com'] };
    const record = JSON.stringify(service);
    writeFileSync(join(r.home, 'service.json'), record);
    const head = r.head();
    r.release('2');
    let backups = 0;
    let restarts = 0;
    await assert.rejects(upgrade({ app: r.app, home: r.home, backup: async () => { backups++; return ''; }, restart: () => { restarts++; } }), /give a full address/);
    assert.equal(r.head(), head, 'the installed version stays unchanged');
    assert.equal(readFileSync(join(r.home, 'service.json'), 'utf8'), record);
    assert.equal(backups, 0);
    assert.equal(restarts, 0, 'the old service keeps running');
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('an upgrade will not put in place a version that reads an older file format than the folder is in', { skip: hasGit }, async () => {
  const r = repos();
  try {
    const folder = join(r.dir, 'Databases');
    mkdirSync(folder);
    const store = join(folder, 'Shop.openhbam.sqlite');
    createStore(store);
    new Store(store, 'Shop').close();
    const setFormat = (n: number) => {
      const sql = new DatabaseSync(store);
      sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(n));
      sql.close();
    };
    const origin = join(r.dir, 'origin');
    const readsFormat = (n: number | undefined) => {
      mkdirSync(join(origin, 'packages', 'store', 'src'), { recursive: true });
      if (n === undefined) rmSync(join(origin, 'packages', 'store', 'src', 'store-format.ts'), { force: true });
      else writeFileSync(join(origin, 'packages', 'store', 'src', 'store-format.ts'), `export const STORE_FORMAT = ${n};\n`);
      r.git(origin, 'add', '-A');
      r.git(origin, 'commit', '-qm', `reads ${n}`, '--allow-empty');
    };
    const service: Installed = { platform: 'linux', folder, port: 1, host: '127.0.0.1', system: false, extra: [] };
    writeFileSync(join(r.home, 'service.json'), JSON.stringify(service));
    const restarts: string[] = [];
    const options = { app: r.app, home: r.home, restart: () => { restarts.push(r.head()); }, waitMs: 500, deadMs: 100 };
    const was = r.head();

    // The folder is in a format 2 file; the next version reads up to 1: refused, nothing restarted, the checkout as it was.
    setFormat(2);
    readsFormat(1);
    await assert.rejects(upgrade(options), /upgrade refused, so \w+ stays and the service was not restarted: Shop was written by a newer Tabularius than the version being installed \(it reads file format 1; the file is in format 2\), so it would leave it closed/);
    assert.equal(r.head(), was);
    assert.deepEqual(restarts, []);

    // A version that reads up to 2 goes ahead as far as the restart (the stand-in service never answers, so it is put back).
    readsFormat(2);
    await assert.rejects(upgrade(options), /did not start|going back|put back/);
    assert.equal(restarts.length >= 1, true, 'it got as far as the restart');

    // A build from before files were numbered says nothing about what it reads, so it is not refused on that ground.
    readsFormat(undefined);
    const before = restarts.length;
    await assert.rejects(upgrade(options), /did not start|put back/);
    assert.ok(restarts.length > before);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('when a new version fails to start after raising a file format, the put-back says which files stay closed and how to restore them', { skip: hasGit }, async () => {
  const r = repos();
  try {
    const folder = join(r.dir, 'Databases');
    mkdirSync(folder);
    const store = join(folder, 'Shop.openhbam.sqlite');
    createStore(store);
    new Store(store, 'Shop').close();
    const raise = () => {
      const sql = new DatabaseSync(store);
      sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(2));
      sql.close();
    };
    const origin = join(r.dir, 'origin');
    const reads = (n: number) => {
      mkdirSync(join(origin, 'packages', 'store', 'src'), { recursive: true });
      writeFileSync(join(origin, 'packages', 'store', 'src', 'store-format.ts'), `export const STORE_FORMAT = ${n};\n`);
      r.git(origin, 'add', '-A');
      r.git(origin, 'commit', '-qm', `reads ${n}`, '--allow-empty');
    };
    const service: Installed = { platform: 'linux', folder, port: 1, host: '127.0.0.1', system: false, extra: [] };
    writeFileSync(join(r.home, 'service.json'), JSON.stringify(service));
    const backup = async () => join(folder, 'Backups', '2026-10-17_120000');
    // The installed version reads format 1.
    reads(1);
    r.git(r.app, 'pull', '-q');
    const old = r.head();
    // The next version starts, records format 2 in the file, and then fails its health check.
    reads(2);
    await assert.rejects(
      upgrade({ app: r.app, home: r.home, backup, restart: () => { if (r.head() !== old) raise(); }, waitMs: 300, deadMs: 100 }),
      /did not start, so \w+ was put back.*Shop to a format that the version put back \(file format 1\) does not read, so it stays closed until you stop the service and run: tabularius restore .*Databases 2026-10-17_120000/,
    );
    assert.equal(r.head(), old);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});
