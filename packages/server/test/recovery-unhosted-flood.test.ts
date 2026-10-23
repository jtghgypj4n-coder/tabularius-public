// A recovery-code request for a file that is not hosted costs a full set of hashes (so the time does not say which files
// exist). That cost is charged to the caller's address first, so a flood is refused cheaply once the address is locked out.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { createStore, LOCKOUT } from '../../store/src/index.ts';

test('a flood of recovery codes for a file that is not hosted is refused without hashing once the address is locked out', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-recovery-unhosted-'));
  createStore(join(dir, 'Charts.openhbam.sqlite'));
  const s = await serve({ dir, port: 0, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1', '::1'] });
  const jobs = t.mock.method(crypto, 'scrypt', ((_p: unknown, _s: unknown, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    queueMicrotask(() => callback(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(async () => { jobs.mock.restore(); syncBuiltinESMExports(); await new Promise<void>((r) => s.server.close(() => r())); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  const ask = async (db: string, account: string, from = '203.0.113.77') => {
    const r = await fetch(`${s.url}/fmi/data/vLatest/databases/${db}/sessions/recovery`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ account, code: 'abcd-efgh-ijkl' }),
    });
    return { status: r.status, retry: r.headers.get('retry-after'), body: await r.text() };
  };
  const flood = Array.from({ length: LOCKOUT.addressAttempts + 10 }, (_, i) => `who${i}`);
  const answers = [];
  for (const account of flood) answers.push(await ask('Nope', account));
  assert.ok(answers.every((a) => a.status === 401));
  assert.ok(jobs.mock.callCount() <= LOCKOUT.addressAttempts * 10, `${jobs.mock.callCount()} hash jobs for ${LOCKOUT.addressAttempts} allowed attempts`);
  const after = jobs.mock.callCount();
  const blocked = await ask('Nope', 'later');
  assert.equal(blocked.status, 401);
  assert.ok(Number(blocked.retry) > 0, 'refused with Retry-After, as a hosted file refuses a locked-out address');
  assert.equal(jobs.mock.callCount(), after, 'no hashing once locked out');
  // A hosted file locks the same address after the same number of requests.
  const lockedAfter = async (db: string, from: string) => {
    for (let n = 1; n <= LOCKOUT.addressAttempts + 10; n++) if ((await ask(db, `who${n}`, from)).retry) return n;
    return undefined;
  };
  assert.equal(await lockedAfter('Charts', '203.0.113.78'), await lockedAfter('Nope', '203.0.113.79'));
});
