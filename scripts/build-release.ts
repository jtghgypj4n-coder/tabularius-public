// Builds Tabularius as one program file for this system: a Node single
// executable application with the program's files inside it, so it runs on a
// machine with no Node and no checkout. Run it on each system to build for
// (.github/workflows/release.yml does, on macOS, Linux and Windows).
//
//   node scripts/build-release.ts [--out dist] [--version 1.2.3] [--pack-only]
//
// Writes dist/tabularius-<version>-<os>-<cpu>(.exe), beside THIRD-PARTY-NOTICES.md and the software bill of
// materials tabularius-<version>-<os>-<cpu>.sbom.cdx.json. The first run of each version unpacks its files into
// ~/.openhbam/runtime (scripts/release/launcher.cjs). --pack-only stops after packing the program's files and
// writes tabularius-<version>-<os>-<cpu>.pack instead of the program: the part of the build that is ours, without
// the 100 MB copy of Node (scripts/verify-repro.ts builds that way unless given --full).
//
// The build is reproducible: the same commit, version and Node give the same bytes whatever the folder, the
// time, the language settings or the umask. Nothing written here may hold a date, a path or a random name.

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isDependencyDebris, isProgramFile } from './release-audit.ts';
import { writeSbom } from './sbom.ts';
import { writeNotices } from './third-party-notices.ts';

const repo = resolve(import.meta.dirname, '..');

interface ReleaseArgs { out?: string; version?: string; packOnly?: boolean }

