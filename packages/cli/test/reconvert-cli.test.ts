// `tabularius reconvert` while the server is running: it asks the server through
// the folder's local channel, so no sudo, no admin password and no downtime
// for the other files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, importFmp12 } from '../../store/src/index.ts';
import { serve, setAdminPassword } from '../../server/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const main = join(import.meta.dirname, '..', 'src', 'main.ts');

function cli(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['--no-warnings', main, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => ok({ code: code ?? -1, out }));
  });
}

test('reconvert --all asks the running server, which keeps a password-protected console', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reconvert-cli-'));
  for (const name of ['Flicks', 'Other']) {
    copyFileSync(fixture, join(dir, `${name}.fmp12`));
    importFmp12(join(dir, `${name}.fmp12`), join(dir, `${name}.openhbam.sqlite`));
    const sql = new DatabaseSync(join(dir, `${name}.openhbam.sqlite`));
    sql.prepare("DELETE FROM _fm_meta WHERE key = 'converterVersion'").run();
    sql.close();
  }
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const local = join(dir, '.openhbam.local');
    assert.ok(existsSync(local));
    if (process.platform !== 'win32') assert.equal(statSync(local).mode & 0o777, 0o600, 'only the server user can read it');
    // Without the token the console still wants the password.
    assert.equal((await fetch(`${s.url}/tabularius/admin/v1/status`)).status, 401);
    assert.equal((await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { 'x-tabularius-local': 'f'.repeat(64) } })).status, 401);

    const dry = await cli('reconvert', dir, '--all', '--dry-run');
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /Flicks: \d+ of \d+ accounts kept; edits made since kept/);
    assert.match(dry.out, /Other: /);
    assert.equal(s.host.reconvertStatus('Flicks')?.outdated, true, 'a dry run changes nothing');

    const run = await cli('reconvert', dir, '--all');
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /converted Flicks again: .*kept/);
    assert.match(run.out, /converted Other again/);
    assert.equal(s.host.reconvertStatus('Flicks')?.outdated, false);
    assert.equal(s.host.reconvertStatus('Other')?.outdated, false);
    assert.ok(s.host.get('Flicks'), 'hosted again');
    assert.ok(readdirSync(dir).some((f) => f.startsWith('Flicks.openhbam.sqlite.before-reconvert-')));

    const again = await cli('reconvert', dir, '--all');
    assert.match(again.out, /no files need converting again/);
  } finally {
    await new Promise<void>((resolve, reject) => s.server.close((error) => error ? reject(error) : resolve()));
  }
  assert.ok(!existsSync(join(dir, '.openhbam.local')), 'gone when the server stops');
  rmSync(dir, { recursive: true, force: true });
});

test('reconvert refuses a native file, which has no .fmp12 to convert from', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reconvert-native-'));
  try {
    createStore(join(dir, 'Native.openhbam.sqlite'), { mode: 'native' });
    writeFileSync(join(dir, 'Native.fmp12'), 'not a FileMaker file');
    for (const flags of [[], ['--force'], ['--dry-run']]) {
      const r = await cli('reconvert', dir, 'Native', ...flags);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /native file .* can't be converted again/, r.out);
      assert.doesNotMatch(r.out, /converting it again anyway|was converted by this version already/);
    }
    assert.deepEqual(readdirSync(dir).filter((f) => f.includes('reconvert')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
