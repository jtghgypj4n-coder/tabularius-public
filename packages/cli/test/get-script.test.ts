import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleRelease } from '../../../scripts/release-assemble.ts';
import { writeManifest } from '../../../scripts/verify-release.ts';

// scripts/get.sh against a stand-in for a GitHub releases page: /latest redirects to the newest tag and
// /download/<tag>/<file> serves files. The "program" is a shell script, and `uname` is faked so the same names are
// asked for on every host.
const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'get.sh');
const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');

let work: string;
let server: Server;
let releases: string;
/** What the stand-in serves: the tag /latest points at ('' = no release yet) and files by "<tag>/<name>". */
let latest = '';
let files = new Map<string, string>();
const requests: string[] = [];

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'tabularius-get-'));
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    requests.push(path);
    if (path === '/releases/latest') {
      res.writeHead(302, { location: latest ? `/releases/tag/${latest}` : '/releases' });
      return res.end();
    }
    const download = /^\/releases\/download\/([^/]+)\/([^/]+)$/.exec(path);
    const body = download && files.get(`${download[1]}/${download[2]}`);
    if (path === '/releases' || path.startsWith('/releases/tag/')) { res.writeHead(200); return res.end('page'); }
    if (body === undefined || body === null) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200);
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  releases = `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases`;
  // A `uname` that answers from FAKE_UNAME_S / FAKE_UNAME_M, first on the PATH.
  mkdirSync(join(work, 'shim'));
  writeFileSync(join(work, 'shim', 'uname'), '#!/bin/sh\ncase "$1" in -s) echo "$FAKE_UNAME_S" ;; -m) echo "$FAKE_UNAME_M" ;; *) echo "$FAKE_UNAME_S" ;; esac\n');
  chmodSync(join(work, 'shim', 'uname'), 0o755);
  // A `sysctl` that says whether this is an Apple silicon Mac (a shell under Rosetta reports x86_64 from uname there).
  writeFileSync(join(work, 'shim', 'sysctl'), '#!/bin/sh\n[ "$2" = hw.optional.arm64 ] && echo "${FAKE_ARM64:-0}"\n');
  chmodSync(join(work, 'shim', 'sysctl'), 0o755);
});

after(() => {
  server.close();
  rmSync(work, { recursive: true, force: true });
});

function release(tag: string, version: string, program = `#!/bin/sh\necho "tabularius ${version}"\n`, system = 'linux-x64', sums?: string): string {
  const name = `tabularius-${version}-${system}`;
  files.set(`${tag}/${name}`, program);
  files.set(`${tag}/SHA256SUMS`, sums ?? `${sha256(program)}  ${name}\n${sha256('other')}  tabularius-${version}-macos-arm64\n`);
  return name;
}

interface Run { status: number | null; out: string; err: string; bin: string }

