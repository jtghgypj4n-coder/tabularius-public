import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';
import { encryptedUnchecked, filesNewerThan } from '../src/newer-files.ts';
import { stopOwnServer } from '../src/service.ts';
import { testCommandPath } from '../../../scripts/test-command-path.ts';

const main = join(import.meta.dirname, '../src/main.ts');

test('blank encryption keys refuse serve and offline inspection', async (t) => {
  const env = testCommandPath(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const saved = process.env.TABULARIUS_ENCRYPTION_KEY;
  t.after(() => { if (saved === undefined) delete process.env.TABULARIUS_ENCRYPTION_KEY; else process.env.TABULARIUS_ENCRYPTION_KEY = saved; });
  for (const key of ['', '   ', '\t\n']) {
    // An invalid workers option stops the old code before any listener or background work starts.
    const r = await runCli(main, ['serve', dir, '--workers', 'invalid'], { env: { ...env, TABULARIUS_ENCRYPTION_KEY: key } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^error: .*TABULARIUS_ENCRYPTION_KEY.*unset.*passphrase\n$/);
    for (const command of ['encrypt', 'decrypt']) {
      const r = await runCli(main, [command, dir], { env: { ...env, TABULARIUS_ENCRYPTION_KEY: key } });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^error: .*TABULARIUS_ENCRYPTION_KEY.*unset.*passphrase\n$/);
    }
    process.env.TABULARIUS_ENCRYPTION_KEY = key;
    assert.throws(() => encryptedUnchecked(dir), /TABULARIUS_ENCRYPTION_KEY.*unset.*passphrase/);
    assert.throws(() => filesNewerThan(dir, 1), /TABULARIUS_ENCRYPTION_KEY.*unset.*passphrase/);
  }
});

test('invalid stop grace refuses before sending any process signal', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.openhbam.pid'), String(process.pid + 1));
  const saved = process.env.TABULARIUS_STOP_GRACE_MS;
  t.after(() => { if (saved === undefined) delete process.env.TABULARIUS_STOP_GRACE_MS; else process.env.TABULARIUS_STOP_GRACE_MS = saved; });
  let calls = 0;
  let grace = 0;
  const control = { kill: () => { calls++; return true as const; }, exited: (_pid: number, ms: number) => { grace = ms; return true; }, request: () => { calls++; } };
  for (const value of ['', '0', '-1', '1.5', '1e9', 'abc']) {
    process.env.TABULARIUS_STOP_GRACE_MS = value;
    assert.throws(() => stopOwnServer(dir, 'linux', control), /TABULARIUS_STOP_GRACE_MS.*whole number.*decimal digits/);
    assert.equal(calls, 0);
  }
  process.env.TABULARIUS_STOP_GRACE_MS = '512';
  assert.equal(stopOwnServer(dir, 'linux', control), true);
  assert.equal(grace, 512);
});

test('serve rejects numeric shorthand and fractions with the setting name', async (t) => {
  const env = testCommandPath(t);
  delete env.TABULARIUS_ENCRYPTION_KEY;
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, value] of [['--port', '1e3'], ['--port', ''], ['--http-port', '0x50'], ['--keep', '1.5'], ['--sql-port', ''], ['--sql-port', '1e3'], ['--ai-daily-tokens', '1e9'], ['--ai-account-daily-tokens', '1.5']]) {
    const args = ['serve', dir, name, value, '--workers', 'invalid'];
    if (name === '--http-port') args.push('--https', 'test.example');
    if (name.startsWith('--ai-')) {
      args.push('--ai');
      env.ANTHROPIC_API_KEY = ['synthetic', 'test', 'key'].join('-');
      env.TABULARIUS_HOME = dir;
    }
    const r = await runCli(main, args, { env });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(name), r.stderr);
    assert.match(r.stderr, /whole number.*decimal digits/);
  }
});

test('numeric environment errors name their source and CLI flags retain precedence', async (t) => {
  const env = testCommandPath(t);
  delete env.TABULARIUS_ENCRYPTION_KEY;
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['PORT', 'TABULARIUS_HTTP_PORT', 'TABULARIUS_SQL_PORT', 'TABULARIUS_BACKUP_KEEP', 'TABULARIUS_WORKERS', 'TABULARIUS_DRAIN_SECONDS', 'TABULARIUS_AI_DAILY_TOKENS', 'TABULARIUS_AI_ACCOUNT_DAILY_TOKENS']) {
    const args = ['serve', dir];
    if (!['TABULARIUS_WORKERS', 'TABULARIUS_DRAIN_SECONDS'].includes(name)) args.push('--workers', 'invalid');
    if (name === 'TABULARIUS_HTTP_PORT') args.push('--https', 'test.example');
    if (name.startsWith('TABULARIUS_AI_')) args.push('--ai');
    const r = await runCli(main, args, { env: { ...env, [name]: '1e3', ANTHROPIC_API_KEY: ['synthetic', 'test', 'key'].join('-'), TABULARIUS_HOME: dir } });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(name), r.stderr);
    assert.match(r.stderr, /whole number.*decimal digits/);
  }
  const override = await runCli(main, ['serve', dir, '--port', '0', '--keep', '3', '--workers', 'invalid'], { env: { ...env, PORT: 'bad', TABULARIUS_BACKUP_KEEP: 'bad' } });
  assert.match(override.stderr, /--workers/);
  assert.doesNotMatch(override.stderr, /PORT|BACKUP_KEEP/);
});
