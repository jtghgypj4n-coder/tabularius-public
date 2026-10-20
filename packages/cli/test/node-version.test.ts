import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minimumNode, nodeSupports } from '../src/node-version.cjs';
import { nodeCheck } from '../src/doctor.ts';

const repo = join(import.meta.dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(repo, file), 'utf8');
const normalized = (version: string) => version.split('.').concat('0', '0').slice(0, 3).map(Number).join('.');

test('the minimum Node version agrees in the package, launcher, doctor, installers and nvm', () => {
  const engine = JSON.parse(read('package.json')).engines.node as string;
  assert.match(engine, /^>=\d+\.\d+(?:\.\d+)?$/, 'package.json engines.node must be a single inclusive minimum');
  const expected = normalized(engine.slice(2));
  const copies: Record<string, string> = {
    'package.json': expected,
    '.nvmrc': normalized(read('.nvmrc').trim()),
  };
  for (const file of ['packages/cli/src/launch.cjs', 'packages/cli/src/doctor.ts']) {
    const source = read(file);
    assert.match(source, /(?:require\('\.\/node-version\.cjs'\)|from '\.\/node-version\.cjs')/, file);
    assert.match(source, /nodeSupports\((?:process\.versions\.node|version)\)/, file);
    assert.ok(source.includes('${minimumNode}'), `${file} must report the package's minimum`);
    copies[file] = normalized(minimumNode);
  }
  const shell = read('scripts/install.sh').match(/a>(\d+)\|\|\(a===\1&&b>=(\d+)\)/);
  assert.ok(shell, 'scripts/install.sh: cannot find the minimum Node check');
  copies['scripts/install.sh'] = normalized(`${shell[1]}.${shell[2]}`);
  const powershell = read('scripts/install.ps1').match(/\$v -ge \[version\]'([\d.]+)'/);
  assert.ok(powershell, 'scripts/install.ps1: cannot find the minimum Node check');
  copies['scripts/install.ps1'] = normalized(powershell[1]);
  const mismatches = Object.entries(copies).filter(([, version]) => version !== expected);
  assert.deepEqual(mismatches, [], `Node minimum must match package.json (${expected}):\n${Object.entries(copies).map(([file, version]) => `${file}: ${version}`).join('\n')}`);
});

// CI still pins node-version: 22; the workflow is changed by hand (node-version-file: .nvmrc), so this reports without failing until then.
test('CI uses the same minimum Node version', { todo: 'set node-version-file: .nvmrc in .github/workflows/ci.yml' }, () => {
  const expected = normalized((JSON.parse(read('package.json')).engines.node as string).slice(2));
  const ci = read('.github/workflows/ci.yml');
  const versionFile = ci.match(/^\s+node-version-file:\s*['"]?([^\s'"]+)/m);
  const versions = [...ci.matchAll(/^\s+node-version:\s*['"]?([\d.]+)/gm)];
  assert.ok(versionFile || versions.length, '.github/workflows/ci.yml: cannot find the Node version');
  const found = versionFile ? [normalized(read(versionFile[1]).trim())] : versions.map((v) => normalized(v[1]));
  for (const version of found) assert.equal(version, expected, `.github/workflows/ci.yml: ${version}, package.json: ${expected}`);
});

test('runtime checks compare major, minor and patch versions and reject unsupported requirements', () => {
  for (const version of ['22.18.1', '22.19.0', '23.0.0', '24.0.0']) {
    assert.equal(nodeSupports(version, '>=22.18.1'), true, version);
  }
  for (const version of ['20.99.99', '22.17.99', '22.18.0']) {
    assert.equal(nodeSupports(version, '>=22.18.1'), false, version);
  }
  assert.throws(() => nodeSupports(process.versions.node, '^22.18.0'), /unsupported engines.node/);
  const [major, minor, patch] = normalized(minimumNode).split('.').map(Number);
  const older = patch ? `${major}.${minor}.${patch - 1}` : minor ? `${major}.${minor - 1}.999` : `${major - 1}.999.999`;
  assert.equal(nodeCheck(older).level, 'problem');
  assert.equal(nodeCheck(normalized(minimumNode)).level, 'ok');
  assert.match(nodeCheck(older).fix!, new RegExp(minimumNode.replaceAll('.', '\\.')));
});

test('runtime checks validate the whole version and reject every prerelease', () => {
  for (const version of ['22.18', '22.18.0', '22.19.0', '23.0.0']) {
    assert.equal(nodeSupports(version, '>=22.18'), true, version);
  }
  for (const version of ['22.18.0-rc.1', '22.19.0-rc.1', '23.0.0-nightly.20261015', '22.18.0-extra', '22.18.0.1', '22.18.0junk', 'v22.18.0']) {
    assert.equal(nodeSupports(version, '>=22.18'), false, version);
  }
  assert.equal(nodeSupports('22.18', '>=22.18.1'), false);
});

test('runtime checks give clear errors for missing, non-string and unsupported engines.node', () => {
  assert.throws(() => nodeSupports('22.18.0', undefined), /missing engines\.node/);
  for (const range of [null, 22, { minimum: '22.18.0' }]) {
    assert.throws(() => nodeSupports('22.18.0', range as unknown as string), /invalid engines\.node.*expected a string/);
  }
  for (const range of ['^22.18.0', '>=22.18.0-rc.1', '22.18.0']) {
    assert.throws(() => nodeSupports('22.18.0', range), /unsupported engines\.node/);
  }
});

test('the launcher helper reports bad package engines.node at startup', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-node-helper-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const helper = join(dir, 'packages', 'cli', 'src', 'node-version.cjs');
  mkdirSync(join(dir, 'packages', 'cli', 'src'), { recursive: true });
  writeFileSync(helper, read('packages/cli/src/node-version.cjs'));
  for (const [pkg, message] of [
    [{}, /missing engines\.node/],
    [{ engines: { node: 22 } }, /invalid engines\.node.*expected a string/],
    [{ engines: { node: '^22.18.0' } }, /unsupported engines\.node/],
  ] as const) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    const result = spawnSync(process.execPath, ['-e', 'require(process.argv[1])', helper], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /Cannot read properties of undefined|\.replace is not a function/);
  }
});