function run(args: string[] = [], env: Record<string, string> = {}): Promise<Run> {
  const home = mkdtempSync(join(work, 'home-'));
  const bin = join(home, 'bin');
  return new Promise((resolve) => {
    const child = spawn('sh', [script, ...args], {
      env: {
        HOME: home, PATH: `${join(work, 'shim')}:${process.env.PATH}`, FAKE_UNAME_S: 'Linux', FAKE_UNAME_M: 'x86_64',
        TABULARIUS_RELEASES: releases, TABULARIUS_BIN: bin, ...env,
      },
      timeout: 30_000,
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (status) => resolve({ status, out, err, bin }));
  });
}

describe('scripts/get.sh', () => {
  test('installs the latest release after checking its checksum', async () => {
    files = new Map();
    latest = 'v0.2.0';
    release('v0.2.0', '0.2.0');
    const r = await run();
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /Downloading Tabularius 0\.2\.0 for linux x64/);
    assert.match(r.out, /Checksum matches/);
    assert.match(r.out, /Try it|not on your PATH/);
    assert.equal(readFileSync(join(r.bin, 'tabularius'), 'utf8'), '#!/bin/sh\necho "tabularius 0.2.0"\n');
    assert.equal(spawnOk(join(r.bin, 'tabularius')), 'tabularius 0.2.0');
  });

  test('takes a version from --version or TABULARIUS_VERSION, with or without the v', async () => {
    files = new Map();
    latest = 'v0.2.0';
    release('v0.2.0', '0.2.0');
    release('v0.1.5-rc.1', '0.1.5-rc.1');
    requests.length = 0;
    const byFlag = await run(['--version', 'v0.1.5-rc.1']);
    assert.equal(byFlag.status, 0, byFlag.err);
    assert.match(byFlag.out, /Downloading Tabularius 0\.1\.5-rc\.1/);
    const byEnv = await run([], { TABULARIUS_VERSION: '0.1.5-rc.1' });
    assert.equal(byEnv.status, 0, byEnv.err);
    assert.ok(!requests.includes('/releases/latest'), 'a version given is not looked up');
  });

  test('installs the arm64 program on an Apple silicon Mac and the Intel one on an Intel Mac', async () => {
    files = new Map();
    release('v0.2.0', '0.2.0', undefined, 'macos-arm64');
    release('v0.2.0', '0.2.0', '#!/bin/sh\necho "tabularius 0.2.0 intel"\n', 'macos-x64', undefined);
    // The second call replaced SHA256SUMS; give the file both lines.
    const arm = '#!/bin/sh\necho "tabularius 0.2.0"\n', intel = '#!/bin/sh\necho "tabularius 0.2.0 intel"\n';
    files.set('v0.2.0/tabularius-0.2.0-macos-arm64', arm);
    files.set('v0.2.0/SHA256SUMS', `${sha256(arm)}  tabularius-0.2.0-macos-arm64\n${sha256(intel)} *tabularius-0.2.0-macos-x64\n`);
    const onArm = await run(['--version', '0.2.0'], { FAKE_UNAME_S: 'Darwin', FAKE_UNAME_M: 'arm64' });
    assert.equal(onArm.status, 0, onArm.err);
    assert.equal(spawnOk(join(onArm.bin, 'tabularius')), 'tabularius 0.2.0');
    const onIntel = await run(['--version', '0.2.0'], { FAKE_UNAME_S: 'Darwin', FAKE_UNAME_M: 'x86_64', FAKE_ARM64: '0' });
    assert.equal(onIntel.status, 0, onIntel.err);
    assert.equal(spawnOk(join(onIntel.bin, 'tabularius')), 'tabularius 0.2.0 intel');
    // A shell under Rosetta on an Apple silicon Mac says x86_64 too, and the arm64 program is the one to install.
    const rosetta = await run(['--version', '0.2.0'], { FAKE_UNAME_S: 'Darwin', FAKE_UNAME_M: 'x86_64', FAKE_ARM64: '1' });
    assert.equal(rosetta.status, 0, rosetta.err);
    assert.equal(spawnOk(join(rosetta.bin, 'tabularius')), 'tabularius 0.2.0');
  });

  test('installs nothing when the download does not match its checksum', async () => {
    files = new Map();
    const name = release('v0.2.0', '0.2.0');
    files.set(`v0.2.0/${name}`, '#!/bin/sh\necho "not what was built"\n');
    const r = await run(['--version', '0.2.0']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /does not match its checksum/);
    assert.equal(existsSync(join(r.bin, 'tabularius')), false);
  });

  test('keeps the old program when a new download does not match', async () => {
    files = new Map();
    const name = release('v0.2.0', '0.2.0');
    const first = await run(['--version', '0.2.0']);
    assert.equal(first.status, 0, first.err);
    files.set(`v0.2.0/${name}`, 'tampered');
    const home = join(first.bin, '..');
    const again = await run(['--version', '0.2.0'], { HOME: home, TABULARIUS_BIN: first.bin });
    assert.notEqual(again.status, 0);
    assert.equal(spawnOk(join(first.bin, 'tabularius')), 'tabularius 0.2.0');
  });

  test('stops when SHA256SUMS has no line for this system, and does not take a longer name for it', async () => {
    files = new Map();
    release('v0.2.0', '0.2.0', undefined, 'linux-x64', `${sha256('x')}  tabularius-0.2.0-linux-x64.sbom.cdx.json\n${sha256('x')}  tabularius-0.2.0-macos-arm64\n`);
    const r = await run(['--version', '0.2.0']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /no checksum for tabularius-0\.2\.0-linux-x64/);
    assert.equal(existsSync(join(r.bin, 'tabularius')), false);
  });

  test('says so when the release has no program for this system', async () => {
    files = new Map();
    release('v0.2.0', '0.2.0');
    const r = await run(['--version', '0.2.0'], { FAKE_UNAME_M: 'aarch64' });
    assert.notEqual(r.status, 0);
    assert.match(r.err, /could not download .*tabularius-0\.2\.0-linux-arm64/);
  });

  test('says so when no release has been published', async () => {
    files = new Map();
    latest = '';
    const r = await run();
    assert.notEqual(r.status, 0);
    assert.match(r.err, /no release of Tabularius has been published yet/);
  });

  test('refuses a system it has no program for, naming what to do', async () => {
    const bsd = await run(['--version', '0.2.0'], { FAKE_UNAME_S: 'FreeBSD' });
    assert.notEqual(bsd.status, 0);
    assert.match(bsd.err, /no program for FreeBSD/);
    const win = await run(['--version', '0.2.0'], { FAKE_UNAME_S: 'MINGW64_NT-10.0' });
    assert.match(win.err, /install\.ps1/);
    const cpu = await run(['--version', '0.2.0'], { FAKE_UNAME_M: 'riscv64' });
    assert.match(cpu.err, /no program for the riscv64 processor/);
  });

  test('refuses a version that is not a version, and unknown options', async () => {
    for (const bad of ['../etc', 'a b', '0.1.0/../x', '-x']) {
      const r = await run(['--version', bad]);
      assert.notEqual(r.status, 0, bad);
      assert.match(r.err, /isn't a version/, bad);
    }
    assert.match((await run(['--nope'])).err, /unknown option --nope/);
    assert.match((await run(['--version'])).err, /--version needs a number/);
  });

  test('says when the program installed does not run', async () => {
    files = new Map();
    release('v0.2.0', '0.2.0', '#!/bin/sh\necho "GLIBC_2.28 not found" >&2\nexit 1\n');
    const r = await run(['--version', '0.2.0']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /does not run: GLIBC_2\.28 not found/);
  });

  test('leaves no half-written file in the install folder when it stops', async () => {
    files = new Map();
    release('v0.2.0', '0.2.0');
    const r = await run(['--version', '0.2.0']);
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(readdirSync(r.bin), ['tabularius']);
  });

  test('reads the SHA256SUMS that release-assemble writes', async () => {
    const dir = mkdtempSync(join(work, 'assembled-'));
    const artifacts = join(dir, 'artifacts');
    const folder = join(artifacts, 'tabularius-Linux-X64');
    mkdirSync(folder, { recursive: true });
    const program = join(folder, 'tabularius-0.3.0-linux-x64');
    writeFileSync(program, '#!/bin/sh\necho "tabularius 0.3.0 assembled"\n');
    writeFileSync(join(folder, 'tabularius-0.3.0-linux-x64.sbom.cdx.json'), '{}');
    writeFileSync(join(folder, 'THIRD-PARTY-NOTICES.md'), 'licences');
    writeManifest(program);
    const out = join(dir, 'release');
    assembleRelease(artifacts, out, '0.3.0', ['linux-x64'], script);
    files = new Map();
    for (const name of readdirSync(out)) files.set(`v0.3.0/${name}`, readFileSync(join(out, name), 'utf8'));
    const r = await run(['--version', '0.3.0']);
    assert.equal(r.status, 0, r.err);
    assert.equal(spawnOk(join(r.bin, 'tabularius')), 'tabularius 0.3.0 assembled');
  });

  test('--help needs no network and installs nothing', async () => {
    const r = await run(['--help'], { TABULARIUS_RELEASES: 'http://127.0.0.1:1/releases' });
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /--version 0\.1\.0/);
    assert.equal(existsSync(r.bin), false);
  });

  test('is written so that half a download runs nothing: the work is inside main, which is called on the last line', () => {
    const lines = readFileSync(script, 'utf8').trimEnd().split('\n');
    assert.equal(lines.at(-1), 'main "$@"');
    assert.equal(lines.filter((l) => l.startsWith('main ')).length, 1);
    // Everything before main() is set, function definitions and comments (and the text of --help).
    const before = lines.slice(0, lines.findIndex((l) => l.startsWith('main() {')));
    assert.ok(before.some((l) => l === 'set -eu'));
  });
});

/** What the installed program prints for --version. */
function spawnOk(program: string): string {
  return spawnSync(program, ['--version'], { encoding: 'utf8' }).stdout.trim();
}
