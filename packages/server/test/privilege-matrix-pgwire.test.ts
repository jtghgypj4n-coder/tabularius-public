import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';
import { SHAPES, openMatrix, snapshot, ACCOUNT } from './privilege-matrix.ts';

type Message = { type: string; body: Buffer };
// A bounded wire client: no driver dependency, closes on errors and test cleanup.
class Client {
  socket: Socket;
  buffer = Buffer.alloc(0);
  wake?: () => void;
  constructor(port: number) {
    this.socket = connect(port, '127.0.0.1');
    this.socket.on('data', (data) => { this.buffer = Buffer.concat([this.buffer, data]); this.wake?.(); });
    this.socket.on('close', () => this.wake?.());
    this.socket.on('error', () => this.wake?.());
    this.socket.setTimeout(10_000, () => this.socket.destroy());
  }
  send(type: string, body = Buffer.alloc(0)) {
    const head = Buffer.alloc(5);
    head.write(type); head.writeInt32BE(body.length + 4, 1);
    this.socket.write(Buffer.concat([head, body]));
  }
  async read(): Promise<Message> {
    while (this.buffer.length < 5 || this.buffer.length < this.buffer.readInt32BE(1) + 1) {
      if (this.socket.destroyed) throw new Error('pgwire connection closed before response');
      await new Promise<void>((resolve) => { this.wake = resolve; });
    }
    const size = this.buffer.readInt32BE(1) + 1;
    const message = { type: this.buffer.toString('ascii', 0, 1), body: this.buffer.subarray(5, size) };
    this.buffer = this.buffer.subarray(size);
    return message;
  }
  async untilReady(stopOnError = false): Promise<Message[]> {
    const messages: Message[] = [];
    for (;;) {
      const message = await this.read(); messages.push(message);
      if (message.type === 'Z' || stopOnError && message.type === 'E') return messages;
    }
  }
  async login(password = 'matrix-password') {
    const params = Buffer.from(`user\0${ACCOUNT}\0database\0Matrix\0\0`);
    const head = Buffer.alloc(8); head.writeInt32BE(params.length + 8); head.writeInt32BE(196608, 4);
    this.socket.write(Buffer.concat([head, params]));
    const challenge = await this.read();
    if (challenge.type === 'E') return [challenge];
    assert.equal(challenge.type, 'R'); assert.equal(challenge.body.readInt32BE(), 3);
    this.send('p', Buffer.from(password + '\0'));
    return this.untilReady(true);
  }
  async query(sql: string, extended = false) {
    if (!extended) this.send('Q', Buffer.from(sql + '\0'));
    else {
      this.send('P', Buffer.concat([Buffer.from(`\0${sql}\0`), Buffer.alloc(2)]));
      this.send('B', Buffer.alloc(8)); // unnamed portal/statement, no parameters or format overrides
      this.send('E', Buffer.alloc(5));
      this.send('S');
    }
    return this.untilReady();
  }
}
const sqlstate = (messages: Message[]) => messages.find((m) => m.type === 'E')?.body.toString().split('\0').find((f) => f.startsWith('C'))?.slice(1) ?? '00000';

for (const row of SHAPES) test(`pgwire matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row, true);
  const client = new Client(m.sqlPort);
  try {
    const e = row.expected;
    const gate = ['locked', 'inactive'].includes(e.account) ? '28P01' : e.account === 'expired' ? '28000'
      : !e.sql || !e.view || e.field === 'none' || e.limited ? '42501' : '00000';
    const messages = await client.login();
    assert.equal(sqlstate(messages), gate, JSON.stringify(messages));
    await t.test('API tokens are not PostgreSQL passwords', async () => {
      const tokenClient = new Client(m.sqlPort);
      try { assert.equal(sqlstate(await tokenClient.login(m.apiToken)), '28P01'); }
      finally { tokenClient.socket.destroy(); }
    });
    if (gate !== '00000') return; // No wire session is established; no query can be submitted.
    const before = snapshot(m.store);
    for (const [sql, want] of [
      ['SELECT Name FROM Items', '00000'],
      ['SELECT table_name FROM information_schema.tables', '00000'],
      ["INSERT INTO Items (Name) VALUES ('changed')", '25006'],
      ["UPDATE Items SET Name = 'changed'", '25006'],
      ['DELETE FROM Items', '25006'],
    ]) for (const extended of [false, true]) await t.test(`${extended ? 'extended' : 'simple'}: ${sql}`, async () => {
      const reply = await client.query(sql, extended);
      assert.equal(sqlstate(reply), want, JSON.stringify(reply));
      if (sql === 'SELECT Name FROM Items') assert.equal(reply.filter((m) => m.type === 'D').length, 2);
      assert.deepEqual(snapshot(m.store), before);
    });
  } finally { client.socket.destroy(); await m.close(); }
});

test('pgwire rechecks password expiry when the policy or password date changes on an open session', async () => {
  const m = await openMatrix(SHAPES[0], true);
  const client = new Client(m.sqlPort);
  try {
    assert.equal(sqlstate(await client.login()), '00000');
    m.store.sql.prepare('UPDATE _fm_accounts SET password_changed = ? WHERE name = ?').run('2000-01-01T00:00:00.000Z', ACCOUNT);
    assert.equal(sqlstate(await client.query('SELECT Name FROM Items')), '00000', 'no expiry policy');
    m.store.setPasswordPolicy({ maxAgeDays: 1 });
    for (const extended of [false, true]) assert.equal(sqlstate(await client.query('SELECT Name FROM Items', extended)), '28000');
    m.store.setPasswordPolicy({});
    assert.equal(sqlstate(await client.query('SELECT Name FROM Items')), '00000', 'removing expiry policy restores access');
    m.store.setPasswordPolicy({ maxAgeDays: 1 });
    m.store.setPassword(ACCOUNT, 'matrix-password', 'Matrix', { mustChange: false });
    assert.equal(sqlstate(await client.query('SELECT Name FROM Items')), '00000', 'fresh password date restores access');
  } finally { client.socket.destroy(); await m.close(); }
});
