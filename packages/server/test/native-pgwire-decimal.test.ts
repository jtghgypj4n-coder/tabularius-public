import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { PgServer } from '../src/pgwire.ts';

const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

// No imported fixtures: verify the decimal projection through the actual PostgreSQL wire protocol.
test('pgwire exposes native decimals as numeric values in WHERE, ORDER BY and SUM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-pg-decimal-'));
  const path = join(dir, 'Native.openhbam.sqlite');
  createStore(path, { mode: 'native' });
  const host = new Host(dir);
  let pg: PgServer | undefined;
  let socket: ReturnType<typeof connect> | undefined;
  try {
    const store = host.get('Native')!;
    store.applyDesign([{ op: 'createTable', name: 'Values', fields: [{ name: 'Price', type: 'decimal' }] }]);
    store.create('Values', { Price: '10' });
    store.create('Values', { Price: '9' });
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
    store.setPassword('Reader', 'pw', full.name);
    pg = new PgServer(host, { port: 0 });
    const port = await pg.listen();
    socket = connect(port, '127.0.0.1');
    let buffer = Buffer.alloc(0);
    let wake: (() => void) | undefined;
    socket.on('data', (chunk: Buffer) => { buffer = Buffer.concat([buffer, chunk]); wake?.(); });
    socket.on('close', () => wake?.());
    const read = async (): Promise<{ type: string; body: Buffer }> => {
      for (;;) {
        if (buffer.length >= 5 && buffer.length >= buffer.readInt32BE(1) + 1) {
          const end = buffer.readInt32BE(1) + 1;
          const message = { type: buffer.toString('ascii', 0, 1), body: buffer.subarray(5, end) };
          buffer = buffer.subarray(end);
          return message;
        }
        if (socket?.destroyed) throw new Error('pgwire connection closed');
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    };
    const send = (type: string, body: Buffer) => socket!.write(Buffer.concat([Buffer.from(type), i32(body.length + 4), body]));
    const params = Buffer.from('user\0Reader\0database\0Native\0\0');
    socket.write(Buffer.concat([i32(params.length + 8), i32(196608), params]));
    assert.equal((await read()).type, 'R');
    send('p', Buffer.from('pw\0'));
    while ((await read()).type !== 'Z') { /* authentication messages */ }
    send('Q', Buffer.from('SELECT Price FROM "Values" WHERE Price > 9 ORDER BY Price\0'));
    let oid: number | undefined;
    const rows: string[] = [];
    for (;;) {
      const message = await read();
      if (message.type === 'T') {
        const end = message.body.indexOf(0, 2);
        oid = message.body.readInt32BE(end + 7);
      }
      if (message.type === 'D') {
        const length = message.body.readInt32BE(2);
        rows.push(message.body.toString('utf8', 6, 6 + length));
      }
      if (message.type === 'E') assert.fail(message.body.toString());
      if (message.type === 'Z') break;
    }
    assert.equal(oid, 1700);
    assert.deepEqual(rows, ['10']);
    send('Q', Buffer.from('SELECT SUM(Price) FROM "Values"\0'));
    const sums: string[] = [];
    for (;;) {
      const message = await read();
      if (message.type === 'D') {
        const length = message.body.readInt32BE(2);
        sums.push(message.body.toString('utf8', 6, 6 + length));
      }
      if (message.type === 'E') assert.fail(message.body.toString());
      if (message.type === 'Z') break;
    }
    assert.deepEqual(sums, ['19']);
  } finally {
    socket?.destroy();
    pg?.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
