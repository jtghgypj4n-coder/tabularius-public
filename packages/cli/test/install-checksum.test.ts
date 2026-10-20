import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scripts = join(import.meta.dirname, '..', '..', '..', 'scripts');
// Run only Node setup: no app installation, package manager or service changes.
const setupNode = readFileSync(join(scripts, 'install.sh'), 'utf8').split('# --- the app')[0];
const file = 'node-v22.22.0-linux-x64.tar.gz';
const dist = 'https://nodejs.org/dist/v22.22.0';
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const locate = (name: string) => spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
let archiveBytes: Buffer;
let good: string;
const locations = new Map<string, string>();

before(() => {
  // Every outcome starts from identical archive bytes; only the downloaded bytes and checksum text vary.
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-checksum-archive-'));
  try {
    const payload = join(dir, 'payload');
    mkdirSync(join(payload, 'node', 'bin'), { recursive: true });
    for (const name of ['node', 'npm']) writeFileSync(join(payload, 'node', 'bin', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const archive = join(dir, 'node.tgz');
    execFileSync('tar', ['-czf', archive, '-C', payload, 'node']);
    archiveBytes = readFileSync(archive);
    good = createHash('sha256').update(archiveBytes).digest('hex');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const name of ['mkdir', 'mktemp', 'rm', 'awk', 'tar', 'gzip', 'dirname', 'cp', 'sha256sum', 'shasum', 'sh'])
    locations.set(name, locate(name));
});

function runSetup(env: NodeJS.ProcessEnv): Promise<{ status: number | null; error?: Error; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(locations.get('sh')!, [], { env, timeout: 10_000, stdio: ['pipe', 'ignore', 'pipe'] });
    let error: Error | undefined;
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (cause: Error) => { error = cause; });
    child.on('close', (status) => resolve({ status, error, stderr }));
    child.stdin.end(setupNode);
  });
}

