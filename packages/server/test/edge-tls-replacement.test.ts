import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecureContext } from 'node:tls';
import { generateKeyPairSync } from 'node:crypto';
import { localCertificate } from '../src/local-tls.ts';
import { AutoTls } from '../src/acme.ts';

for (const mode of ['local', 'acme']) test(`AR-server-edge-04 ${mode}`, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pair-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const initial = localCertificate(dir, ['localhost']);
  const different = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  if (mode === 'local') {
    rmSync(join(dir, '.openhbam-tls/local/server.current'), { force: true });
    writeFileSync(join(dir, '.openhbam-tls/local/server.crt'), initial.cert);
    writeFileSync(join(dir, '.openhbam-tls/local/server.key'), different);
    const recovered = localCertificate(dir, ['localhost']);
    assert.doesNotThrow(() => createSecureContext(recovered));
    assert.equal(recovered.ca, initial.ca);
  } else {
    const tlsDir = join(dir, '.openhbam-tls');
    mkdirSync(tlsDir, { recursive: true });
    writeFileSync(join(tlsDir, 'localhost.key'), different);
    writeFileSync(join(tlsDir, 'localhost.crt'), initial.cert);
    const auto = new AutoTls(dir, { domains: ['localhost'], httpPort: 0, hostname: '127.0.0.1' });
    t.mock.method(auto, 'renew', async () => ({ ...initial, expires: Date.now() + 60 * 86_400_000 }));
    try {
      const recovered = await auto.start();
      assert.doesNotThrow(() => createSecureContext(recovered));
    } finally { auto.stop(); }
  }
});

for (const boundary of ['generation', 'pointer', 'published']) test(`AR-server-edge-04 ${boundary}`, async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFileSync, statSync } = await import('node:fs');
  const { readTlsPair, writeTlsPair } = await import('../src/tls-pair.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-atomic-tls-'));
  try {
    const old = localCertificate(dir, ['localhost']);
    const next = localCertificate(dir, ['localhost', '127.0.0.1']);
    const base = join(dir, '.openhbam-tls', 'test');
    const oldPath = writeTlsPair(base, old);
    const nextFile = join(dir, 'next.json');
    writeFileSync(nextFile, JSON.stringify(next), { mode: 0o600 });
    const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        const target = String(to);
        if ('${boundary}' === 'generation' && target.endsWith('.pem')) process.exit(71);
        if ('${boundary}' === 'pointer' && target.endsWith('.current')) throw Object.assign(new Error('injected'), { code: 'EIO' });
        rename(from, to);
        if ('${boundary}' === 'published' && target.endsWith('.current')) process.exit(71);
      };
      syncBuiltinESMExports();
      const { writeTlsPair } = await import('./packages/server/src/tls-pair.ts');
      try { writeTlsPair(process.argv[1], JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))); }
      catch (e) { if (e.code !== 'EIO') throw e; process.exit(71); }
    `, base, nextFile], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 71, child.stderr);
    const kept = readTlsPair(base)!;
    assert.doesNotThrow(() => createSecureContext(kept));
    assert.equal(kept.key, boundary === 'published' ? next.key : old.key);
    assert.doesNotThrow(() => createSecureContext({ cert: readFileSync(oldPath), key: readFileSync(oldPath) }));
    if (process.platform !== 'win32') assert.equal(statSync(oldPath).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-server-edge-04 names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tls-names-'));
  try {
    const first = localCertificate(dir, ['localhost']);
    const changed = localCertificate(dir, ['localhost', '127.0.0.1']);
    assert.equal(changed.renewed, true);
    assert.notEqual(changed.key, first.key);
    assert.equal(localCertificate(dir, ['localhost', '127.0.0.1']).renewed, false);
    writeFileSync(join(dir, '.openhbam-tls/local/names.json'), JSON.stringify(['localhost']));
    const restored = localCertificate(dir, ['localhost']);
    assert.equal(restored.renewed, true);
    assert.doesNotThrow(() => createSecureContext(restored));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
