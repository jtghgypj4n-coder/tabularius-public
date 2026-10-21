// Puts the files of a release together: the programs the release workflow built (one artifact folder per system),
// each re-checked against its own checksum file, copied into one folder beside the install script, with a single
// SHA256SUMS over everything. That folder is what gets attached to the GitHub release (.github/workflows/release.yml),
// and SHA256SUMS is what scripts/get.sh checks a download against.
//
//   node scripts/release-assemble.ts <artifacts folder> <out folder> --version 0.1.0 [--require linux-x64,macos-arm64]
//
// --require names the systems (<os>-<cpu>) that must be there: the release stops when one is missing, so a failed
// build is never published as a smaller release. A system not required (Windows, until it builds cleanly) is
// included when its program is there and left out when it is not; the summary says which.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { verifyManifest } from './verify-release.ts';

const PROGRAM = /^tabularius-([A-Za-z0-9._+-]+)-(macos|linux|windows)-(arm64|x64)(\.exe)?$/;
const NOTICES = 'THIRD-PARTY-NOTICES.md';

export interface Assembled {
  /** Systems (<os>-<cpu>) whose program is in the release. */
  systems: string[];
  /** Every file written to the out folder, SHA256SUMS last. */
  files: string[];
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Every regular file under a folder (a link is not followed: it could point anywhere on the runner). */
function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    const s = lstatSync(p);
    return s.isSymbolicLink() ? [] : s.isDirectory() ? walk(p) : [p];
  });
}

export function assembleRelease(artifacts: string, out: string, version: string, require: readonly string[] = [], installScript?: string): Assembled {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`"${version}" isn't a release version like 1.2.3 or 1.2.3-rc.1`);
  const all = walk(artifacts);
  const programs = all.filter((f) => PROGRAM.exec(basename(f))?.[1] === version);
  const stray = all.filter((f) => PROGRAM.test(basename(f)) && !programs.includes(f));
  if (stray.length) throw new Error(`built for another version than ${version}: ${stray.map((f) => basename(f)).join(', ')}`);

  const systems = programs.map((f) => { const m = PROGRAM.exec(basename(f))!; return `${m[2]}-${m[3]}`; });
  if (new Set(systems).size !== systems.length) throw new Error(`more than one program for a system: ${programs.map((f) => basename(f)).join(', ')}`);
  const missing = require.filter((s) => !systems.includes(s));
  if (missing.length) throw new Error(`no program was built for ${missing.join(', ')}; not making a release without it (built: ${systems.join(', ') || 'none'})`);
  if (!programs.length) throw new Error(`no program for version ${version} in ${artifacts}`);

  mkdirSync(out, { recursive: true });
  const files: string[] = [];
  const notices = new Map<string, string>(); // system -> its copy of the licence notices
  for (const program of programs) {
    const name = basename(program);
    const [, , os, cpu] = PROGRAM.exec(name)!;
    const stem = name.replace(/\.exe$/, '');
    const manifest = join(program, '..', `${stem}.sha256`);
    // The artifact went through an upload and a download since the build checked it.
    if (!existsSync(manifest)) throw new Error(`${name} has no ${stem}.sha256 beside it`);
    const problems = verifyManifest(manifest);
    if (problems.length) throw new Error(`${name} is not as the build wrote it: ${problems.join('; ')}`);
    for (const file of [program, join(program, '..', `${stem}.sbom.cdx.json`)]) {
      copyFileSync(file, join(out, basename(file)));
      files.push(basename(file));
    }
    notices.set(`${os}-${cpu}`, join(program, '..', NOTICES));
  }
  // One copy of the notices when every system's is the same; otherwise each system's own, named for it.
  const hashes = new Set([...notices.values()].map(sha256));
  if (hashes.size === 1) {
    copyFileSync([...notices.values()][0], join(out, NOTICES));
    files.push(NOTICES);
  } else {
    for (const [system, file] of notices) {
      const target = `THIRD-PARTY-NOTICES-${system}.md`;
      copyFileSync(file, join(out, target));
      files.push(target);
    }
  }
  if (installScript) {
    copyFileSync(installScript, join(out, 'get.sh'));
    files.push('get.sh');
  }
  const sums = files.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((f) => `${sha256(join(out, f))}  ${f}`);
  writeFileSync(join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
  files.push('SHA256SUMS');
  return { systems: systems.sort(), files };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const flag = (name: string) => {
      const i = args.indexOf(name);
      if (i < 0) return undefined;
      const v = args[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
      args.splice(i, 2);
      return v;
    };
    const version = flag('--version');
    const require = (flag('--require') ?? '').split(',').filter(Boolean);
    const [artifacts, out, ...rest] = args;
    if (!version || !artifacts || !out || rest.length) throw new Error('usage: node scripts/release-assemble.ts <artifacts folder> <out folder> --version 0.1.0 [--require linux-x64,macos-arm64]');
    const result = assembleRelease(resolve(artifacts), resolve(out), version, require, join(import.meta.dirname, 'get.sh'));
    console.log(`release ${version}: ${result.systems.join(', ')}`);
    for (const f of result.files) console.log(`  ${f}`);
  } catch (e) {
    console.error(`release-assemble: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