describe('Node download checksums', { concurrency: 4 }, () => {
for (const tool of ['sha256sum', 'shasum']) {
  for (const outcome of ['match', 'crlf', 'binary', 'binary-crlf', 'mismatch', 'missing', 'different-name', 'download-failure', 'no-hash-tool', 'hash-failure', 'invalid-hash']) {
    test(`Node download with ${tool}: ${outcome} checksum`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'tabularius-checksum space-'));
      try {
        const bin = join(root, 'bin');
        const home = join(root, 'home');
        const archive = join(root, 'node.tgz');
        const sums = join(root, 'SHASUMS256.txt');
        const curlLog = join(root, 'curl.log');
        const hashLog = join(root, 'hash.log');
        for (const dir of [bin, join(home, 'node'), join(root, 'tmp')]) mkdirSync(dir, { recursive: true });
        writeFileSync(join(home, 'node', 'old'), 'existing installation');
        writeFileSync(archive, archiveBytes);
        if (outcome === 'mismatch') writeFileSync(archive, 'corrupted download');
        const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
        // Decoys must never substitute for the exact filename, even with a matching hash.
        const entry = outcome === 'missing' ? ''
          : outcome === 'different-name' ? `${good}  ${file} .sig\n`
          : outcome === 'invalid-hash' ? `${'g'.repeat(64)}  ${file}\n`
          : outcome === 'crlf' ? `${good}  ${file}\r\n`
          : outcome === 'binary' ? `${good} *${file}\n`
          : outcome === 'binary-crlf' ? `${good} *${file}\r\n`
          : `${good}  ${file}\n`;
        writeFileSync(sums, `${actual}  ${file}.sig\n${actual}  prefix-${file}\n` + entry);

        for (const name of ['mkdir', 'mktemp', 'rm', 'awk', 'tar', 'gzip', 'dirname', 'cp']) symlinkSync(locations.get(name)!, join(bin, name));
        const stub = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
        stub('node', 'exit 1'); // Force the download regardless of the host Node version.
        stub('uname', 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 1 ;; esac');
        stub('curl', `[ "$#" -eq 4 ] && [ "$1" = -fsSL ] && [ "$3" = -o ]
printf '%s\\n' "$2" >> "$CURL_LOG"
case "$2" in
  "${dist}/${file}") cp "$FAKE_ARCHIVE" "$4" ;;
  "${dist}/SHASUMS256.txt") [ "$OUTCOME" != download-failure ] || exit 22; cp "$FAKE_SUMS" "$4" ;;
  *) exit 1 ;;
esac`);
        const sha256sum = locations.get('sha256sum')!;
        const hash = sha256sum ? quote(sha256sum) : `${quote(locations.get('shasum')!)} -a 256`;
        const failHash = outcome === 'hash-failure' ? 'exit 1\n' : '';
        if (outcome !== 'no-hash-tool') {
          if (tool === 'sha256sum') stub('sha256sum', `[ "$#" -eq 1 ]\necho sha256sum >> "$HASH_LOG"\n${failHash}exec ${hash} "$1"`);
          stub('shasum', `[ "$#" -eq 3 ] && [ "$1" = -a ] && [ "$2" = 256 ]\necho shasum >> "$HASH_LOG"\n${failHash}exec ${hash} "$3"`);
        }
        const r = await runSetup({ ...process.env, PATH: bin, TABULARIUS_HOME: home, TMPDIR: join(root, 'tmp'),
          FAKE_ARCHIVE: archive, FAKE_SUMS: sums, CURL_LOG: curlLog, HASH_LOG: hashLog, OUTCOME: outcome });
        assert.equal(r.error, undefined);
        assert.equal(readFileSync(curlLog, 'utf8'), `${dist}/${file}\n${dist}/SHASUMS256.txt\n`);
        assert.deepEqual(readdirSync(join(root, 'tmp')), [], 'Node download temp folder was cleaned up');
        assert.ok(existsSync(archive) && existsSync(sums), 'cleanup left files outside the temp folder intact');
        if (outcome === 'download-failure' || outcome === 'no-hash-tool') {
          assert.ok(!existsSync(hashLog), 'hash tool was not run');
        } else {
          assert.equal(readFileSync(hashLog, 'utf8'), `${tool}\n`);
        }
        if (['match', 'crlf', 'binary', 'binary-crlf'].includes(outcome)) {
          assert.equal(r.status, 0, r.stderr);
          assert.equal(readFileSync(join(home, 'node', 'bin', 'node'), 'utf8'), '#!/bin/sh\nexit 0\n');
          assert.ok(!existsSync(join(home, 'node', 'old')));
        } else {
          assert.equal(r.status, outcome === 'download-failure' ? 22 : 1, r.stderr);
          if (outcome === 'no-hash-tool') {
            assert.ok(r.stderr.includes('sha256sum or shasum is needed'), r.stderr);
          } else if (outcome !== 'download-failure' && outcome !== 'hash-failure') {
            const expected = outcome === 'mismatch' ? good : '<missing>';
            assert.ok(r.stderr.includes(`SHA256 mismatch for ${file}: expected ${expected}, actual ${actual}`), r.stderr);
          }
          assert.equal(readFileSync(join(home, 'node', 'old'), 'utf8'), 'existing installation');
          assert.ok(!existsSync(join(home, 'node', 'bin')), 'unverified archive was not extracted');
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
});

test('Windows installer checks the exact Node ZIP checksum before extraction', () => {
  const ps = readFileSync(join(scripts, 'install.ps1'), 'utf8');
  assert.match(ps, /function Die\([^\n]+Write-Error[^\n]+exit 1/);
  const start = ps.indexOf('  $file = "node-v$NodeVersion-win-$arch.zip"');
  const end = ps.indexOf('  Expand-Archive -Path $zip');
  assert.ok(start >= 0 && end > start);
  const check = ps.slice(start, end);
  assert.match(check, /\$dist = "https:\/\/nodejs\.org\/dist\/v\$NodeVersion"/);
  assert.match(check, /Invoke-WebRequest[^\n]+-Uri "\$dist\/\$file" -OutFile \$zip/);
  assert.match(check, /\$sums = Join-Path \$tmp 'SHASUMS256.txt'/);
  assert.match(check, /Invoke-WebRequest[^\n]+-Uri "\$dist\/SHASUMS256.txt" -OutFile \$sums/);
  assert.match(check, /\$expected = '<missing>'/);
  assert.match(check, /foreach \(\$line in \(Get-Content -LiteralPath \$sums\)\)/);
  // The anchored pattern captures the complete filename, accepting CRLF and the binary marker.
  assert.ok(check.includes('$line.TrimEnd("`r") -cmatch \'\\A([0-9a-fA-F]{64}) {1,2}\\*?(.*)\\z\' -and $Matches[2] -ceq $file'));
  assert.match(check, /\$expected = \$Matches\[1\]\s+break/);
  assert.match(check, /\$actual = \(Get-FileHash -Algorithm SHA256 -Path \$zip\)\.Hash/);
  assert.match(check, /if \(\$expected -eq '<missing>' -or \$actual -ne \$expected\) \{\s+Die "SHA256 mismatch for \$\{file\}: expected \$expected, actual \$actual"\s+\}/);
  // Download, hashing and extraction all stay inside try; cleanup targets only the temp folder.
  assert.match(ps, /New-Item[^\n]+-Path \$tmp[^\n]+\n  try \{/);
  const tryStart = ps.indexOf('  try {', ps.indexOf('$tmp = Join-Path'));
  const finallyStart = ps.indexOf('  } finally {', tryStart);
  assert.ok(tryStart >= 0 && tryStart < start && finallyStart > end);
  assert.ok(ps.indexOf("Remove-Item -Recurse -Force (Join-Path $OhHome 'node')") > end);
  assert.match(ps.slice(finallyStart), /^  \} finally \{\s+Remove-Item -LiteralPath \$tmp -Recurse -Force\s+\}\s+\$Node = \$own/);
});
