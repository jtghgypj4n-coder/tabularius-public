import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseFiles, renderAll, renderHomebrew, renderScoop, renderWinget, type Release } from '../../../scripts/packaging.ts';

const sha = (c: string) => c.repeat(64);
const release: Release = {
  version: '1.2.3', repo: 'owner/tabularius',
  files: [
    { os: 'macos', cpu: 'arm64', name: 'tabularius-1.2.3-macos-arm64', sha256: sha('a') },
    { os: 'linux', cpu: 'x64', name: 'tabularius-1.2.3-linux-x64', sha256: sha('b') },
    { os: 'linux', cpu: 'arm64', name: 'tabularius-1.2.3-linux-arm64', sha256: sha('c') },
    { os: 'windows', cpu: 'x64', name: 'tabularius-1.2.3-windows-x64.exe', sha256: sha('d') },
  ],
};

test('the Homebrew formula names each system\'s program and checksum, and only the systems built', () => {
  const rb = renderHomebrew(release);
  assert.match(rb, /^class Tabularius < Formula$/m);
  assert.match(rb, /url "https:\/\/github\.com\/owner\/tabularius\/releases\/download\/v1\.2\.3\/tabularius-1\.2\.3-macos-arm64"\n\s+sha256 "a{64}"/);
  assert.match(rb, /on_linux do[\s\S]*Hardware::CPU\.arm\?[\s\S]*c{64}[\s\S]*Hardware::CPU\.intel\?[\s\S]*b{64}/);
  assert.doesNotMatch(rb, /Hardware::CPU\.intel\?[^]*?d{64}/);
  // No Intel Mac program: that branch is left out.
  assert.equal([...rb.matchAll(/tabularius-1\.2\.3-macos/g)].length, 1);
  const ruby = spawnSync('ruby', ['-c'], { input: rb, encoding: 'utf8' });
  if (!ruby.error) assert.equal(ruby.status, 0, ruby.stderr);
});

test('the winget manifests agree with each other and carry the Windows checksum in capitals', () => {
  const files = renderWinget(release);
  assert.deepEqual(Object.keys(files).sort(), ['tabularius.tabularius.installer.yaml', 'tabularius.tabularius.locale.en-US.yaml', 'tabularius.tabularius.yaml']);
  for (const text of Object.values(files)) {
    assert.match(text, /^PackageIdentifier: tabularius\.tabularius$/m);
    assert.match(text, /^PackageVersion: 1\.2\.3$/m);
    assert.match(text, /^ManifestVersion: 1\.6\.0$/m);
    assert.doesNotMatch(text, /\t/);
  }
  const installer = files['tabularius.tabularius.installer.yaml'];
  assert.match(installer, /InstallerUrl: https:\/\/github\.com\/owner\/tabularius\/releases\/download\/v1\.2\.3\/tabularius-1\.2\.3-windows-x64\.exe/);
  assert.match(installer, /InstallerSha256: D{64}$/m);
  assert.match(installer, /^InstallerType: portable$/m);
});

test('the Scoop manifest is JSON with the version, url and hash', () => {
  const m = JSON.parse(renderScoop(release));
  assert.equal(m.version, '1.2.3');
  assert.equal(m.architecture['64bit'].hash, sha('d'));
  assert.equal(m.architecture['64bit'].url, 'https://github.com/owner/tabularius/releases/download/v1.2.3/tabularius-1.2.3-windows-x64.exe#/tabularius.exe');
  assert.equal(m.bin, 'tabularius.exe');
});

test('a bad version, repo or checksum is refused, and a release with no Windows program has no winget or Scoop files', () => {
  assert.throws(() => renderHomebrew({ ...release, version: '1.2' }), /release version/);
  assert.throws(() => renderHomebrew({ ...release, repo: 'nope' }), /owner\/name/);
  assert.throws(() => renderHomebrew({ ...release, files: [{ ...release.files[0], sha256: 'xyz' }] }), /SHA-256/);
  assert.throws(() => renderAll({ ...release, files: release.files.slice(0, 3) }), /no Windows program/);
});

test('the checksums come from the files in a build folder, and only for the named version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-packaging-'));
  try {
    writeFileSync(join(dir, 'tabularius-1.2.3-linux-x64'), 'abc');
    writeFileSync(join(dir, 'tabularius-1.2.3-windows-x64.exe'), 'def');
    writeFileSync(join(dir, 'tabularius-1.2.2-linux-x64'), 'old');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    const files = releaseFiles(dir, '1.2.3');
    assert.deepEqual(files.map((f) => [f.os, f.cpu]), [['linux', 'x64'], ['windows', 'x64']]);
    assert.equal(files[0].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
