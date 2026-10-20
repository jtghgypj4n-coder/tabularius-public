// Checksums for a finished release: `write` records the SHA-256 of the program (after signing), its software bill
// of materials and the licence notices in <program>.sha256, in the format `sha256sum -c` reads; `verify` checks a
// downloaded or stored release against that file and fails when any listed file is changed, missing or replaced.
//
//   node scripts/verify-release.ts write  dist/tabularius-<version>-<os>-<cpu>[.exe]
//   node scripts/verify-release.ts verify dist/tabularius-<version>-<os>-<cpu>.sha256
//
// This is a check that the files are the ones the build wrote; the operating system's own signature on the program
// (scripts/sign-release.ts) says who made them. A person who can replace the program can replace this file too,
// so publish it where the program is not (the release page, not the download mirror).

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

const PROGRAM = /^tabularius-[A-Za-z0-9._+-]+-(?:macos|linux|windows)-[a-z0-9]+(?:\.exe)?$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** The files a release is made of, beside the program: its bill of materials and the licence notices. */
export function releaseFiles(program: string): string[] {
  const dir = dirname(program);
  const base = basename(program).replace(/\.exe$/, '');
  return [program, join(dir, `${base}.sbom.cdx.json`), join(dir, 'THIRD-PARTY-NOTICES.md')];
}

/** A regular file, not a link to somewhere else: a link could be pointed at other bytes between the check and the use. */
const regular = (file: string) => existsSync(file) && lstatSync(file).isFile();

/** The manifest next to a program: `<hash>  <file name>` per line, sorted by name. */
export function writeManifest(program: string): string {
  if (!PROGRAM.test(basename(program))) throw new Error(`cannot write checksums: ${basename(program)} is not a release program (tabularius-<version>-<os>-<cpu>)`);
  const files = releaseFiles(resolve(program));
  const missing = files.filter((f) => !regular(f));
  if (missing.length) throw new Error(`cannot write checksums: ${missing.map((f) => basename(f)).join(', ')} not found`);
  const lines = files.map((f) => `${sha256(f)}  ${basename(f)}`).sort((a, b) => {
    const x = a.slice(66), y = b.slice(66);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const out = join(dirname(files[0]), `${basename(files[0]).replace(/\.exe$/, '')}.sha256`);
  writeFileSync(out, lines.join('\n') + '\n');
  return out;
}

/**
 * What is wrong with a release against its manifest: an empty list means every listed file is as it was written.
 * The manifest must list exactly the program, its bill of materials and the notices, so a manifest cut down to the
 * program alone does not pass; names are plain file names; each file must be a regular file, not a link.
 */
export function verifyManifest(manifest: string): string[] {
  const dir = dirname(resolve(manifest));
  const problems: string[] = [];
  const lines = readFileSync(manifest, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return ['the checksum file is empty'];
  const listed: string[] = [];
  for (const line of lines) {
    // `sha256sum` writes "<hash>  <name>" (text mode) or "<hash> *<name>" (binary mode).
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m || !NAME.test(m[2])) { problems.push(`not a checksum line: ${line.slice(0, 80)}`); continue; }
    listed.push(m[2]);
    const file = join(dir, m[2]);
    if (!existsSync(file)) problems.push(`${m[2]} is missing`);
    else if (!regular(file)) problems.push(`${m[2]} is not a regular file`);
    else if (sha256(file) !== m[1]) problems.push(`${m[2]} does not match its checksum`);
  }
  const programs = listed.filter((n) => PROGRAM.test(n));
  if (programs.length !== 1) problems.push(programs.length ? 'the checksum file lists more than one program' : 'the checksum file lists no program');
  else {
    const want = releaseFiles(join(dir, programs[0])).map((f) => basename(f));
    for (const name of want) if (!listed.includes(name)) problems.push(`the checksum file does not list ${name}`);
    for (const name of listed) if (!want.includes(name)) problems.push(`the checksum file lists ${name}, which is not part of the release`);
  }
  return problems;
}

if (import.meta.main) {
  const [command, target] = process.argv.slice(2);
  try {
    if (command === 'write' && target) {
      console.log(`wrote ${writeManifest(target)}`);
    } else if (command === 'verify' && target) {
      const problems = verifyManifest(target);
      if (problems.length) {
        for (const p of problems) console.error(`FAILED: ${p}`);
        process.exitCode = 1;
      } else console.log(`${basename(target)}: every listed file matches`);
    } else {
      console.error('usage: node scripts/verify-release.ts write <program> | verify <program>.sha256');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
