import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Admin } from '../src/admin.ts';
import { Host } from '../src/host.ts';
import type { DataApi } from '../src/dataapi.ts';
import { ServerLogs } from '../src/server-logs.ts';
import { addressBucket, hashPassword } from '../../store/src/index.ts';

type Denied = { status: number; message: string; retryAfter?: number } | null;
const password = ['admin', 'correct'].join(' ');
const wrong = ['attempted', 'private', 'password'].join(' ');
const hash = hashPassword(password);
const address = '2001:db8:1:2::1';
const bucket = addressBucket(address);
const third = `Admin password — 3 wrong attempts from ${bucket}`;
const locked = `Admin password — too many wrong attempts; sign-in from ${bucket} is locked for 15 minutes`;
const miss = { status: 401, message: 'Wrong admin password' };
const blocked = { status: 429, message: 'Too many failed attempts. Try again in 900 seconds.', retryAfter: 900 };

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-failed-login-'));
  const host = new Host(dir);
  const logs = host.logs = new ServerLogs(dir);
  const admin = new Admin(host, {} as DataApi) as unknown as {
    tryPassword(from: string, password: string, hash: string): Denied;
    checkBasicCredentials(req: IncomingMessage, hash: string): Denied;
    noteMiss(ip: string, rec: { count: number; first: number; until: number }): void;
    failures: Map<string, { count: number; first: number; until: number }>;
    failureOverflowUntil: number;
  };
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  t.after(async () => { logs.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const entries = async () => {
    await logs.flush();
    const { entries } = await logs.read('Event');
    for (const entry of entries) {
      assert.equal(entry.type, 'Warning');
      assert.ok(!entry.message.includes(wrong));
      assert.ok(!entry.message.includes(password));
      assert.ok(!entry.message.includes(Buffer.from(`admin:${wrong}`).toString('base64')));
    }
    return entries.map(e => e.message).reverse();
  };
  return { admin, entries, now: () => now, advance: () => { now += 15 * 60_000; } };
}

for (const basic of [false, true]) {
  test(`${basic ? 'Basic' : 'console'} password misses log only the third attempt and lockout, preserving responses`, async (t) => {
    const { admin, entries } = setup(t);
    const attempt = () => basic
      ? admin.checkBasicCredentials({ headers: { authorization: `Basic ${Buffer.from(`admin:${wrong}`).toString('base64')}` }, socket: { remoteAddress: address } } as IncomingMessage, hash)
      : admin.tryPassword(address, wrong, hash);
    for (let i = 1; i <= 4; i++) {
      assert.deepEqual(attempt(), miss);
      assert.deepEqual(await entries(), i < 3 ? [] : [third]);
    }
    assert.deepEqual(attempt(), blocked);
    assert.deepEqual(await entries(), [third, locked]);
    for (let i = 0; i < 10; i++) assert.deepEqual(attempt(), blocked);
    assert.deepEqual(await entries(), [third, locked]);
  });
}

test('a correct password silently clears misses and lets a new count reach three', async (t) => {
  const { admin, entries } = setup(t);
  for (let i = 0; i < 3; i++) assert.deepEqual(admin.tryPassword(address, wrong, hash), miss);
  assert.deepEqual(await entries(), [third]);
  assert.equal(admin.tryPassword(address, password, hash), null);
  assert.equal(admin.failures.size, 0);
  assert.deepEqual(await entries(), [third]);
  for (let i = 1; i <= 3; i++) {
    assert.deepEqual(admin.tryPassword(address, wrong, hash), miss);
    assert.deepEqual(await entries(), i < 3 ? [third] : [third, third]);
  }
});

test('expired windows start a new count and wall-clock edits do not reset it', async (t) => {
  const { admin, entries, advance } = setup(t);
  for (let i = 0; i < 3; i++) admin.tryPassword(address, wrong, hash);
  t.mock.method(Date, 'now', () => 0);
  assert.deepEqual(admin.tryPassword(address, wrong, hash), miss);
  assert.deepEqual(await entries(), [third]);
  advance();
  for (let i = 1; i <= 5; i++) {
    assert.deepEqual(admin.tryPassword(address, wrong, hash), i < 5 ? miss : blocked);
  }
  assert.deepEqual(await entries(), [third, third, locked]);
  advance();
  assert.equal(admin.tryPassword(address, password, hash), null);
});

test('a saturated lock table logs once per overflow cooldown and stays bounded', async (t) => {
  const { admin, entries, now, advance } = setup(t);
  const fill = () => {
    for (let i = 0; i < 5000; i++) admin.failures.set(`2001:db8:${i.toString(16)}::/64`, { count: 5, first: now(), until: now() + 900_000 });
    admin.noteMiss(bucket, { count: 5, first: now(), until: now() + 900_000 });
  };
  fill();
  assert.equal(admin.failures.size, 5000);
  assert.equal(admin.failureOverflowUntil, now() + 900_000);
  const message = 'Admin password — too many locked addresses; new sign-ins are locked for 15 minutes';
  assert.deepEqual(await entries(), [message]);
  admin.noteMiss(bucket, { count: 5, first: now(), until: now() + 900_000 });
  assert.deepEqual(admin.tryPassword(address, password, hash), blocked);
  assert.deepEqual(await entries(), [message]);
  advance();
  fill();
  assert.equal(admin.failures.size, 5000);
  assert.deepEqual(await entries(), [message, message]);
});
