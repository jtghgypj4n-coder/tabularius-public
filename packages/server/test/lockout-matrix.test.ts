import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCKOUT } from '../../store/src/index.ts';
import { setup, FROM, names, basic } from './lockout-matrix-helpers.ts';

test('attempts split across password routes accumulate in one account bucket', async (t) => {
  const s = await setup(t);
  for (let i = 0; i < LOCKOUT.attempts; i++) await (await s.routes[names[i]]('Alice')).text();
  assert.ok(s.store.lockedOut('Alice', FROM));
  assert.equal((await s.authorize('Alice', 'correct')).status, 401);
  assert.equal((await s.routes['Data API']('Alice', 'correct', '198.51.100.7')).status, 200);
});

test('parallel HTTP failures hold the threshold and admin account/address unlocks are audited', async (t) => {
  const s = await setup(t);
  await Promise.all(Array.from({ length: 8 }, async () => (await s.routes['Data API']('Alice')).text()));
  assert.ok(s.store.lockedOut('Alice', FROM));
  const unlock = (body: object) => s.json('/tabularius/admin/v1/accounts/unlock', { database: 'Synthetic', ...body }, { authorization: basic('any', 'console-secret'), 'x-tabularius-admin': '1' }, '198.51.100.99');
  assert.deepEqual(await (await unlock({ account: 'Alice' })).json(), { ok: true, cleared: true });
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) s.store.countAddressFailure(FROM);
  assert.deepEqual(await (await unlock({ address: '::ffff:c633:6408' })).json(), { ok: true, cleared: true });
  assert.deepEqual(await (await unlock({ address: FROM })).json(), { ok: true, cleared: false });
  const events = s.store.securityEvents({ kind: 'lockout-cleared' });
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.changes?.via === 'admin console'));
  assert.deepEqual(events.map(e => e.changes?.scope).sort(), ['account', 'address']);
  assert.equal((await s.routes['Data API']('Alice', 'correct')).status, 200);
});

test('HTTP cannot issue a session when another account locks the address during a correct password hash', async (t) => {
  const s = await setup(t);
  const verify = s.store.verifyAsync.bind(s.store);
  t.mock.method(s.store, 'verifyAsync', (account: string, password: string, from = '') => {
    const pending = verify(account, password, from);
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) s.store.countAddressFailure(from);
    return pending;
  });
  const r = await s.routes['Data API']('Alice', 'correct');
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.equal(body.response?.token, undefined);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
});

test('Data API secondary data-source credentials spend the target file budget', async (t) => {
  const s = await setup(t), other = s.host.create('Secondary');
  other.setPassword('Alice', 'correct', '[Full Access]');
  const login = (password: string) => s.json('/fmi/data/vLatest/databases/Synthetic/sessions', {
    fmDataSource: [{ database: 'Secondary', username: 'Alice', password }],
  }, { authorization: basic('Alice', 'correct') });
  for (let i = 0; i < LOCKOUT.attempts; i++) {
    const r = await login('wrong');
    assert.equal(r.status, 401);
    await r.text();
  }
  assert.ok(other.lockedOut('Alice', FROM));
  assert.equal(s.store.lockedOut('Alice', FROM), undefined);
  assert.equal((await login('correct')).status, 401);
  other.unlock('Alice');
  assert.equal((await login('correct')).status, 200);
});
