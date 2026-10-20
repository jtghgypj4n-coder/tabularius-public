import { test, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type Socket } from 'node:net';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { SignInFailures, addressBucket } from '../../store/src/sign-in-failures.ts';
import { createStore, LOCKOUT } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { PgServer } from '../src/pgwire.ts';

const limits = { ...LOCKOUT };
beforeEach(() => Object.assign(LOCKOUT, limits, { maxFailures: 64, sharedFailures: 8 }));
afterEach(() => Object.assign(LOCKOUT, limits));

function pgTry(port: number, user: string, database: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0);
    let sent = false;
    sock.on('error', reject);
    sock.setTimeout(10_000, () => sock.destroy(new Error('PostgreSQL sign-in timed out')));
    sock.on('connect', () => { const p = Buffer.from(`user\0${user}\0database\0${database}\0\0`); const h = Buffer.alloc(8); h.writeInt32BE(8 + p.length); h.writeInt32BE(196608, 4); sock.write(Buffer.concat([h, p])); });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 5 && buf.length >= buf.readInt32BE(1) + 1) {
        const type = String.fromCharCode(buf[0]); const len = buf.readInt32BE(1); const body = buf.subarray(5, len + 1); buf = buf.subarray(len + 1);
        if (type === 'R' && !sent) { sent = true; const pw = Buffer.from(password + '\0'); const m = Buffer.alloc(5); m.write('p'); m.writeInt32BE(4 + pw.length, 1); sock.write(Buffer.concat([m, pw])); }
        else if (type === 'E') { const fields = body.toString().split('\0'); resolve(fields.filter((f) => f.startsWith('C') || f.startsWith('M')).map((f) => f.slice(1)).join(' ')); sock.destroy(); return; }
      }
    });
    sock.on('close', () => resolve('closed'));
  });
}
async function pgSetup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-signin-availability-'));
  createStore(join(dir, 'Payroll.openhbam.sqlite'));
  const host = new Host(dir);
  const pg = new PgServer(host, { port: 0 });
  const store = host.get('Payroll')!;
  store.setPassword('Ann', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
  // Each connection gets the address queued for it (the sign-in path reads remoteAddress after isLocal).
  const ctl = { from: '198.51.100.1' };
  t.mock.method(pg, 'isLocal', (socket: Socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: ctl.from, configurable: true });
    return true;
  });
  // Exercise real sockets and accounting; password hashing is covered by pgwire.test.ts.
  const hashes = t.mock.method(crypto, 'scrypt', ((_password: unknown, _salt: unknown, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    queueMicrotask(() => callback(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(() => { hashes.mock.restore(); syncBuiltinESMExports(); });
  const port = await pg.listen();
  return { port, ctl, pg, store, hashes, close: async () => { pg.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const norm = (m: string) => m.replace(/"[^"]*"/g, '""');
async function pool<T>(n: number, conc: number, f: (i: number) => Promise<T>) { let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { const k = i++; await f(k); } })); }

test('hosted and unhosted lockouts both survive names beyond table capacity', async (t) => {
  const s = await pgSetup(t);
  try {
    const A = '198.51.100.10', B = '198.51.100.99';
    const lock = async (db: string) => { s.ctl.from = A; const out: string[] = []; for (let i = 0; i < LOCKOUT.attempts + 1; i++) out.push(norm(await pgTry(s.port, 'Ann', db, 'wrong'))); return out.at(-1); };
    const before = { hosted: await lock('Payroll'), unhosted: await lock('Payrol1') };
    s.ctl.from = B;
    await pool(LOCKOUT.maxFailures * 2, 2, (i) => pgTry(s.port, `spray${i}`, 'Payrol1', 'wrong'));
    await pool(LOCKOUT.maxFailures * 2, 2, (i) => pgTry(s.port, `spray${i}`, 'Payroll', 'wrong'));
    s.ctl.from = A;
    const after = { hosted: norm(await pgTry(s.port, 'Ann', 'Payroll', 'wrong')), unhosted: norm(await pgTry(s.port, 'Ann', 'Payrol1', 'wrong')) };
    assert.equal(before.hosted, before.unhosted);
    assert.match(after.unhosted, /password authentication failed/);
    assert.ok(s.store.lockedOut('Ann', A), 'the hosted lock survives unrelated names');
    assert.ok((s.pg as unknown as { unhostedFailures: SignInFailures }).unhostedFailures.lockedOut('payrol1\0ann\0' + A, A), 'the unhosted lock survives unrelated names');
    assert.equal(after.hosted, after.unhosted, 'eviction policy cannot reveal file existence');
  } finally { await s.close(); }
});

test('hosted and unhosted address lockouts match after distinct /64s fill the table', async (t) => {
  const s = await pgSetup(t);
  try {
    // Cross the reduced table limit through real PostgreSQL connections.
    for (let i = 0; i < LOCKOUT.maxFailures * 2; i++) { s.ctl.from = `2001:db8:1:${i.toString(16)}::1`; await pgTry(s.port, `f${i}`, 'Payrol1', 'wrong'); }
    const out: Record<string, string> = {};
    for (const [db, prefix] of [['Payroll', '2001:db8:2:1::'], ['Payrol1', '2001:db8:2:2::']] as const) {
      const msgs: string[] = [];
      s.ctl.from = prefix + '5';
      for (let i = 0; i < LOCKOUT.addressAttempts + 1; i++) msgs.push(norm(await pgTry(s.port, `n${i}`, db, 'wrong')));
      out[db] = msgs.at(-1)!;
    }
    assert.match(out.Payrol1, /password authentication failed/);
    assert.ok(s.store.addressLockedOut('2001:db8:2:1::5'));
    assert.ok((s.pg as unknown as { unhostedFailures: SignInFailures }).unhostedFailures.addressLockedOut('2001:db8:2:2::5'));
    assert.equal(out.Payroll, out.Payrol1, 'capacity cannot reveal file existence');
  } finally { await s.close(); }
});

test('PostgreSQL rotating /64s retain their budgets with only 52 slots free in either table', async (t) => {
  const s = await pgSetup(t);
  t.after(() => s.close());
  const tables = [
    ['Payroll', (s.store as unknown as { failures: SignInFailures }).failures],
    ['Payrol1', (s.pg as unknown as { unhostedFailures: SignInFailures }).unhostedFailures],
  ] as const;
  const now = Math.floor(performance.now());
  t.mock.method(performance, 'now', () => now);
  for (const [, table] of tables) for (let i = 0; i < LOCKOUT.maxFailures - 52; i++) {
    table.set(`locked${i}`, { count: LOCKOUT.attempts, first: now, until: now + LOCKOUT.lockMs });
  }
  for (let round = 0; round <= LOCKOUT.addressAttempts; round++) for (let i = 0; i < 30; i++) {
    s.ctl.from = `2001:db8:1:${i.toString(16)}::1`;
    const replies: string[] = [];
    for (const [database, table] of tables) {
      const before = s.hashes.mock.callCount();
      replies.push(norm(await pgTry(s.port, 'Ann', database, 'wrong')));
      assert.equal(s.hashes.mock.callCount() - before, 1, 'every refusal retains the same hash work');
      assert.equal(table.get(`\0address\0${addressBucket(s.ctl.from)}`)?.count, Math.min(round + 1, LOCKOUT.addressAttempts));
      assert.ok(table.size <= LOCKOUT.maxFailures);
      if (round >= LOCKOUT.addressAttempts - 1) assert.ok(table.addressLockedOut(s.ctl.from));
    }
    assert.match(replies[0], /^28P01 password authentication failed/);
    assert.equal(replies[0], replies[1], 'retained budgets do not reveal whether the file exists');
  }
});

test('PostgreSQL failure messages and password work hide independent table saturation, eviction and expiry', async (t) => {
  const s = await pgSetup(t);
  t.after(() => s.close());
  const hosted = (s.store as unknown as { failures: SignInFailures }).failures;
  const unhosted = (s.pg as unknown as { unhostedFailures: SignInFailures }).unhostedFailures;
  let now = Math.floor(performance.now());
  t.mock.method(performance, 'now', () => now);
  const fill = (table: SignInFailures) => {
    for (let i = table.size; i < LOCKOUT.maxFailures; i++) table.set(`filler${i}`, { count: 1, first: now });
    assert.equal(table.size, LOCKOUT.maxFailures);
  };
  const attempt = async (db: string, user = 'Ann') => {
    const before = s.hashes.mock.callCount();
    const reply = await pgTry(s.port, user, db, 'wrong');
    assert.equal(s.hashes.mock.callCount() - before, 1, 'every denial spends exactly one scrypt call');
    assert.match(reply, /^28P01 password authentication failed for user /);
    return norm(reply);
  };
  const compare = async (label: string) => {
    for (const user of ['Ann', 'made-up']) {
      assert.equal(await attempt('Payroll', user), await attempt('Payrol1', user), label);
    }
    assert.ok(hosted.size <= LOCKOUT.maxFailures && unhosted.size <= LOCKOUT.maxFailures);
  };
  // A real address spray, then generated live entries to reach capacity.
  s.ctl.from = '203.0.113.5';
  await pool(100, 2, (i) => pgTry(s.port, `user${i}`, `Missing${i}`, 'wrong'));
  assert.equal(unhosted.size, LOCKOUT.addressAttempts, 'a locked address admits no more names');
  fill(unhosted);
  s.ctl.from = '192.0.2.77';
  await compare('only the unhosted table is full');
  for (let i = 0; i <= LOCKOUT.attempts; i++) await attempt('Payrol1');
  assert.ok(unhosted.lockedOut(unhosted.accountKey('Ann', s.ctl.from, 'Payrol1'), s.ctl.from));
  await compare('only the unhosted account is locked');
  fill(hosted);
  await compare('both tables are full');
  for (let i = 0; i <= LOCKOUT.attempts; i++) await attempt('Payroll');
  assert.ok(s.store.lockedOut('Ann', s.ctl.from));
  // Force eviction on just one side: table state must never become a file-existence oracle.
  for (let i = 0; i < LOCKOUT.maxFailures; i++) unhosted.record(unhosted.accountKey(`evict${i}`, '127.0.0.1', 'Missing'), '127.0.0.1', false);
  assert.ok(unhosted.lockedOut(unhosted.accountKey('Ann', s.ctl.from, 'Payrol1'), s.ctl.from), 'eviction preserves live locks');
  unhosted.delete(unhosted.accountKey('Ann', s.ctl.from, 'Payrol1'));
  await compare('only the hosted account remains locked after an explicit unlock');
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) hosted.countAddressFailure(s.ctl.from);
  await compare('only the hosted address is locked');
  now += LOCKOUT.lockMs + LOCKOUT.windowMs;
  await compare('expired tables start fresh');
  assert.equal(s.store.lockedOut('Ann', s.ctl.from), undefined);
  assert.equal(unhosted.lockedOut(unhosted.accountKey('Ann', s.ctl.from, 'Payrol1'), s.ctl.from), undefined);
  hosted.clear();
  unhosted.clear();
  fill(hosted);
  await compare('only the hosted table is full');
  for (const saturated of [hosted, unhosted]) {
    LOCKOUT.sharedFailures = 8;
    hosted.clear();
    unhosted.clear();
    s.ctl.from = 'unknown';
    for (let i = 0; i < LOCKOUT.sharedFailures * 2; i++) saturated.record(saturated.accountKey(`anon${i}`, 'unknown'), 'unknown', false);
    await compare('only one anonymous pool is full');
    hosted.clear();
    unhosted.clear();
    LOCKOUT.sharedFailures = 32;
    for (let i = 0; i < LOCKOUT.attempts; i++) saturated.record(saturated.accountKey('Ann', 'unknown', saturated === unhosted ? 'Payrol1' : undefined), 'unknown', false);
    await compare('only one anonymous account is locked');
    s.ctl.from = '192.0.2.77';
    hosted.clear();
    unhosted.clear();
    for (let i = 0; i < LOCKOUT.maxFailures; i++) saturated.set(`locked${i}`, { count: 5, first: now, until: now + LOCKOUT.lockMs });
    await compare('only one table is full of protected locks');
    hosted.clear();
    unhosted.clear();
    for (let i = 0; i < LOCKOUT.maxFailures; i++) saturated.countAddressFailure(`2001:db8:3:${i.toString(16)}::1`);
    const before = [...saturated];
    await compare('only one table is full of open address windows');
    assert.deepEqual([...saturated], before, 'capacity refusal preserves every live address budget');
  }
});
