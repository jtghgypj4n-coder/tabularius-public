import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleRelease } from '../../../scripts/release-assemble.ts';
import { writeManifest } from '../../../scripts/verify-release.ts';

// What the release workflow hands scripts/release-assemble.ts: one artifact folder per system, each holding the
// program, its bill of materials, the notices and the checksum file the build wrote.
function artifact(root: string, version: string, system: string, notices = 'licences', ext = ''): string {
  const folder = join(root, `tabularius-${system}`);
  mkdirSync(folder, { recursive: true });
  const program = join(folder, `tabularius-${version}-${system}${ext}`);
  writeFileSync(program, `program for ${system}`);
  writeFileSync(join(folder, `tabularius-${version}-${system}.sbom.cdx.json`), `{"system":"${system}"}`);
  writeFileSync(join(folder, 'THIRD-PARTY-NOTICES.md'), notices);
  writeManifest(program);
  return program;
}

function setup(): { dir: string; artifacts: string; out: string; installScript: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-assemble-'));
  const installScript = join(dir, 'get.sh');
  writeFileSync(installScript, '#!/bin/sh\n');
  return { dir, artifacts: join(dir, 'artifacts'), out: join(dir, 'out'), installScript };
}

describe('release-assemble', () => {
  test('puts every system into one folder with a SHA256SUMS that sha256sum accepts', () => {
    const { dir, artifacts, out, installScript } = setup();
    try {
      artifact(artifacts, '0.1.0', 'linux-x64');
      artifact(artifacts, '0.1.0', 'macos-arm64');
      artifact(artifacts, '0.1.0', 'windows-x64', 'licences', '.exe');
      const result = assembleRelease(artifacts, out, '0.1.0', ['linux-x64', 'macos-arm64'], installScript);
      assert.deepEqual(result.systems, ['linux-x64', 'macos-arm64', 'windows-x64']);
      assert.deepEqual(readdirSync(out).sort(), [
        'SHA256SUMS', 'THIRD-PARTY-NOTICES.md', 'get.sh',
        'tabularius-0.1.0-linux-x64', 'tabularius-0.1.0-linux-x64.sbom.cdx.json',
        'tabularius-0.1.0-macos-arm64', 'tabularius-0.1.0-macos-arm64.sbom.cdx.json',
        'tabularius-0.1.0-windows-x64.exe', 'tabularius-0.1.0-windows-x64.sbom.cdx.json',
      ]);
      const check = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: out, encoding: 'utf8' });
      assert.equal(check.status, 0, check.stdout + check.stderr);
      const listed = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trimEnd().split('\n').map((l) => l.slice(66));
      assert.ok(!listed.includes('SHA256SUMS'));
      assert.ok(listed.includes('tabularius-0.1.0-linux-x64'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('leaves out a system that is not required and was not built', () => {
    const { dir, artifacts, out } = setup();
    try {
      artifact(artifacts, '0.1.0', 'linux-x64');
      const result = assembleRelease(artifacts, out, '0.1.0', ['linux-x64']);
      assert.deepEqual(result.systems, ['linux-x64']);
      assert.ok(!existsSync(join(out, 'get.sh')), 'no install script was given');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('stops, naming the system, when a required one is missing', () => {
    const { dir, artifacts, out } = setup();
    try {
      artifact(artifacts, '0.1.0', 'linux-x64');
      assert.throws(() => assembleRelease(artifacts, out, '0.1.0', ['linux-x64', 'macos-x64']), /no program was built for macos-x64/);
      assert.ok(!existsSync(out), 'nothing is written until the programs are known');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('stops when a program was built for another version, or the version is not one', () => {
    const { dir, artifacts, out } = setup();
    try {
      artifact(artifacts, '0.0.9', 'linux-x64');
      assert.throws(() => assembleRelease(artifacts, out, '0.1.0', ['linux-x64']), /built for another version than 0\.1\.0: tabularius-0\.0\.9-linux-x64/);
      assert.throws(() => assembleRelease(artifacts, out, 'latest'), /isn't a release version/);
      assert.throws(() => assembleRelease(artifacts, out, '0.1'), /isn't a release version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('stops when a program changed after the build wrote its checksums', () => {
    const { dir, artifacts, out } = setup();
    try {
      const program = artifact(artifacts, '0.1.0', 'linux-x64');
      writeFileSync(program, 'swapped on the way');
      assert.throws(() => assembleRelease(artifacts, out, '0.1.0', ['linux-x64']), /is not as the build wrote it: .*does not match its checksum/);
      assert.ok(!existsSync(join(out, 'SHA256SUMS')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('stops when a program has no checksum file', () => {
    const { dir, artifacts, out } = setup();
    try {
      const program = artifact(artifacts, '0.1.0', 'linux-x64');
      rmSync(program.replace(/$/, '.sha256'));
      assert.throws(() => assembleRelease(artifacts, out, '0.1.0', ['linux-x64']), /has no tabularius-0\.1\.0-linux-x64\.sha256 beside it/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps each system\'s own notices when they differ', () => {
    const { dir, artifacts, out } = setup();
    try {
      artifact(artifacts, '0.1.0', 'linux-x64', 'linux licences');
      artifact(artifacts, '0.1.0', 'macos-arm64', 'mac licences');
      assembleRelease(artifacts, out, '0.1.0', ['linux-x64', 'macos-arm64']);
      assert.equal(existsSync(join(out, 'THIRD-PARTY-NOTICES.md')), false);
      assert.equal(readFileSync(join(out, 'THIRD-PARTY-NOTICES-linux-x64.md'), 'utf8'), 'linux licences');
      assert.equal(readFileSync(join(out, 'THIRD-PARTY-NOTICES-macos-arm64.md'), 'utf8'), 'mac licences');
      const check = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: out, encoding: 'utf8' });
      assert.equal(check.status, 0, check.stdout + check.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts a pre-release version', () => {
    const { dir, artifacts, out } = setup();
    try {
      artifact(artifacts, '0.1.0-rc.1', 'linux-x64');
      assert.deepEqual(assembleRelease(artifacts, out, '0.1.0-rc.1', ['linux-x64']).systems, ['linux-x64']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
