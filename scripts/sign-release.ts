// Signs (and on macOS notarizes) the single-file programs scripts/build-release.ts wrote, when the certificates are
// supplied; with none supplied it says so and leaves them alone, so the release build works today without them.
//
//   node scripts/sign-release.ts dist/tabularius-*
//
// macOS (APPLE_*): a Developer ID Application certificate signs with the hardened runtime; with an Apple ID app
// password the program is also notarized. Windows (WINDOWS_CERT_*): an Authenticode code-signing certificate signs
// with signtool. Linux programs aren't signed. docs/signing.md lists what to buy and which secrets to set.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type Step =
  /** Runs a program (its command line may carry a secret, so only the note is ever printed). */
  | { run: [string, ...string[]]; note: string }
  /** Writes a base64 environment value to a file (a certificate), at `file` inside the working folder. */
  | { write: { file: string; base64: string }; note: string };

/** Whether a path in dist/ is the program (and not its bill of materials, checksums, pack or notices, which sit beside it). */
export const isProgramFile = (path: string) => !/\.(?:sbom\.cdx\.json|sha256|pack|md)$/.test(path);

export interface Plan {
  /** What there is to do for this program, or why nothing is. */
  steps: Step[];
  /** Said to the person running the build. */
  report: string[];
}

const set = (env: Record<string, string | undefined>, k: string) => (env[k]?.trim() ? env[k]!.trim() : undefined);

/** The signing steps for one program on one system, from the environment. Pure: nothing runs here. */
export function signingPlan(platform: NodeJS.Platform, program: string, env: Record<string, string | undefined>, entitlements: string, work: string): Plan {
  if (platform === 'darwin') {
    const identity = set(env, 'APPLE_SIGNING_IDENTITY');
    if (!identity) return { steps: [], report: ['macOS: no APPLE_SIGNING_IDENTITY, so the program keeps its ad-hoc signature (people must allow it in System Settings)'] };
    const steps: Step[] = [];
    const p12 = set(env, 'APPLE_CERTIFICATE_P12_BASE64');
    const p12Password = set(env, 'APPLE_CERTIFICATE_PASSWORD');
    if (p12) {
      if (!p12Password) throw new Error('APPLE_CERTIFICATE_P12_BASE64 needs APPLE_CERTIFICATE_PASSWORD');
      const keychain = join(work, 'build.keychain-db');
      const temp = 'tabularius-build-keychain';
      steps.push(
        { write: { file: join(work, 'certificate.p12'), base64: p12 }, note: 'writing the certificate to a temporary file' },
        { run: ['security', 'create-keychain', '-p', temp, keychain], note: 'making a temporary keychain' },
        { run: ['security', 'set-keychain-settings', '-lut', '3600', keychain], note: 'keeping it unlocked for the build' },
        { run: ['security', 'unlock-keychain', '-p', temp, keychain], note: 'unlocking it' },
        { run: ['security', 'import', join(work, 'certificate.p12'), '-k', keychain, '-P', p12Password, '-T', '/usr/bin/codesign'], note: 'importing the certificate' },
        { run: ['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', temp, keychain], note: 'letting codesign use the key' },
        { run: ['security', 'list-keychains', '-d', 'user', '-s', keychain, 'login.keychain-db'], note: 'putting the keychain on the search list' },
      );
    }
    steps.push(
      { run: ['codesign', '--force', '--sign', identity, '--options', 'runtime', '--timestamp', '--entitlements', entitlements, program], note: `signing ${program}` },
      { run: ['codesign', '--verify', '--strict', '--verbose=2', program], note: 'checking the signature' },
    );
    const report = [`macOS: signing with "${identity}"`];
    const [appleId, team, password] = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_PASSWORD'].map((k) => set(env, k));
    if (appleId && team && password) {
      const zip = join(work, 'notarize.zip');
      steps.push(
        { run: ['ditto', '-c', '-k', '--keepParent', program, zip], note: 'zipping it for Apple' },
        { run: ['xcrun', 'notarytool', 'submit', zip, '--apple-id', appleId, '--team-id', team, '--password', password, '--wait'], note: 'notarizing (this waits for Apple)' },
      );
      report.push('macOS: notarizing with the Apple ID app password');
    } else if (appleId || team || password) {
      throw new Error('notarizing needs APPLE_ID, APPLE_TEAM_ID and APPLE_APP_PASSWORD together');
    } else {
      report.push('macOS: no Apple ID set, so the program is signed but not notarized');
    }
    return { steps, report };
  }
  if (platform === 'win32') {
    const pfx = set(env, 'WINDOWS_CERT_PFX_BASE64');
    const password = set(env, 'WINDOWS_CERT_PASSWORD');
    if (!pfx && !password) return { steps: [], report: ['Windows: no WINDOWS_CERT_PFX_BASE64, so the program is unsigned (SmartScreen will warn)'] };
    if (!pfx || !password) throw new Error('signing on Windows needs WINDOWS_CERT_PFX_BASE64 and WINDOWS_CERT_PASSWORD together');
    const file = join(work, 'certificate.pfx');
    const stamp = set(env, 'WINDOWS_TIMESTAMP_URL') ?? 'http://timestamp.digicert.com';
    return {
      steps: [
        { write: { file, base64: pfx }, note: 'writing the certificate to a temporary file' },
        { run: ['signtool', 'sign', '/f', file, '/p', password, '/fd', 'sha256', '/tr', stamp, '/td', 'sha256', program], note: `signing ${program}` },
        { run: ['signtool', 'verify', '/pa', program], note: 'checking the signature' },
      ],
      report: ['Windows: signing with the supplied certificate'],
    };
  }
  return { steps: [], report: [`${platform}: programs aren't signed on this system`] };
}

/** Runs a plan. A step that fails stops the build: a release that was meant to be signed never goes out unsigned. */
function execute(plan: Plan): void {
  for (const s of plan.steps) {
    console.log(`  ${s.note}`);
    if ('write' in s) {
      writeFileSync(s.write.file, Buffer.from(s.write.base64, 'base64'), { mode: 0o600 });
      continue;
    }
    const [cmd, ...args] = s.run;
    // Output is shown, but the command line (which may carry a password) is not.
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${s.note} failed (${cmd} exited ${r.status ?? r.signal})`);
  }
}

if (import.meta.main) {
  const programs = process.argv.slice(2).filter((a) => !a.startsWith('-') && isProgramFile(a)).map((a) => resolve(a));
  if (!programs.length) {
    console.error('usage: node scripts/sign-release.ts dist/tabularius-<version>-<os>-<cpu>…');
    process.exit(2);
  }
  const entitlements = resolve(import.meta.dirname, '..', 'packaging', 'entitlements.plist');
  const work = mkdtempSync(join(tmpdir(), 'tabularius-sign-'));
  try {
    for (const program of programs) {
      const plan = signingPlan(process.platform, program, process.env, entitlements, work);
      for (const line of plan.report) console.log(line);
      execute(plan);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
