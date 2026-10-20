import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteBeforeStateLock } from './state-lock-race.ts';
import { registerAdminPasskey, removeAdminPasskey, adminPasskeys, verifyAdminPasskeyAssertion } from '../src/admin-passkey.ts';
import { makeAuthenticator, forgeRegistration, forgeAssertion } from '../../store/test/forge-webauthn.ts';
import { ImportedCertificates } from '../src/cert-import.ts';
import { recordChecksum } from '../src/backup-verify.ts';
import { mirrorUp, S3 } from '../src/s3.ts';
import { Connections } from '../src/connections.ts';

function folder(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'state-followups-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const env = { rpId: 'localhost', origin: 'http://localhost', challenge: 'test-challenge' };

test('passkey registration and removal reload under their state lock', (t) => {
  const dir = folder(t);
  const f = join(dir, '.openhbam-admin-passkeys');
  const a = makeAuthenticator(env.rpId, env.origin), b = makeAuthenticator(env.rpId, env.origin);
  const first = registerAdminPasskey(dir, forgeRegistration(a, env.challenge), env).id;
  deleteBeforeStateLock(f, () => { removeAdminPasskey(dir, first); }, () => {
    registerAdminPasskey(dir, forgeRegistration(b, env.challenge), env);
  });
  assert.equal(adminPasskeys(dir).length, 1);
  deleteBeforeStateLock(f, () => { registerAdminPasskey(dir, forgeRegistration(a, env.challenge), env); }, () => {
    removeAdminPasskey(dir, adminPasskeys(dir)[0].id);
  });
  assert.deepEqual(adminPasskeys(dir).map((p) => p.id), [first]);
});

test('passkey assertion cannot resurrect a credential revoked before locking', (t) => {
  const dir = folder(t), f = join(dir, '.openhbam-admin-passkeys');
  const auth = makeAuthenticator(env.rpId, env.origin);
  const { id } = registerAdminPasskey(dir, forgeRegistration(auth, env.challenge), env);
  deleteBeforeStateLock(f, () => { removeAdminPasskey(dir, id); }, () => {
    assert.throws(() => verifyAdminPasskeyAssertion(dir, forgeAssertion(auth, env.challenge), env), /not registered/);
  });
  assert.deepEqual(adminPasskeys(dir), []);
});

test('certificate deletion preserves settings changed before lock acquisition', (t) => {
  const dir = folder(t), f = join(dir, '.openhbam-settings.json');
  // ImportedCertificates identifies an imported certificate by this private directory.
  mkdirSync(join(dir, '.openhbam-tls', 'imported'), { recursive: true });
  writeFileSync(f, JSON.stringify({ tlsCert: '.openhbam-tls/imported/cert.pem', tlsKey: '.openhbam-tls/imported/key.pem' }));
  const certs = new ImportedCertificates(dir);
  assert.ok(certs.imported());
  deleteBeforeStateLock(f, () => {
    const current = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...current, port: 9876 }));
  }, () => { certs.delete(); });
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { port: 9876 });
});

test('backup checksum updates lock the shared manifest and preserve other fields', async (t) => {
  const dir = folder(t), f = join(dir, 'backup.json'), stored = join(dir, 'copy');
  writeFileSync(stored, 'data'); writeFileSync(f, '{}');
  // recordChecksum hashes asynchronously; intercept the subsequent synchronous update.
  const { DatabaseSync } = await import('node:sqlite');
  const exec = DatabaseSync.prototype.exec;
  let locked = false;
  t.mock.method(DatabaseSync.prototype, 'exec', function (this: InstanceType<typeof DatabaseSync>, sql: string) {
    if (sql === 'BEGIN EXCLUSIVE') { locked = true; writeFileSync(f, JSON.stringify({ external: { kept: true } })); }
    return exec.call(this, sql);
  });
  await recordChecksum(dir, 'copy', stored);
  assert.ok(locked);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')).external, { kept: true });
});

test('S3 progress merges a concurrent mirror entry and retains files added during upload', async (t) => {
  const dir = folder(t), f = join(dir, '.s3-mirrored.json');
  const set = '2026-10-16_120000';
  mkdirSync(join(dir, set));
  writeFileSync(join(dir, set, 'first'), 'one');
  const s3 = new S3({ url: 's3://bucket', accessKey: 'test', secretKey: 'test' });
  t.mock.method(s3, 'put', async () => {
    writeFileSync(join(dir, set, 'second'), 'two');
    writeFileSync(f, JSON.stringify({ [join(set, 'second')]: 'concurrent-upload' }));
  });
  t.mock.method(s3, 'list', async () => [{ key: `${set}/second`, size: 3 }]);
  t.mock.method(s3, 'delete', async () => { assert.fail('must retain the concurrent upload'); });
  await mirrorUp(dir, s3);
  const saved = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(saved[join(set, 'second')], 'concurrent-upload');
  assert.ok(saved[join(set, 'first')]);
});

test('S3 mirrors do not upload local SQLite state lock sidecars', async (t) => {
  const dir = folder(t);
  writeFileSync(join(dir, 'backup.json'), '{}');
  writeFileSync(join(dir, 'backup.json.lock.db'), '');
  const s3 = new S3({ url: 's3://bucket', accessKey: 'test', secretKey: 'test' });
  const uploaded: string[] = [];
  t.mock.method(s3, 'put', async (key: string) => { uploaded.push(key); });
  t.mock.method(s3, 'list', async () => []);
  await mirrorUp(dir, s3);
  assert.deepEqual(uploaded, ['backup.json']);
});

test('first secrets select their encryption salt under the same lock as their document', (t) => {
  const dir = folder(t);
  const previous = process.env.TABULARIUS_SECRETS_KEY;
  process.env.TABULARIUS_SECRETS_KEY = 'shared passphrase';
  try {
    const first = new Connections(dir)['vault'], second = new Connections(dir)['vault'];
    deleteBeforeStateLock(join(dir, '.openhbam-connection-secrets.json'), () => second.set('other', 'second'), () => first.set('mine', 'first'));
    const reader = new Connections(dir)['vault'];
    assert.equal(reader.get('other'), 'second');
    assert.equal(reader.get('mine'), 'first');
  } finally {
    if (previous === undefined) delete process.env.TABULARIUS_SECRETS_KEY;
    else process.env.TABULARIUS_SECRETS_KEY = previous;
  }
});
