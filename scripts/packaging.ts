// Package manager files for a release: a Homebrew formula, winget manifests and a Scoop manifest, made from the
// version and the checksums of the programs scripts/build-release.ts wrote (dist/tabularius-<version>-<os>-<cpu>).
//
//   node scripts/packaging.ts --version 0.2.0 --repo owner/name --dist dist [--out packaging/generated]
//
// Publishing them (a pull request to a tap, winget-pkgs or a Scoop bucket) stays a manual step.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReleaseFile {
  os: 'macos' | 'linux' | 'windows';
  cpu: 'arm64' | 'x64';
  /** The file's name in the release. */
  name: string;
  /** Lower-case hex SHA-256. */
  sha256: string;
}

export interface Release {
  version: string;
  /** owner/name on GitHub, where the release's programs are published. */
  repo: string;
  files: ReleaseFile[];
}

const DESCRIPTION = 'Open-source server and web client for FileMaker .fmp12 files';
const LICENSE = 'MIT';
const PUBLISHER = 'Tabularius contributors';

/** The release's programs found in a folder (tabularius-<version>-<os>-<cpu>[.exe]), with their checksums. */
export function releaseFiles(dist: string, version: string): ReleaseFile[] {
  const files: ReleaseFile[] = [];
  for (const name of readdirSync(dist).sort()) {
    const m = /^tabularius-(.+)-(macos|linux|windows)-(arm64|x64)(\.exe)?$/.exec(name);
    if (!m || m[1] !== version) continue;
    files.push({ os: m[2] as ReleaseFile['os'], cpu: m[3] as ReleaseFile['cpu'], name, sha256: createHash('sha256').update(readFileSync(join(dist, name))).digest('hex') });
  }
  return files;
}

const url = (r: Release, f: ReleaseFile) => `https://github.com/${r.repo}/releases/download/v${r.version}/${f.name}`;
const find = (r: Release, os: ReleaseFile['os'], cpu: ReleaseFile['cpu']) => r.files.find((f) => f.os === os && f.cpu === cpu);

function check(r: Release): void {
  if (!/^\d+\.\d+\.\d+$/.test(r.version)) throw new Error(`"${r.version}" isn't a release version like 1.2.3`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(r.repo)) throw new Error(`"${r.repo}" isn't owner/name`);
  for (const f of r.files) if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`${f.name}: checksum isn't SHA-256`);
}

/** A Homebrew formula: one program per system it was built for. */
export function renderHomebrew(r: Release): string {
  check(r);
  const block = (os: 'macos' | 'linux', cpu: ReleaseFile['cpu'], cond: string) => {
    const f = find(r, os, cpu);
    return f ? [`    ${cond}`, `      url "${url(r, f)}"`, `      sha256 "${f.sha256}"`, '    end'] : [];
  };
  const mac = [...block('macos', 'arm64', 'if Hardware::CPU.arm?'), ...block('macos', 'x64', 'if Hardware::CPU.intel?')];
  const linux = [...block('linux', 'arm64', 'if Hardware::CPU.arm?'), ...block('linux', 'x64', 'if Hardware::CPU.intel?')];
  const section = (head: string, lines: string[]) => (lines.length ? ['', `  ${head}`, ...lines, '  end'] : []);
  return [
    'class Tabularius < Formula',
    `  desc "${DESCRIPTION}"`,
    `  homepage "https://github.com/${r.repo}"`,
    `  version "${r.version}"`,
    `  license "${LICENSE}"`,
    ...section('on_macos do', mac),
    ...section('on_linux do', linux),
    '',
    '  def install',
    '    bin.install Dir["tabularius-*"].first => "tabularius"',
    '  end',
    '',
    '  test do',
    '    system bin/"tabularius", "new", testpath/"Databases", "Empty"',
    '    assert_path_exists testpath/"Databases"',
    '  end',
    'end',
    '',
  ].join('\n');
}

/** winget's three manifest files (version, installer, default locale), as {file name: text}. */
export function renderWinget(r: Release): Record<string, string> {
  check(r);
  const f = find(r, 'windows', 'x64');
  if (!f) throw new Error('no Windows program in this release');
  const id = 'tabularius.tabularius';
  const schema = (kind: string) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${kind}.1.6.0.schema.json`;
  return {
    [`${id}.yaml`]: [schema('version'), `PackageIdentifier: ${id}`, `PackageVersion: ${r.version}`, 'DefaultLocale: en-US', 'ManifestType: version', 'ManifestVersion: 1.6.0', ''].join('\n'),
    [`${id}.installer.yaml`]: [
      schema('installer'), `PackageIdentifier: ${id}`, `PackageVersion: ${r.version}`, 'InstallerType: portable', 'Commands:', '  - Tabularius',
      'Installers:', '  - Architecture: x64', `    InstallerUrl: ${url(r, f)}`, `    InstallerSha256: ${f.sha256.toUpperCase()}`,
      'ManifestType: installer', 'ManifestVersion: 1.6.0', '',
    ].join('\n'),
    [`${id}.locale.en-US.yaml`]: [
      schema('defaultLocale'), `PackageIdentifier: ${id}`, `PackageVersion: ${r.version}`, 'PackageLocale: en-US', `Publisher: ${PUBLISHER}`,
      'PackageName: Tabularius', `License: ${LICENSE}`, `ShortDescription: ${DESCRIPTION}`, `PackageUrl: https://github.com/${r.repo}`,
      'ManifestType: defaultLocale', 'ManifestVersion: 1.6.0', '',
    ].join('\n'),
  };
}

/** A Scoop manifest. */
export function renderScoop(r: Release): string {
  check(r);
  const f = find(r, 'windows', 'x64');
  if (!f) throw new Error('no Windows program in this release');
  return JSON.stringify({
    version: r.version, description: DESCRIPTION, homepage: `https://github.com/${r.repo}`, license: LICENSE,
    architecture: { '64bit': { url: `${url(r, f)}#/tabularius.exe`, hash: f.sha256 } },
    bin: 'tabularius.exe',
    checkver: 'github',
    autoupdate: { architecture: { '64bit': { url: `https://github.com/${r.repo}/releases/download/v$version/tabularius-$version-windows-x64.exe#/tabularius.exe` } } },
  }, null, 2) + '\n';
}

/** Every file, as {path under the output folder: text}. */
export function renderAll(r: Release): Record<string, string> {
  const out: Record<string, string> = { 'homebrew/tabularius.rb': renderHomebrew(r), 'scoop/tabularius.json': renderScoop(r) };
  for (const [name, text] of Object.entries(renderWinget(r))) out[`winget/${name}`] = text;
  return out;
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
  const version = arg('--version');
  const repo = arg('--repo');
  if (!version || !repo) {
    console.error('usage: node scripts/packaging.ts --version 1.2.3 --repo owner/name [--dist dist] [--out packaging/generated]');
    process.exit(2);
  }
  const release: Release = { version, repo, files: releaseFiles(arg('--dist') ?? 'dist', version) };
  const out = arg('--out') ?? join('packaging', 'generated');
  for (const [path, text] of Object.entries(renderAll(release))) {
    mkdirSync(join(out, path, '..'), { recursive: true });
    writeFileSync(join(out, path), text);
    console.log(`${join(out, path)}`);
  }
}
