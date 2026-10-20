import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('audit verify reports consistent, broken and unprotected histories with distinct exits and no writes', (t) => {
  const env = commandStubEnv(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-cli-'));
  const path = join(dir, 'Test.openhbam.sqlite');
  try {
    createStore(path);
    const verify = () => spawnSync(process.execPath, ['--no-warnings', main, 'audit', 'verify', dir, 'Test'], { encoding: 'utf8', env });
    const old = readFileSync(path);
    const unprotected = verify();
    assert.equal(unprotected.status, 2, unprotected.stderr);
    assert.equal(JSON.parse(unprotected.stdout).status, 'unprotected');
    assert.deepEqual(readFileSync(path), old, 'verification did not initialize the old store');

    const store = new Store(path);
    store.auditSignIn('Ann', 'local', true);
    store.auditSignIn('Ann', 'local', false);
    store.close();
    const intact = readFileSync(path);
    const ok = verify();
    assert.equal(ok.status, 0, ok.stderr);
    const result = JSON.parse(ok.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.checked, 2);
    assert.equal(result.firstBrokenSeq, null);
    assert.deepEqual(readFileSync(path), intact);

    const sql = new DatabaseSync(path);
    sql.exec("UPDATE _fm_audit SET account = 'edited' WHERE seq = 1");
    sql.close();
    const corrupt = readFileSync(path);
    const bad = verify();
    assert.equal(bad.status, 1, bad.stderr);
    assert.equal(JSON.parse(bad.stdout).firstBrokenSeq, '1');
    assert.match(JSON.parse(bad.stdout).reason, /event hash mismatch/);
    assert.deepEqual(readFileSync(path), corrupt, 'verification did not repair the evidence');

    const listing = spawnSync(process.execPath, ['--no-warnings', main, 'audit', dir, 'Test'], { encoding: 'utf8', env });
    assert.equal(listing.status, 0, listing.stderr);
    assert.equal(listing.stdout.trim().split('\n').length, 2, 'existing audit command still lists rows');
    const help = spawnSync(process.execPath, ['--no-warnings', main, 'audit', '--help'], { encoding: 'utf8', env });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /audit verify <folder> <database>/);
    assert.match(help.stdout, /authenticity or completeness/);
    assert.match(help.stdout, /rewritten head/);
    assert.match(help.stdout, /independently protected/);
    assert.match(help.stdout, /filesystem permissions/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audit verify requires folder and database arguments and never creates a missing file', (t) => {
  const env = commandStubEnv(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-cli-missing-'));
  try {
    const args = spawnSync(process.execPath, ['--no-warnings', main, 'audit', 'verify', dir], { encoding: 'utf8', env });
    assert.equal(args.status, 1);
    assert.match(args.stderr, /give a folder and database/);
    const absent = spawnSync(process.execPath, ['--no-warnings', main, 'audit', 'verify', dir, 'Missing'], { encoding: 'utf8', env });
    assert.equal(absent.status, 1);
    assert.throws(() => readFileSync(join(dir, 'Missing.openhbam.sqlite')), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audit verify --sign-key prints a signed anchor of the newest hash, and --check catches a log rewritten since', (t) => {
  const env = commandStubEnv(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-anchor-'));
  const path = join(dir, 'Test.openhbam.sqlite');
  const keyFile = join(dir, 'anchor.key');
  const anchorFile = join(dir, 'anchor.json');
  try {
    writeFileSync(keyFile, 'a-secret-the-operator-keeps');
    createStore(path);
    const store = new Store(path);
    store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Name', type: 'text' }] }]);
    store.auditSignIn('Ann', 'local', true);
    store.auditSignIn('Ann', 'local', false);
    store.create('Records', { Name: 'Bea' }, { account: 'Ann' });
    store.close();
    const run = (...extra: string[]) => spawnSync(process.execPath, ['--no-warnings', main, 'audit', 'verify', dir, 'Test', ...extra], { encoding: 'utf8', env });

    for (const chain of ['security', 'records']) {
      const signed = run('--chain', chain, '--sign-key', keyFile);
      assert.equal(signed.status, 0, signed.stderr + signed.stdout);
      const { anchor } = JSON.parse(signed.stdout);
      assert.equal(anchor.chain, chain);
      assert.match(anchor.hash, /^[0-9a-f]{64}$/);
      assert.match(anchor.signature, /^[0-9a-f]{64}$/);
      writeFileSync(anchorFile, JSON.stringify(anchor));
      const same = run('--chain', chain, '--sign-key', keyFile, '--check', anchorFile);
      assert.equal(same.status, 0, same.stdout);
      assert.equal(JSON.parse(same.stdout).anchorCheck.status, 'matches');

      // A later, honest entry leaves the anchored hash where it was.
      const more = new Store(path);
      more.auditSignIn('Ann', 'local', true);
      more.create('Records', { Name: 'Cy' }, { account: 'Ann' });
      more.close();
      assert.equal(run('--chain', chain, '--sign-key', keyFile, '--check', anchorFile).status, 0);

      // A copy of the anchor that was edited, or checked with another key, is refused.
      writeFileSync(anchorFile, JSON.stringify({ ...anchor, hash: 'f'.repeat(64) }));
      assert.equal(JSON.parse(run('--chain', chain, '--sign-key', keyFile, '--check', anchorFile).stdout).anchorCheck.status, 'bad-signature');
      writeFileSync(anchorFile, JSON.stringify(anchor));
      writeFileSync(join(dir, 'other.key'), 'a-different-secret-key');
      assert.equal(JSON.parse(run('--chain', chain, '--sign-key', join(dir, 'other.key'), '--check', anchorFile).stdout).anchorCheck.status, 'bad-signature');
    }

    // Someone with the file rewrites an anchored entry and recomputes the chain: the log is consistent with itself,
    // but no longer holds what the anchor kept. Simulated by swapping in a log that has a different history.
    const first = JSON.parse(run('--sign-key', keyFile).stdout).anchor;
    writeFileSync(anchorFile, JSON.stringify(first));
    assert.equal(run('--sign-key', keyFile, '--check', anchorFile).status, 0, 'unchanged log still matches');
    const swapped = join(dir, 'Other.openhbam.sqlite');
    createStore(swapped);
    const other = new Store(swapped);
    for (let i = 0; i < 30; i++) other.auditSignIn('Mallory', 'local', true);
    other.close();
    const rewritten = spawnSync(process.execPath, ['--no-warnings', main, 'audit', 'verify', dir, 'Other', '--sign-key', keyFile, '--check', anchorFile], { encoding: 'utf8', env });
    assert.equal(rewritten.status, 1, rewritten.stdout);
    const out = JSON.parse(rewritten.stdout);
    assert.equal(out.ok, true, 'the other history is consistent with itself');
    assert.equal(out.anchorCheck.status, 'mismatch');
    // A log that is shorter than the anchor says it was is also refused.
    const short = join(dir, 'Short.openhbam.sqlite');
    createStore(short);
    const shorter = new Store(short);
    shorter.auditSignIn('Mallory', 'local', true);
    shorter.close();
    const cut = spawnSync(process.execPath, ['--no-warnings', main, 'audit', 'verify', dir, 'Short', '--sign-key', keyFile, '--check', anchorFile], { encoding: 'utf8', env });
    assert.equal(cut.status, 1);
    assert.equal(JSON.parse(cut.stdout).anchorCheck.status, 'missing');

    assert.match(run('--check', anchorFile).stderr, /--sign-key/);
    assert.match(run('--chain', 'nope').stderr, /--chain takes/);
    assert.equal(run('--sign-key', join(dir, 'missing.key')).status !== 0, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audit JSONL cannot emit terminal controls, hidden lines or unbounded names', (t) => {
  const env = commandStubEnv(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-cli-output-'));
  try {
    const path = join(dir, 'Test.openhbam.sqlite');
    createStore(path);
    const store = new Store(path);
    const name = 'forged\n\r\u001b[2J\u202ehidden';
    store.auditSignIn(name, 'local', true);
    store.auditSignIn('x'.repeat(100_000), 'local', false);
    store.close();
    const result = spawnSync(process.execPath, ['--no-warnings', main, 'audit', dir, 'Test'], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines.every(line => line.length < 9000 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line)));
    assert.equal(JSON.parse(lines[0]).account, name);
    assert.equal(JSON.parse(lines[1]).truncated, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
