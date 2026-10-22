import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupExternal, restoreExternal, verifyExternal } from '../src/backup-external.ts';
import { checksum } from '../src/backup-verify.ts';
import { signManifest } from '../src/backup-auth.ts';

function setup(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), 'external-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const live = join(root, 'live');
  const first = join(root, 'first');
  const second = join(root, 'second');
  for (const dir of [live, first, second]) fs.mkdirSync(dir);
  const rel = 'Files/A/data';
  fs.mkdirSync(join(live, 'Files/A'), { recursive: true });
  fs.writeFileSync(join(live, rel), 'original');
  return { live, first, second, rel };
}

/** An encrypted set is only reused by the next backup when its manifest is signed, as a whole backup signs it. */
async function sign(set: string, key: string): Promise<void> {
  if (key) await signManifest(set, key, (info) => { info.sha256 ??= {}; info.finished ??= {}; });
}

for (const key of ['', 'key']) test(`unchanged 128 MiB container is linked without content reads within 1.5 s${key ? ' encrypted' : ''}`, async (t) => {
  const { live, first, second, rel } = setup(t);
  fs.writeFileSync(join(live, rel), Buffer.alloc(128 * 1024 * 1024, 42));
  await backupExternal(live, ['A'], first, undefined, key);
  await sign(first, key);
  // The read prohibition makes this deterministic even on a very fast disk;
  // 1.5 s allows well over 3x headroom for metadata, linking and manifest IO.
  t.mock.method(fs, 'createReadStream', () => { throw new Error('unchanged backup must not read content'); });
  syncBuiltinESMExports();
  const start = performance.now();
  try { await backupExternal(live, ['A'], second, first, key); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  const elapsed = performance.now() - start;
  t.diagnostic(`unchanged backup: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 1500, `unchanged backup took ${elapsed} ms`);
  const suffix = key ? '.enc' : '';
  assert.equal(fs.statSync(join(first, rel + suffix)).ino, fs.statSync(join(second, rel + suffix)).ino);
  assert.deepEqual(await verifyExternal(second, key || undefined), {});
});

test('encrypted manifests omit plaintext hashes on both fresh and linked copies', async (t) => {
  const { live, first, second, rel } = setup(t);
  const plaintextHash = await checksum(join(live, rel));
  await backupExternal(live, ['A'], first, undefined, 'key');
  await sign(first, 'key');
  assert.ok(!fs.readFileSync(join(first, 'backup.json'), 'utf8').includes(plaintextHash));
  // Legacy manifests may contain this field. Linking must not propagate it.
  const info = JSON.parse(fs.readFileSync(join(first, 'backup.json'), 'utf8'));
  info.external[rel].sourceSha256 = plaintextHash;
  fs.writeFileSync(join(first, 'backup.json'), JSON.stringify(info));
  await backupExternal(live, ['A'], second, first, 'key');
  const manifest = fs.readFileSync(join(second, 'backup.json'), 'utf8');
  assert.ok(!manifest.includes(plaintextHash));
  assert.ok(!manifest.includes('sourceSha256'));
  assert.equal(fs.statSync(join(first, rel + '.enc')).ino, fs.statSync(join(second, rel + '.enc')).ino);
});

for (const key of ['', 'key']) test(`a previous failed path check prevents reuse${key ? ' encrypted' : ''}`, async (t) => {
  const { live, first, second, rel } = setup(t);
  await backupExternal(live, ['A'], first, undefined, key);
  await sign(first, key);
  const infoPath = join(first, 'backup.json');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  info.verified = { files: { [rel]: 'changed on disk since it was taken' } };
  fs.writeFileSync(infoPath, JSON.stringify(info));

  await backupExternal(live, ['A'], second, first, key);
  const ext = key ? '.enc' : '';
  assert.notEqual(fs.statSync(join(first, rel + ext)).ino, fs.statSync(join(second, rel + ext)).ino);
  assert.deepEqual(await verifyExternal(second, key || undefined), {});
});

test('a missing plain container is reported as missing even if an encrypted decoy exists', async (t) => {
  const { live, first, rel } = setup(t);
  await backupExternal(live, ['A'], first);
  fs.renameSync(join(first, rel), join(first, rel + '.enc'));
  await assert.rejects(restoreExternal(first, live, ['A']), /Files\/A\/data: missing backup file/);
  assert.equal((await verifyExternal(first))[rel], 'missing');
  assert.equal(fs.readFileSync(join(live, rel), 'utf8'), 'original');
});

test('a container absent from the manifest cannot remove the corresponding live file', async (t) => {
  const { live, first } = setup(t);
  await backupExternal(live, ['A'], first);
  fs.writeFileSync(join(first, 'Files/A/unlisted'), 'unlisted backup');
  fs.writeFileSync(join(live, 'Files/A/unlisted'), 'keep live');
  await assert.rejects(restoreExternal(first, live, ['A']), /unlisted.*absent from backup.json/);
  assert.equal(fs.readFileSync(join(live, 'Files/A/unlisted'), 'utf8'), 'keep live');
});

test('container restore refuses a missing backup.json and preserves live data', async (t) => {
  const { live, first, rel } = setup(t);
  await backupExternal(live, ['A'], first);
  fs.rmSync(join(first, 'backup.json'));
  await assert.rejects(restoreExternal(first, live, ['A']), /unreadable manifest.*backup.json/);
  assert.equal(fs.readFileSync(join(live, rel), 'utf8'), 'original');
});
