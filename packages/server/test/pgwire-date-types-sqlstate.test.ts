// Synthetic stores only; no imported files or external clients.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, StoreError, type Store } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import * as pgwire from '../src/pgwire.ts';
import { BinaryFormatError, binaryParam, binaryValue } from '../src/pgbinary.ts';

const cstr = (s: string) => Buffer.from(s + '\0');
const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
type Message = { type: string; body: Buffer };
let dir: string;
let host: Host;
let store: Store;
let pg: pgwire.PgServer;
let port: number;
const sockets = new Set<Socket>();
const values = ['2024-02-29', '12:34:56.123456', '2024-02-29 12:34:56.123456', 'plain'];
const invalid = ['2023-02-29', '25:00:00', 'not a timestamp', 'unchanged'];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-types-'));
  createStore(join(dir, 'Generated.openhbam.sqlite'));
  host = new Host(dir);
  store = host.get('Generated')!;
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'd', type: 'date' }, { name: 't', type: 'time' },
    { name: 'ts', type: 'timestamp' }, { name: 'name', type: 'text' }, { name: 'c', type: 'container' },
  ] }, { op: 'createTable', name: 'Other', fields: [{ name: 'd', type: 'text' }] }]);
  // Raw synthetic values also exercise invalid text retained by an import.
  const insert = store.sql.prepare('INSERT INTO T (_fm_record_id, d, t, ts, name) VALUES (?, ?, ?, ?, ?)');
  insert.run(1, ...values);
  insert.run(2, ...invalid);
  insert.run(3, null, null, null, null);
  insert.run(4, '1999-12-31', '23:59:59.999999', '1999-12-31T23:59:59.999999', 'before epoch');
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Reader', 'pw', full.name);
  pg = new pgwire.PgServer(host, { port: 0 });
  port = await pg.listen();
});
after(async () => {
  for (const socket of sockets) socket.destroy();
  pg?.close();
  await host?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

class Client {
  private buf = Buffer.alloc(0);
  private wake?: () => void;
  readonly socket = connect(port, '127.0.0.1');
  constructor() {
    sockets.add(this.socket);
    this.socket.on('data', (b: Buffer) => { this.buf = Buffer.concat([this.buf, b]); this.wake?.(); });
    this.socket.on('error', () => this.wake?.());
    this.socket.on('close', () => this.wake?.());
  }
  async open() {
    const params = Buffer.from('user\0Reader\0database\0Generated\0\0');
    this.socket.write(Buffer.concat([i32(params.length + 8), i32(196608), params]));
    const auth = await this.read();
    assert.equal(auth.type, 'R');
    assert.equal(auth.body.readInt32BE(0), 3);
    this.send('p', cstr('pw'));
    assert.equal(errorCode(await this.until()), undefined);
    return this;
  }
  send(type: string, ...parts: Buffer[]) {
    const body = Buffer.concat(parts);
    this.socket.write(Buffer.concat([Buffer.from(type), i32(body.length + 4), body]));
  }
  async read(): Promise<Message> {
    for (;;) {
      if (this.buf.length >= 5 && this.buf.length >= this.buf.readInt32BE(1) + 1) {
        const end = this.buf.readInt32BE(1) + 1;
        const msg = { type: this.buf.toString('ascii', 0, 1), body: this.buf.subarray(5, end) };
        this.buf = this.buf.subarray(end);
        return msg;
      }
      if (this.socket.destroyed || this.socket.readableEnded) throw new Error('connection closed');
      await new Promise<void>((resolve) => { this.wake = resolve; });
    }
  }
  async until() {
    const msgs: Message[] = [];
    do { msgs.push(await this.read()); } while (msgs.at(-1)!.type !== 'Z');
    return msgs;
  }
  query(sql: string) { this.send('Q', cstr(sql)); return this.until(); }
  close() { this.socket.destroy(); sockets.delete(this.socket); }
}
function errorCode(msgs: Message[]) {
  return msgs.find((m) => m.type === 'E')?.body.toString().split('\0').find((f) => f.startsWith('C'))?.slice(1);
}
function description(msgs: Message[]) {
  assert.equal(errorCode(msgs), undefined);
  const body = msgs.find((m) => m.type === 'T')!.body;
  let pos = 2;
  return Array.from({ length: body.readInt16BE(0) }, () => {
    const end = body.indexOf(0, pos);
    const column = { oid: body.readInt32BE(end + 7), format: body.readInt16BE(end + 17) };
    pos = end + 19;
    return column;
  });
}
function rows(msgs: Message[], oids?: number[]) {
  return msgs.filter((m) => m.type === 'D').map(({ body }) => {
    let pos = 2;
    return Array.from({ length: body.readInt16BE(0) }, (_, i) => {
      const len = body.readInt32BE(pos);
      pos += 4;
      if (len < 0) return null;
      const b = body.subarray(pos, pos + len);
      pos += len;
      return oids ? binaryParam(b, oids[i]) : b.toString();
    });
  });
}

test('typed describe uses table and column origins without running the query', () => {
  const sql = "SELECT a.d AS renamed, a.t, a.ts, b.d, a.d || 'x', CAST(a.d AS TEXT), date(a.d), a.c FROM T a JOIN Other b";
  assert.deepEqual(store.describeTyped(sql), {
    names: ['renamed', 't', 'ts', 'd', "a.d || 'x'", 'CAST(a.d AS TEXT)', 'date(a.d)', 'c'],
    types: ['TEXT', 'TEXT', 'TEXT', 'TEXT', null, null, null, 'INTEGER'],
    fieldTypes: ['date', 'time', 'timestamp', 'text', null, null, null, 'container'],
  });
  assert.deepEqual(store.describe('SELECT d FROM T'), { names: ['d'], types: ['TEXT'] });
  store.defineQueryFunction('must_not_run', () => { throw new Error('describe ran the query'); });
  assert.deepEqual(store.describeTyped('SELECT d, must_not_run() FROM T WHERE name = ?').fieldTypes, ['date', null]);
});

test('simple RowDescription types direct temporal fields and preserves all text', { timeout: 10_000 }, async () => {
  const c = await new Client().open();
  try {
    const msgs = await c.query('SELECT d, t, ts, name FROM T ORDER BY _fm_record_id');
    assert.deepEqual(description(msgs).map((d) => d.oid), [1082, 1083, 1114, 25]);
    assert.deepEqual(rows(msgs), [values, invalid, [null, null, null, null], ['1999-12-31', '23:59:59.999999', '1999-12-31T23:59:59.999999', 'before epoch']]);
    assert.deepEqual(description(await c.query("SELECT d || 'x', CAST(d AS TEXT), date(d), c FROM T WHERE 0")).map((d) => d.oid), [25, 25, 25, 1700]);
    assert.deepEqual(description(await c.query('SELECT d AS renamed, t, ts, name FROM T WHERE 0')).map((d) => d.oid), [1082, 1083, 1114, 25]);
  } finally { c.close(); }
});

test('extended descriptions and binary rows agree; parameters keep client or cast types', { timeout: 10_000 }, async () => {
  const c = await new Client().open();
  try {
    c.send('P', cstr('typed'), cstr('SELECT d, t, ts, name FROM T ORDER BY _fm_record_id'), i16(0));
    c.send('D', Buffer.from('S'), cstr('typed'));
    c.send('S');
    const described = await c.until();
    const oids = [1082, 1083, 1114, 25];
    assert.deepEqual(description(described), oids.map((oid) => ({ oid, format: 0 })));
    // The row that holds text which is not a date cannot be sent in binary: the whole Execute is an error (22008), never NULL.
    c.send('B', cstr(''), cstr('typed'), i16(0), i16(0), i16(1), i16(1));
    c.send('D', Buffer.from('P'), cstr(''));
    c.send('E', cstr(''), i32(0));
    c.send('S');
    assert.equal(errorCode(await c.until()), '22008');
    // Without that row, the binary rows carry the same values as the text format.
    c.send('P', cstr('valid'), cstr("SELECT d, t, ts, name FROM T WHERE name IS NULL OR name <> 'unchanged' ORDER BY _fm_record_id"), i16(0));
    c.send('B', cstr(''), cstr('valid'), i16(0), i16(0), i16(1), i16(1));
    c.send('D', Buffer.from('P'), cstr(''));
    c.send('E', cstr(''), i32(0));
    c.send('S');
    const result = await c.until();
    assert.deepEqual(description(result), oids.map((oid) => ({ oid, format: 1 })));
    assert.deepEqual(rows(result, oids), [values, [null, null, null, null], ['1999-12-31', '23:59:59.999999', '1999-12-31 23:59:59.999999', 'before epoch']]);
    for (const [sql, given, expected] of [
      ['SELECT d FROM T WHERE d = $1', 25, 25],
      ['SELECT d FROM T WHERE d = $1::date', 0, 1082],
      ['SELECT d FROM T WHERE d = $1', 0, 25],
    ] as const) {
      c.send('P', cstr('param'), cstr(sql), i16(1), i32(given));
      c.send('D', Buffer.from('S'), cstr('param'));
      c.send('S');
      const msgs = await c.until();
      assert.equal(errorCode(msgs), undefined);
      assert.equal(msgs.find((m) => m.type === 't')!.body.readInt32BE(2), expected);
    }
  } finally { c.close(); }
});

test('catalog column types agree with temporal result types', { timeout: 10_000 }, async () => {
  const c = await new Client().open();
  try {
    const msgs = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'T' ORDER BY ordinal_position");
    assert.equal(errorCode(msgs), undefined);
    assert.deepEqual(rows(msgs), [['d', 'date'], ['t', 'time without time zone'], ['ts', 'timestamp without time zone'], ['name', 'text'], ['c', 'numeric']]);
  } finally { c.close(); }
});

test('temporal binary values round trip with microseconds on both sides of the epoch', () => {
  for (const [oid, texts] of [
    [1082, ['0001-01-01', '0099-12-31', '1900-03-01', '1999-12-31', '2000-01-01', '2000-02-29', '9999-12-31']],
    [1083, ['00:00:00', '00:00:00.000001', '12:34:56.123456', '23:59:59.999999']],
    [1114, ['0001-01-01 00:00:00', '1999-12-31 23:59:59.999999', '1999-12-31 23:59:59.5', '2000-01-01 00:00:00', '2024-02-29 12:34:56.123456', '9999-12-31 23:59:59.999999']],
  ] as const) for (const text of texts) {
    const b = binaryValue(text, oid)!;
    assert.equal(b.length, oid === 1082 ? 4 : 8, text);
    assert.equal(binaryParam(b, oid), text);
  }
  assert.equal(binaryValue('2000-01-01', 1082)!.readInt32BE(), 0);
  assert.equal(binaryValue('1999-12-31', 1082)!.readInt32BE(), -1);
  assert.equal(binaryValue('00:00:01', 1083)!.readBigInt64BE(), 1_000_000n);
  assert.equal(binaryValue('1999-12-31T23:59:59.999999', 1114)!.readBigInt64BE(), -1n);
  const normalized = store.normalize('2024-02-29 12:34:56.123456', 'timestamp', 'ISO');
  assert.equal(normalized, '2024-02-29T12:34:56.123456');
  assert.equal(binaryParam(binaryValue(normalized, 1114)!, 1114), '2024-02-29 12:34:56.123456');
});

test('invalid temporal text is an error in binary format, never NULL', () => {
  // 22007: not a date/time at all; 22008: well formed but out of range. Text format returns the stored text unchanged.
  for (const [oid, texts] of [
    [1082, [['', '22007'], ['2023-02-29', '22008'], ['1900-02-29', '22008'], ['2024-04-31', '22008'], ['2024-00-01', '22008'], ['2024-01-00', '22008'], ['03/09/2024', '22007'], ['2024-01-01junk', '22007']]],
    [1083, [['', '22007'], ['24:01:00', '22008'], ['25:00:00', '22008'], ['12:60:00', '22008'], ['12:00:60', '22008'], ['-01:00:00', '22007'], ['12:00', '22007'], ['12:00:00.1234567', '22007'], ['12:00:00Z', '22007']]],
    [1114, [['', '22007'], ['2023-02-29 12:00:00', '22008'], ['2024-01-01 25:00:00', '22008'], ['2024-01-01', '22007'], ['2024-01-01 12:00:00+01:00', '22007'], ['2024-01-01 12:00:00junk', '22007']]],
  ] as const) {
    assert.equal(binaryValue(null, oid), null);
    for (const [text, code] of texts) {
      assert.throws(() => binaryValue(text, oid), (e: unknown) => e instanceof BinaryFormatError && e.code === code, `${oid} ${JSON.stringify(text)}`);
    }
  }
});

test('StoreError SQLSTATE table is used on the wire, including the fallback', { timeout: 10_000 }, async (t) => {
  const expected = { 102: '42703', 106: '42P01', 200: '42501', 212: '28000', 301: '55P03', 812: '53000', 8310: '42000' };
  assert.deepEqual(pgwire.SQLSTATE_BY_STORE_CODE, expected);
  const c = await new Client().open();
  try {
    for (const [code, state] of Object.entries({ ...expected, 960: '42000' })) {
      const mock = t.mock.method(store, 'select', () => { throw new StoreError(Number(code), 'synthetic store error'); });
      try { assert.equal(errorCode(await c.query('SELECT d FROM T')), state, code); }
      finally { mock.mock.restore(); }
    }
  } finally { c.close(); }
});

test('missing table, missing column and denied privileges have specific SQLSTATEs', { timeout: 10_000 }, async () => {
  const c = await new Client().open();
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  try {
    for (const [sql, code] of [['SELECT * FROM missing_table', '42P01'], ['SELECT missing_column FROM T', '42703'], ['SELECT missing_function(d) FROM T', '42000']]) {
      assert.equal(errorCode(await c.query(sql)), code);
      c.send('P', cstr(''), cstr(sql), i16(0));
      c.send('S');
      assert.equal(errorCode(await c.until()), code);
      assert.equal(errorCode(await c.query('SELECT d FROM T')), undefined, 'connection recovers');
    }
    store.savePrivilegeSet({ ...full, extendedPrivileges: full.extendedPrivileges.filter((p) => p !== 'fmxdbc') });
    assert.equal(errorCode(await c.query('SELECT d FROM T')), '42501');
  } finally { store.savePrivilegeSet(full); c.close(); }
});
