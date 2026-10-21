import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute, isProgramFile, signingPlan, type Step } from '../../../scripts/sign-release.ts';

const plan = (platform: NodeJS.Platform, env: Record<string, string>) => signingPlan(platform, '/dist/tabularius', env, '/repo/packaging/entitlements.plist', '/tmp/work');
const commands = (steps: Step[]) => steps.flatMap((s) => ('run' in s ? [s.run[0]] : ['write']));

test('AR-cli-plugins-tooling-08', (t) => {
  const work = mkdtempSync(join(tmpdir(), 'tabularius-sign-test-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  for (const failure of ['none', 'set', 'sign'] as const) {
    const p = signingPlan('darwin', '/dist/tabularius', { APPLE_SIGNING_IDENTITY: 'Synthetic', APPLE_CERTIFICATE_P12_BASE64: 'AAAA', APPLE_CERTIFICATE_PASSWORD: 'synthetic' }, '/repo/packaging/entitlements.plist', work);
    const original = ['/synthetic/login.keychain-db', '/synthetic/custom.keychain-db'];
    let current = original.slice();
    let deleted = false;
    const runner = (cmd: string, args: string[], capture: boolean) => {
      if (cmd === 'security' && args[0] === 'list-keychains' && args.includes('-s')) {
        current = args.slice(args.indexOf('-s') + 1);
        if (failure === 'set' && current[0] === join(work, 'build.keychain-db')) return { status: 1 };
      }
      if (cmd === 'security' && args[0] === 'list-keychains' && !args.includes('-s')) return { status: 0, stdout: current.map((path) => `    ${JSON.stringify(path)}`).join('\n') };
      if (cmd === 'security' && args[0] === 'delete-keychain') deleted = true;
      if (failure === 'sign' && cmd === 'codesign' && args[0] === '--force') return { status: 1 };
      return { status: 0, stdout: capture ? '' : undefined };
    };
    if (failure !== 'none') assert.throws(() => execute(p, runner), /failed/);
    else execute(p, runner);
    assert.deepEqual(current, original);
    assert.equal(deleted, true);
  }
});

test('with no certificates there is nothing to do, and the plan says why', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    const p = plan(platform, {});
    assert.deepEqual(p.steps, []);
    assert.equal(p.report.length, 1);
  }
  // Blank secrets (an unset repository secret reaches the step as empty text) count as absent.
  assert.deepEqual(plan('darwin', { APPLE_SIGNING_IDENTITY: '  ', APPLE_ID: '' }).steps, []);
});

test('macOS signs with the hardened runtime and the entitlements, and notarizes only with every Apple ID setting', () => {
  const signed = plan('darwin', { APPLE_SIGNING_IDENTITY: 'Developer ID Application: A (T1)' });
  assert.deepEqual(commands(signed.steps), ['codesign', 'codesign'], 'signs, then checks the signature');
  const args = (signed.steps[0] as { run: string[] }).run;
  assert.ok(args.includes('runtime') && args.includes('--timestamp') && args.includes('/repo/packaging/entitlements.plist'));
  assert.match(signed.report.join(' '), /not notarized/);
  const all = plan('darwin', { APPLE_SIGNING_IDENTITY: 'X', APPLE_CERTIFICATE_P12_BASE64: 'AAAA', APPLE_CERTIFICATE_PASSWORD: 'p', APPLE_ID: 'a@b.example', APPLE_TEAM_ID: 'T1', APPLE_APP_PASSWORD: 'pw' });
  assert.deepEqual(commands(all.steps), ['write', 'security', 'security', 'security', 'security', 'security', 'security', 'codesign', 'codesign', 'ditto', 'xcrun']);
  assert.throws(() => plan('darwin', { APPLE_SIGNING_IDENTITY: 'X', APPLE_ID: 'a@b.example' }), /together/);
  assert.throws(() => plan('darwin', { APPLE_SIGNING_IDENTITY: 'X', APPLE_CERTIFICATE_P12_BASE64: 'AAAA' }), /APPLE_CERTIFICATE_PASSWORD/);
});

test('Windows needs the certificate and its password together, and signs then verifies', () => {
  assert.throws(() => plan('win32', { WINDOWS_CERT_PFX_BASE64: 'AAAA' }), /together/);
  assert.throws(() => plan('win32', { WINDOWS_CERT_PASSWORD: 'p' }), /together/);
  const p = plan('win32', { WINDOWS_CERT_PFX_BASE64: 'AAAA', WINDOWS_CERT_PASSWORD: 'p' });
  assert.deepEqual(commands(p.steps), ['write', 'signtool', 'signtool']);
  assert.ok((p.steps[1] as { run: string[] }).run.includes('http://timestamp.digicert.com'));
});

test('no step\'s note ever carries a secret, and Linux has nothing to sign', () => {
  const p = plan('darwin', { APPLE_SIGNING_IDENTITY: 'X', APPLE_CERTIFICATE_P12_BASE64: 'AAAA', APPLE_CERTIFICATE_PASSWORD: 'hunter2', APPLE_ID: 'a@b.example', APPLE_TEAM_ID: 'T1', APPLE_APP_PASSWORD: 'swordfish' });
  assert.doesNotMatch(JSON.stringify([...p.steps.map((s) => s.note), ...p.report]), /hunter2|swordfish/);
  assert.deepEqual(plan('linux', { APPLE_SIGNING_IDENTITY: 'X' }).steps, []);
});

test('the entitlements file is a plist with what Node needs, and the doc carries the workflow step', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  assert.match(readFileSync(join(root, 'packaging', 'entitlements.plist'), 'utf8'), /com\.apple\.security\.cs\.allow-jit/);
  // Every secret the script reads is in the step the doc tells the owner to add.
  const doc = readFileSync(join(root, 'docs', 'signing.md'), 'utf8');
  const source = readFileSync(join(root, 'scripts', 'sign-release.ts'), 'utf8');
  for (const name of new Set(source.match(/\b(?:APPLE|WINDOWS)_[A-Z0-9_]*[A-Z0-9]\b/g))) assert.ok(doc.includes(`${name}: \${{ secrets.${name} }}`) || name === 'WINDOWS_TIMESTAMP_URL', name);
});

test('run with no certificates, the script succeeds and signs nothing', () => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(import.meta.dirname, '..', '..', '..', 'scripts', 'sign-release.ts'), '/nonexistent/tabularius'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no APPLE_SIGNING_IDENTITY|no WINDOWS_CERT|aren't signed/);
});

test('files written beside the program (bill of materials, checksums, notices) are never signed', () => {
  assert.equal(isProgramFile('dist/tabularius-1.0.0-macos-arm64'), true);
  assert.equal(isProgramFile('dist/tabularius-1.0.0-windows-x64.exe'), true);
  for (const f of ['dist/tabularius-1.0.0-linux-x64.sbom.cdx.json', 'dist/tabularius-1.0.0-linux-x64.sha256', 'dist/tabularius-1.0.0-linux-x64.pack', 'dist/THIRD-PARTY-NOTICES.md']) assert.equal(isProgramFile(f), false, f);
});
