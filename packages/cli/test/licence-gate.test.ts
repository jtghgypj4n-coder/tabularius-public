// scripts/licence-gate.ts: the allow lists, the committed-data rules and the notices file that
// ships with a release. The last test runs the gate on this very checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEV_ALLOWED, RUNTIME_ALLOWED, checkDependencies, checkTrackedFiles, checkWorkspaces, collectNotices, licenceAllowed,
  lockDependencies, renderNotices,
} from '../../../scripts/licence-gate.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const temp = () => mkdtempSync(join(tmpdir(), 'tabularius-licence-'));

test('SPDX expressions: OR needs one allowed side, AND needs both, anything unknown fails', () => {
  assert.ok(licenceAllowed('MIT', RUNTIME_ALLOWED));
  assert.ok(licenceAllowed('(MIT OR GPL-3.0-only)', RUNTIME_ALLOWED));
  assert.ok(licenceAllowed('MIT AND ISC', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('MIT AND GPL-3.0-only', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('(MIT OR Apache-2.0) AND AGPL-3.0-only', RUNTIME_ALLOWED));
  assert.ok(licenceAllowed('(GPL-2.0-only OR MIT) AND (ISC OR AGPL-3.0-only)', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('AGPL-3.0-only', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('SEE LICENSE IN LICENSE.md', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('UNLICENSED', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('(MIT', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('MIT OR', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed('', RUNTIME_ALLOWED));
  assert.ok(!licenceAllowed(undefined, RUNTIME_ALLOWED));
});

test('MPL-2.0 is allowed for a dev tool and refused in the program', () => {
  assert.ok(licenceAllowed('MPL-2.0', DEV_ALLOWED));
  assert.ok(!licenceAllowed('MPL-2.0', RUNTIME_ALLOWED));
});

test('the lock file is read without the workspace packages, and bad licences are named', () => {
  const deps = lockDependencies({
    packages: {
      '': { license: 'MIT' },
      'packages/calc': { version: '0.1.0', license: 'MIT' },
      'node_modules/@tabularius/calc': { link: true },
      'node_modules/ok': { version: '1.0.0', license: 'MIT' },
      'node_modules/ok/node_modules/nested': { version: '2.0.0', license: 'ISC' },
      'node_modules/copyleft': { version: '1.2.3', license: 'AGPL-3.0-only' },
      'node_modules/nolicence': { version: '0.0.1' },
      'node_modules/tool': { version: '4.0.0', license: 'MPL-2.0', dev: true },
      'node_modules/devgpl': { version: '4.0.0', license: 'GPL-3.0-only', dev: true },
    },
  });
  assert.deepEqual(deps.map((d) => d.name), ['copyleft', 'devgpl', 'nolicence', 'ok', 'nested', 'tool']);
  const problems = checkDependencies(deps);
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /runtime package copyleft@1\.2\.3 is AGPL-3\.0-only/);
  assert.match(problems.join('\n'), /runtime package nolicence@0\.0\.1 is \(none declared\)/);
  assert.match(problems.join('\n'), /dev package devgpl@4\.0\.0 is GPL-3\.0-only/);
  assert.deepEqual(checkDependencies(deps, { 'node_modules/copyleft': 'reviewed', 'node_modules/nolicence': 'reviewed', 'node_modules/devgpl': 'reviewed' }), []);
});

test('sample files, keys, archives, fixtures and big binaries are not committed', () => {
  const sizes: Record<string, number> = { 'docs/big.bin': 3 * 1024 * 1024, 'docs/reference/rest.md': 800_000 };
  const problems = checkTrackedFiles([
    'packages/fmp12/src/reader.ts', 'docs/reference/rest.md', 'shots/a.png',
    'fixtures/fmp12/Charts.fmp12', 'samples/Client.fmp12', 'deploy/server.pem', '.env', 'packages/server/.env.local',
    'backup.zip', 'mbs-packs.bundle', 'docs/big.bin',
  ], (f) => sizes[f] ?? 1000);
  assert.deepEqual(problems.map((p) => p.split(' ')[0]), [
    'fixtures/fmp12/Charts.fmp12', 'samples/Client.fmp12', 'deploy/server.pem', '.env', 'packages/server/.env.local',
    'backup.zip', 'mbs-packs.bundle', 'docs/big.bin',
  ]);
});

test('workspace licences must match LICENSE, and LICENSE and NOTICE must exist', () => {
  const dir = temp();
  try {
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ license: 'MIT' }));
    writeFileSync(join(dir, 'packages', 'a', 'package.json'), JSON.stringify({ license: 'MIT' }));
    writeFileSync(join(dir, 'packages', 'b', 'package.json'), JSON.stringify({ license: 'GPL-3.0-only' }));
    const bare = checkWorkspaces(dir);
    assert.ok(bare.includes('LICENSE is missing'));
    assert.ok(bare.some((p) => p.startsWith('NOTICE is missing')));
    writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 someone\n');
    writeFileSync(join(dir, 'NOTICE'), 'credits');
    assert.deepEqual(checkWorkspaces(dir), ['packages/b/package.json declares GPL-3.0-only but LICENSE is MIT']);
    writeFileSync(join(dir, 'packages', 'b', 'package.json'), JSON.stringify({}));
    assert.deepEqual(checkWorkspaces(dir), ['packages/b/package.json declares no licence']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the notices file holds each package\'s licence text once, nested and scoped packages included, and skips workspace links', () => {
  const dir = temp();
  try {
    const pkg = (at: string, manifest: object, files: Record<string, string> = {}) => {
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
      for (const [f, text] of Object.entries(files)) writeFileSync(join(at, f), text);
    };
    const nm = join(dir, 'node_modules');
    pkg(join(nm, 'alpha'), { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'Copyright (c) Alpha authors\nMIT text' });
    pkg(join(nm, 'alpha', 'node_modules', 'beta'), { name: 'beta', version: '2.0.0', license: 'ISC' }, { 'LICENSE.md': 'ISC text for beta' });
    pkg(join(nm, '@scope', 'gamma'), { name: '@scope/gamma', version: '3.1.0', license: 'BSD-3-Clause' }, { 'LICENCE': 'BSD text', 'README.md': 'not a licence' });
    pkg(join(nm, 'delta'), { name: 'delta', version: '0.1.0' });
    pkg(join(nm, 'dup', 'node_modules', 'alpha'), { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'Copyright (c) Alpha authors\nMIT text' });
    pkg(join(nm, 'dup'), { name: 'dup', version: '1.0.0', license: 'MIT' }, { COPYING: 'dup text' });
    mkdirSync(join(dir, 'packages', 'mine'), { recursive: true });
    mkdirSync(join(nm, '@tabularius'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'mine', 'package.json'), JSON.stringify({ name: '@tabularius/mine', version: '0.1.0', license: 'MIT' }));
    symlinkSync(join(dir, 'packages', 'mine'), join(nm, '@tabularius', 'mine'), 'dir');
    mkdirSync(join(nm, '.bin'));

    const notices = collectNotices(dir);
    assert.deepEqual(notices.map((n) => `${n.name}@${n.version}`), ['@scope/gamma@3.1.0', 'alpha@1.0.0', 'beta@2.0.0', 'delta@0.1.0', 'dup@1.0.0']);
    const md = renderNotices(notices, 'Node licence text', 'v22.0.0');
    assert.match(md, /## Node\.js v22\.0\.0/);
    assert.match(md, /Node licence text/);
    assert.equal(md.match(/Copyright \(c\) Alpha authors/g)?.length, 1);
    assert.match(md, /## @scope\/gamma 3\.1\.0\n\nLicence: BSD-3-Clause\n\n```\nBSD text\n```/);
    assert.ok(!md.includes('not a licence'));
    assert.match(md, /## delta 0\.1\.0\n\nLicence: \(none declared\)\n\nThe package ships no licence file/);
    assert.ok(!md.includes('mine'));
    assert.match(renderNotices([], undefined), /could not find the Node\.js licence file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('this checkout passes the gate', () => {
  const r = spawnSync(process.execPath, ['--no-warnings', join(root, 'scripts', 'licence-gate.ts')], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /licence gate ok/);
});
