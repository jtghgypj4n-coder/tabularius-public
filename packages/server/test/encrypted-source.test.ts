// A .fmp12 that uses Encryption at Rest, dropped into the hosted folder: it
// waits as "Needs passphrase" instead of failing, a wrong passphrase is
// refused at once, the right one converts and hosts it, and converting it
// again asks for the passphrase again (it is never kept).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Host, PassphraseNeeded } from '../src/host.ts';

const BLOCK = 4096, BODY = 4064, SALT_OFF = 0xfa;
const PASS = 'Tabularius!';

/** An Encryption at Rest copy of a plaintext .fmp12, as FileMaker writes one (see the reader's encryption test). */
function encrypt(plain: Uint8Array, passphrase: string, hint: string): Uint8Array {
  const salt = Buffer.alloc(16, 7);
  const key = pbkdf2Sync(Buffer.from(passphrase, 'utf16le'), salt, 18000, 32, 'sha1');
  const out = Buffer.from(plain);
  out.set(Buffer.from('HBAMe', 'ascii'), 15);
  out.set(Buffer.from(hint, 'utf16le'), 20);
  out.set(salt, SALT_OFF);
  for (let base = BLOCK; base + BLOCK <= out.length; base += BLOCK) {
    const iv = Buffer.alloc(16);
    iv.writeUInt32LE(base / BLOCK, 0);
    const c = createCipheriv('aes-256-cbc', key, iv);
    c.setAutoPadding(false);
    out.set(Buffer.concat([c.update(out.subarray(base, base + BODY)), c.final()]), base);
    out.set(iv, base + BODY);
  }
  return out;
}

let dir: string;
const logs: string[] = [];

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-encrypted-source-'));
  writeFileSync(join(dir, 'Flicks.fmp12'), encrypt(readFileSync(join(import.meta.dirname, '../../../fixtures/fmp12/Flicks.fmp12')), PASS, 'the record keeper'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('an encrypted file waits for its passphrase, is hosted with the right one, and is converted again only with it', async () => {
  const host = new Host(dir, (m) => logs.push(m));
  try {
    assert.deepEqual([...host.locked.keys()], ['Flicks.fmp12']);
    assert.equal(host.locked.get('Flicks.fmp12')!.hint, 'the record keeper');
    assert.equal(host.get('Flicks'), undefined);
    assert.ok(logs.some((l) => /Flicks\.fmp12 uses Encryption at Rest/.test(l)));
    // The folder watcher leaves it alone (no failed conversion, nothing written).
    await host.scan();
    await host.scan();
    assert.equal(host.get('Flicks'), undefined);
    assert.deepEqual(readdirSync(dir).filter((f) => !f.endsWith('.fmp12')), []);

    assert.throws(() => host.checkPassphrase('Flicks.fmp12', 'nope'), /^Error: wrong passphrase$/);
    await assert.rejects(host.unlock('Flicks.fmp12', 'nope'), /^Error: wrong passphrase$/);
    assert.ok(host.locked.has('Flicks.fmp12'));

    const r = await host.unlock('Flicks.fmp12', PASS, (m) => logs.push(m));
    assert.equal(r.name, 'Flicks');
    assert.ok(r.records > 0);
    assert.ok(host.get('Flicks'));
    assert.equal(host.locked.size, 0);
    assert.ok(!logs.some((l) => l.includes(PASS)), 'the passphrase is never logged');

    // Converting it again needs the passphrase again.
    await assert.rejects(host.previewReconvert('Flicks'), (e) => e instanceof PassphraseNeeded && e.hint === 'the record keeper');
    await assert.rejects(host.previewReconvert('Flicks', { passphrase: 'nope' }), /wrong passphrase/);
    // A wrong passphrase is refused before the file is closed for everyone.
    const open = host.get('Flicks');
    await assert.rejects(host.reconvertFile('Flicks', { force: true, passphrase: 'nope' }), /^Error: wrong passphrase$/);
    await assert.rejects(host.reconvertFile('Flicks', { force: true }), PassphraseNeeded);
    assert.equal(host.get('Flicks'), open, 'still open, never closed');
    const p = await host.previewReconvert('Flicks', { passphrase: PASS });
    assert.ok(p.preview.tables.length > 0);
  } finally {
    host.close();
  }
  // Nothing beside the store holds it.
  for (const f of readdirSync(dir)) if (!f.endsWith('.fmp12')) assert.ok(!readFileSync(join(dir, f)).includes(Buffer.from(PASS)), f);
  assert.ok(existsSync(join(dir, 'Flicks.fmp12')));
});

test('a waiting encrypted file that is removed waits no longer', async () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-encrypted-gone-'));
  try {
    writeFileSync(join(d, 'Gone.fmp12'), readFileSync(join(dir, 'Flicks.fmp12')));
    const host = new Host(d);
    try {
      assert.ok(host.locked.has('Gone.fmp12'));
      rmSync(join(d, 'Gone.fmp12'));
      await host.scan();
      assert.equal(host.locked.size, 0);
    } finally {
      host.close();
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('the command line reads .fmp12 files, and asks for an encrypted one\'s passphrase only when it needs one', () => {
  const cli = join(import.meta.dirname, '../../cli/src/main.ts');
  const env = { ...process.env, TABULARIUS_SOURCE_PASSPHRASE: '' };
  const plain = spawnSync(process.execPath, ['--no-warnings', cli, 'info', join(import.meta.dirname, '../../../fixtures/fmp12/Flicks.fmp12')], { encoding: 'utf8', env, input: '' });
  assert.equal(plain.status, 0, plain.stderr);
  const enc = join(dir, 'Flicks.fmp12');
  const none = spawnSync(process.execPath, ['--no-warnings', cli, 'info', enc], { encoding: 'utf8', env, input: '' });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /uses Encryption at Rest/);
  const given = spawnSync(process.execPath, ['--no-warnings', cli, 'info', enc], { encoding: 'utf8', env: { ...env, TABULARIUS_SOURCE_PASSPHRASE: PASS }, input: '' });
  assert.equal(given.status, 0, given.stderr);
});