export function parseReleaseArgs(argv: readonly string[]): ReleaseArgs {
  const options: ReleaseArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--pack-only') { options.packOnly = true; continue; }
    if (flag !== '--out' && flag !== '--version') throw new Error(`Unknown flag: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--version' && /[^A-Za-z0-9._+-]/.test(value)) {
      throw new Error('Invalid --version: use only letters, digits, dot, dash, underscore, or plus');
    }
    if (flag === '--out') options.out = value;
    else options.version = value;
  }
  return options;
}

export function defaultReleaseVersion(version: string, sha: string, status: string): string {
  return `${version}-${sha}${status.trim() ? '-dirty' : ''}`;
}

const say = (m: string) => console.log(`==> ${m}`);
const run = (cmd: string, args: string[], cwd?: string) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && /\.(cmd|bat)$|^npx?$/.test(cmd) });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};

/** The files the program needs: what git tracks under packages/ (not the tests, browser tests, evaluations and benchmarks), the reference pages and the package files; see isProgramFile. A tracked link is left out: the program imports by relative path, and a link out of the checkout has nothing to copy. */
function programFiles(): string[] {
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter((f) => !lstatSync(join(repo, f)).isSymbolicLink());
  return tracked.filter(isProgramFile);
}

/** Every regular file under a folder, as paths relative to it (links are left out: the program imports by relative path). */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const s = lstatSync(p);
    if (s.isSymbolicLink()) return [];
    // npm's own bookkeeping (node_modules/.package-lock.json, .cache) changes with the npm version and nothing runs it.
    if (n.startsWith('.') && relative(base, p).split(sep)[0] === 'node_modules' && relative(base, p).split(sep).length === 2) return [];
    return s.isDirectory() ? walk(p, base) : [relative(base, p).split(sep).join('/')];
  });
}

/**
 * One gzipped file: a header of paths, sizes and modes, then the files' bytes one after another. The order is by
 * path and a mode is only runnable or not (the launcher looks at nothing else), so the umask of whoever builds
 * does not change a byte; gzip's own header carries no time.
 */
export function pack(dir: string): Buffer {
  const files = walk(dir).sort();
  const header = files.map((path) => {
    const s = lstatSync(join(dir, path));
    return { path, size: s.size, mode: s.mode & 0o111 ? 0o755 : 0o644 };
  });
  const head = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(head.length);
  return gzipSync(Buffer.concat([length, head, ...files.map((f) => readFileSync(join(dir, f)))]), { level: 9 });
}

/** The files inside a pack, in order: the reverse of pack(). */
export function unpack(packed: Buffer): { path: string; size: number; mode: number; data: Buffer }[] {
  const all = gunzipSync(packed);
  const headerLength = all.readUInt32LE(0);
  const header = JSON.parse(all.subarray(4, 4 + headerLength).toString('utf8')) as { path: string; size: number; mode: number }[];
  let at = 4 + headerLength;
  return header.map((f) => ({ ...f, data: all.subarray(at, (at += f.size)) }));
}

function buildRelease(options: ReleaseArgs): void {
  const out = resolve(options.out ?? join(repo, 'dist'));
  const pkg = JSON.parse(readFileSync(join(repo, 'packages', 'server', 'package.json'), 'utf8')) as { version: string };
  const version = options.version ?? defaultReleaseVersion(pkg.version,
    execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }));
  const os = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform as string] ?? process.platform;
  const base = join(out, `tabularius-${version}-${os}-${process.arch}`);
  const exe = base + (process.platform === 'win32' ? '.exe' : '');
  const work = mkdtempSync(join(tmpdir(), 'tabularius-release-'));
  try {
    const stage = join(work, 'app');
    say(`Staging the program's files (${version})`);
    for (const f of programFiles()) cpSync(join(repo, f), join(stage, f));
    // `tabularius --version` and the About boxes name the commit; a release has no .git to read it from.
    writeFileSync(join(stage, 'packages', 'server', 'build-info.json'), JSON.stringify({ commit: execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() }) + '\n');
    say('Installing its dependencies');
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
    // The workspace links point back at packages/, which is there already.
    rmSync(join(stage, 'node_modules', '@tabularius'), { recursive: true, force: true });
    // Source maps of the dependencies and their lint, coverage and git settings: nothing runs them (see isDependencyDebris).
    let pruned = 0;
    for (const f of walk(stage).filter(isDependencyDebris)) { rmSync(join(stage, f)); pruned++; }
    say(`Left out ${pruned} files of the dependencies that nothing runs`);
    // The dependencies' licences ask for their notice to travel with copies, so the licence
    // texts ride inside the program (unpacked beside it on first run) and beside it in dist/.
    const notices = join(stage, 'THIRD-PARTY-NOTICES.md');
    say(`Collecting licence texts (${writeNotices(stage, notices)} packages)`);
    const packed = pack(stage);
    say(`Packed ${(packed.length / 1048576).toFixed(1)} MB`);
    mkdirSync(out, { recursive: true });
    say(`Writing the software bill of materials (${writeSbom(stage, `${base}.sbom.cdx.json`, version)} components)`);
    if (options.packOnly) {
      writeFileSync(`${base}.pack`, packed);
      copyFileSync(notices, join(out, 'THIRD-PARTY-NOTICES.md'));
      console.log(`${base}.pack`);
      return;
    }
    writeFileSync(join(work, 'app.pack'), packed);
    writeFileSync(join(work, 'version'), version);
    copyFileSync(join(repo, 'scripts', 'release', 'launcher.cjs'), join(work, 'launcher.cjs'));
    // Relative paths, run from the work folder: the blob records the main script's path, which would otherwise
    // be this run's random temporary folder and make every build differ.
    writeFileSync(join(work, 'sea.json'), JSON.stringify({
      main: 'launcher.cjs', output: 'sea.blob', disableExperimentalSEAWarning: true,
      assets: { 'app.pack': 'app.pack', version: 'version' },
    }));
    run(process.execPath, ['--experimental-sea-config', 'sea.json'], work);

    say(`Building ${exe}`);
    copyFileSync(notices, join(out, 'THIRD-PARTY-NOTICES.md'));
    copyFileSync(process.execPath, exe);
    chmodSync(exe, 0o755);
    if (process.platform === 'darwin') run('codesign', ['--remove-signature', exe]);
    // postject and its one dependency come from a committed lockfile, so npm checks each download against a hash
    // we reviewed instead of taking whatever the registry serves for a version number.
    const tools = join(work, 'tools');
    mkdirSync(tools);
    for (const f of ['package.json', 'package-lock.json']) copyFileSync(join(repo, 'scripts', 'release', 'postject', f), join(tools, f));
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], tools);
    run(process.execPath, [join(tools, 'node_modules', 'postject', 'dist', 'cli.js'), exe, 'NODE_SEA_BLOB', join(work, 'sea.blob'),
      '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])]);
    // macOS runs only signed programs on Apple silicon: an ad-hoc signature does.
    if (process.platform === 'darwin') run('codesign', ['--sign', '-', exe]);
    console.log(exe);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    buildRelease(parseReleaseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
