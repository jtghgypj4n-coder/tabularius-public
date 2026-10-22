import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type Socket } from 'node:net';
import { Host } from '../src/host.ts';
import { PgServer } from '../src/pgwire.ts';
import { createStore, LOCKOUT } from '../../store/src/index.ts';

function login(port: number, name: string, password: string): Promise<{ code: string; message: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let buffer = Buffer.alloc(0), sent = false;
    socket.on('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('synthetic pgwire login timed out')));
    socket.on('connect', () => {
      const params = Buffer.from(`user\0${name}\0database\0Synthetic\0\0`), header = Buffer.alloc(8);
      header.writeInt32BE(8 + params.length); header.writeInt32BE(196608, 4);
      socket.write(Buffer.concat([header, params]));
    });
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 5 && buffer.length >= buffer.readInt32BE(1) + 1) {
        const type = String.fromCharCode(buffer[0]), length = buffer.readInt32BE(1), body = buffer.subarray(5, length + 1);
        buffer = buffer.subarray(length + 1);
        if (type === 'R' && body.readInt32BE(0) === 3 && !sent) {
          sent = true;
          const pw = Buffer.from(password + '\0'), header = Buffer.alloc(5);
          header.write('p'); header.writeInt32BE(4 + pw.length, 1);
          socket.write(Buffer.concat([header, pw]));
        } else if (type === 'E') {
          const fields = body.toString().split('\0');
          resolve({ code: fields.find(f => f.startsWith('C'))!.slice(1), message: fields.find(f => f.startsWith('M'))!.slice(1) });
          socket.destroy();
        } else if (type === 'Z') {
          resolve({ code: 'OK', message: '' }); socket.destroy();
        }
      }
    });
    socket.on('close', () => reject(new Error('closed before authentication result')));
  });
}

test('pgwire shares file account/address budgets, resists parallel bursts, and has locked-name parity', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-lockout-'));
  createStore(join(dir, 'Synthetic.openhbam.sqlite'));
  const host = new Host(dir), pg = new PgServer(host, { port: 0 });
  const store = host.get('Synthetic')!;
  const full = store.privilegeSets().find(p => p.name === '[Full Access]')!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmxdbc', 'fmrest', 'fmapp', 'fmodata', 'fmmcp'])] });
  store.setPassword('Alice', 'correct', '[Full Access]');
  const ctl = { from: '198.51.100.8' };
  t.mock.method(pg, 'isLocal', (socket: Socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: ctl.from, configurable: true });
    return true; // real loopback sockets; inject the address after the TLS/local guard
  });
  const port = await pg.listen();
  t.after(async () => { pg.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  // Mixed synchronous API-side failures and PostgreSQL sign-ins reach the same threshold.
  for (let i = 0; i < LOCKOUT.attempts - 1; i++) store.verify('Alice', 'wrong', ctl.from);
  assert.equal((await login(port, 'ALICE', 'wrong')).code, '28P01');
  assert.ok(store.lockedOut('Alice', ctl.from));
  // A locked account is refused with the wrong-password text: the surface does not reveal lockout state.
  assert.deepEqual(await login(port, 'Alice', 'correct'), { code: '28P01', message: 'password authentication failed for user "Alice"' });
  ctl.from = '198.51.100.7';
  assert.equal((await login(port, 'Alice', 'correct')).code, 'OK');
  ctl.from = '198.51.100.8';
  store.unlock('Alice');
  const burst = await Promise.all(Array.from({ length: LOCKOUT.attempts + 2 }, () => login(port, 'Alice', 'wrong')));
  assert.ok(burst.every(r => r.code === '28P01'));
  assert.ok(store.lockedOut('Alice', ctl.from));
  for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(ctl.from);
  const times: number[][] = [[], []];
  let baseline: Awaited<ReturnType<typeof login>> | undefined;
  for (let i = 0; i < 5; i++) for (const j of i % 2 ? [1, 0] : [0, 1]) {
    const start = performance.now(), raw = await login(port, j ? 'Ghost' : 'Alice', 'wrong');
    // The text names the typed account, which the caller supplied.
    const result = { ...raw, message: raw.message.replace(/"[^"]*"/, '"NAME"') };
    times[j].push(performance.now() - start);
    if (!baseline) baseline = result;
    assert.deepEqual(result, baseline, 'same SQLSTATE and message for locked known/unknown accounts');
  }
  const median = (a: number[]) => a.sort((a, b) => a - b)[2];
  const a = median(times[0]), b = median(times[1]);
  assert.ok(Math.max(a, b) <= 3 * Math.min(a, b) + 100, `3x + 100 ms timing headroom: ${a.toFixed(1)} / ${b.toFixed(1)} ms; samples: ${JSON.stringify(times)}`);
  assert.equal(store.unlockAddress('::ffff:c633:6408'), true);
  store.unlock('Alice');
  assert.equal((await login(port, 'Alice', 'correct')).code, 'OK');
  const verify = store.verifyAsync.bind(store);
  t.mock.method(store, 'verifyAsync', (account: string, password: string, from = '') => {
    const pending = verify(account, password, from);
    for (let i = 0; i < LOCKOUT.addressAttempts; i++) store.countAddressFailure(from);
    return pending;
  });
  assert.equal((await login(port, 'Alice', 'correct')).code, '28P01', 'no authenticated pgwire session after the address locks during hashing');
});
