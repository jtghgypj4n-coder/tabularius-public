import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upgrade, type Installed } from '../src/service.ts';

test('AR-cli-plugins-tooling-06', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-upgrade-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, 'app');
  const source = join(root, 'release');
  const home = join(root, 'home');
  for (const path of [app, source, home, join(source, 'packages', 'cli', 'src')]) mkdirSync(path, { recursive: true });
  const packageText = (version: string) => JSON.stringify({ name: 'synthetic-app', version, private: true, engines: { node: `>=${process.versions.node}` } });
  const lockText = (version: string) => JSON.stringify({ name: 'synthetic-app', version, lockfileVersion: 3, requires: true, packages: { '': { name: 'synthetic-app', version } } });
  for (const [folder, version] of [[app, '1.0.0'], [source, '2.0.0']] as const) {
    writeFileSync(join(folder, 'package.json'), packageText(version));
    writeFileSync(join(folder, 'package-lock.json'), lockText(version));
  }
  writeFileSync(join(source, 'packages', 'cli', 'src', 'main.ts'), '');
  writeFileSync(join(home, 'service.json'), JSON.stringify({ platform: 'linux', folder: join(root, 'data'), port: 8080, host: '127.0.0.1', system: false, extra: [] } satisfies Installed));
  let restarts = 0;
  let backups = 0;
  await assert.rejects(upgrade({ app, from: source, home, backup: async () => { backups++; throw new Error('synthetic backup failed'); }, restart: () => { restarts++; } }), /synthetic backup failed/);
  assert.equal(backups, 1);
  assert.equal(restarts, 0);
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '1.0.0');
});

test('a failed backup is reported first when putting the old dependencies back also fails', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-upgrade-backup-reinstall-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, 'app');
  const source = join(root, 'release');
  const home = join(root, 'home');
  for (const path of [app, source, home, join(source, 'packages', 'cli', 'src')]) mkdirSync(path, { recursive: true });
  const packageText = (version: string) => JSON.stringify({ name: 'synthetic-app', version, private: true, engines: { node: `>=${process.versions.node}` } });
  const lockText = (version: string) => JSON.stringify({ name: 'synthetic-app', version, lockfileVersion: 3, requires: true, packages: { '': { name: 'synthetic-app', version } } });
  for (const [folder, version] of [[app, '1.0.0'], [source, '2.0.0']] as const) {
    writeFileSync(join(folder, 'package.json'), packageText(version));
    writeFileSync(join(folder, 'package-lock.json'), lockText(version));
  }
  writeFileSync(join(source, 'packages', 'cli', 'src', 'main.ts'), '');
  writeFileSync(join(home, 'service.json'), JSON.stringify({ platform: 'linux', folder: join(root, 'data'), port: 8080, host: '127.0.0.1', system: false, extra: [] } satisfies Installed));
  const installed: string[] = [];
  const install = (folder: string) => {
    installed.push(JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).version);
    if (installed.length > 1) throw new Error('synthetic reinstall failed');
  };
  let restarts = 0;
  let thrown: Error | undefined;
  try {
    await upgrade({ app, from: source, home, install, backup: async () => { throw new Error('synthetic backup failed'); }, restart: () => { restarts++; } });
  } catch (e) {
    thrown = e as Error;
  }
  assert.ok(thrown, 'the upgrade failed');
  assert.match(thrown.message, /^synthetic backup failed; and reinstalling the dependencies of 1\.0\.0 .*synthetic reinstall failed/);
  assert.deepEqual(installed, ['2.0.0', '1.0.0']);
  assert.equal(restarts, 0);
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '1.0.0');
});
