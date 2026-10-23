import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, StoreError, type Store, type Transaction } from '../../store/src/index.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';
import { Host } from '../src/host.ts';
import { PgServer } from '../src/pgwire.ts';
import { executeWrite, parseWrite, WRITE_LIMIT, WriteRefusal } from '../src/pgwrite.ts';

// SQL writes over the PostgreSQL port (--sql-writes): built inside each test, no fixtures, loopback only.

type Message = { type: string; body: Buffer };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const cstr = (s: string) => Buffer.from(s + '\0');

class Client {
  readonly socket: Socket;
  private buffer = Buffer.alloc(0);
  private wake?: () => void;
  constructor(port: number) {
    this.socket = connect(port, '127.0.0.1');
    this.socket.on('data', (d: Buffer) => { this.buffer = Buffer.concat([this.buffer, d]); this.wake?.(); });
    this.socket.on('close', () => this.wake?.());
    this.socket.on('error', () => this.wake?.());
    this.socket.setTimeout(10_000, () => this.socket.destroy());
  }
  send(type: string, body = Buffer.alloc(0)): void { this.socket.write(Buffer.concat([Buffer.from(type), i32(body.length + 4), body])); }
  async read(): Promise<Message> {
    while (this.buffer.length < 5 || this.buffer.length < this.buffer.readInt32BE(1) + 1) {
      if (this.socket.destroyed) throw new Error('connection closed');
      await new Promise<void>((resolve) => { this.wake = resolve; });
    }
    const end = this.buffer.readInt32BE(1) + 1;
    const m = { type: this.buffer.toString('ascii', 0, 1), body: this.buffer.subarray(5, end) };
    this.buffer = this.buffer.subarray(end);
    return m;
  }
  async untilReady(): Promise<Message[]> {
    const out: Message[] = [];
    for (;;) {
      const m = await this.read();
      out.push(m);
      if (m.type === 'Z') return out;
    }
  }
  /** Signs in; resolves to the startup messages (an error ends them). */
  async login(user: string, password = 'pw', database = 'Shop'): Promise<Message[]> {
    const params = Buffer.from(`user\0${user}\0database\0${database}\0\0`);
    this.socket.write(Buffer.concat([i32(params.length + 8), i32(196608), params]));
    const first = await this.read();
    if (first.type === 'E') return [first];
    assert.equal(first.type, 'R');
    this.send('p', cstr(password));
    const out: Message[] = [];
    for (;;) {
      const m = await this.read();
      out.push(m);
      if (m.type === 'Z' || m.type === 'E') return out;
    }
  }
  simple(sql: string): Promise<Message[]> {
    this.send('Q', cstr(sql));
    return this.untilReady();
  }
  /** Parse, Bind (text parameters), Execute and Sync of one statement. */
  extended(sql: string, params: (string | null)[] = [], opts: { max?: number; name?: string } = {}): Promise<Message[]> {
    this.parse(sql, opts.name ?? '');
    this.bind(params, opts.name ?? '');
    this.send('E', Buffer.concat([cstr(''), i32(opts.max ?? 0)]));
    this.send('S');
    return this.untilReady();
  }
  parse(sql: string, name = ''): void { this.send('P', Buffer.concat([cstr(name), cstr(sql), i16(0)])); }
  bind(params: (string | null)[], statement = ''): void {
    this.send('B', Buffer.concat([cstr(''), cstr(statement), i16(0), i16(params.length),
      ...params.map((p) => (p === null ? i32(-1) : Buffer.concat([i32(Buffer.byteLength(p)), Buffer.from(p)]))), i16(0)]));
  }
  close(): void { this.socket.destroy(); }
}

const field = (m: Message, letter: string) => m.body.toString('utf8').split('\0').find((f, i, all) => f.startsWith(letter) && all.indexOf(f) === i && f.length > 0)?.slice(1);
const errorOf = (messages: Message[]) => {
  const e = messages.find((m) => m.type === 'E');
  if (!e) return undefined;
  const parts = e.body.toString('utf8').split('\0');
  return { code: parts.find((p) => p.startsWith('C'))!.slice(1), message: parts.find((p) => p.startsWith('M'))!.slice(1), severity: parts.find((p) => p.startsWith('S'))!.slice(1) };
};
const tags = (messages: Message[]) => messages.filter((m) => m.type === 'C').map((m) => m.body.toString('utf8').replace(/\0$/, ''));
const rowsOf = (messages: Message[]): (string | null)[][] => messages.filter((m) => m.type === 'D').map((m) => {
  const n = m.body.readInt16BE(0);
  const row: (string | null)[] = [];
  let pos = 2;
  for (let i = 0; i < n; i++) {
    const len = m.body.readInt32BE(pos); pos += 4;
    row.push(len < 0 ? null : m.body.subarray(pos, pos + len).toString('utf8'));
    if (len > 0) pos += len;
  }
  return row;
});
const noticeCodes = (messages: Message[]) => messages.filter((m) => m.type === 'N').map((m) => field(m, 'C'));

const ALL = { view: true, edit: true, create: true, delete: true };
const sets: Record<string, Parameters<Store['savePrivilegeSet']>[0]> = {
  Editor: { name: 'Editor', records: ALL, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] },
  NoCreate: { name: 'NoCreate', records: { ...ALL, create: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] },
  NoEdit: { name: 'NoEdit', records: { ...ALL, edit: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] },
  NoDelete: { name: 'NoDelete', records: { ...ALL, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] },
  NameViewOnly: { name: 'NameViewOnly', records: { ...ALL, fields: { Name: 'viewOnly' } }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] },
  NoSql: { name: 'NoSql', records: ALL, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] },
};

interface Served {
  dir: string; host: Host; store: Store; pg: PgServer; port: number; close: () => Promise<void>;
  client: (user?: string) => Promise<Client>;
}

async function serveShop(writes: boolean): Promise<Served> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-writes-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'), { mode: 'native' });
  createStore(join(dir, 'Other.openhbam.sqlite'), { mode: 'native' });
  const host = new Host(dir);
  const clients: Client[] = [];
  let pg: PgServer | undefined;
  const close = async () => {
    for (const c of clients) c.close();
    pg?.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  };
  try {
    const store = host.get('Shop')!;
    store.setAiPolicy(false);
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [
        { name: 'Name' }, { name: 'Count', type: 'integer' },
        { name: 'Seq', type: 'integer', options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
        { name: 'Price', type: 'decimal' },
      ] },
      { op: 'createTable', name: 'Checked', fields: [
        { name: 'Req', options: { validation: { notEmpty: true, always: true, strict: true } } },
        { name: 'Code', options: { validation: { unique: true, always: true, strict: true } } },
        { name: 'Short', options: { validation: { maxLength: 3, always: true, strict: true } } },
      ] },
    ]);
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
    for (const set of Object.values(sets)) store.savePrivilegeSet(set);
    store.setPassword('Ann', 'pw', full.name);
    for (const set of Object.keys(sets)) store.setPassword(set, 'pw', set);
    pg = new PgServer(host, { port: 0, writes });
    const port = await pg.listen();
    return {
      dir, host, store, pg, port, close,
      client: async (user = 'Ann') => {
        const c = new Client(port);
        clients.push(c);
        const reply = await c.login(user);
        assert.equal(errorOf(reply), undefined, JSON.stringify(reply.map((m) => m.body.toString())));
        return c;
      },
    };
  } catch (e) { await close(); throw e; }
}

const names = (store: Store, table = 'Items') => (store.sql.prepare(`SELECT Name FROM "${table}" ORDER BY _fm_record_id`).all() as { Name: string }[]).map((r) => r.Name);
const count = (store: Store, table = 'Items') => Number((store.sql.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n);

test('with the switch off, every write is refused 25006 and the connection still says it is read-only', async () => {
  const s = await serveShop(false);
  try {
    const c = await s.client();
    for (const sql of ["INSERT INTO Items (Name) VALUES ('x')", "UPDATE Items SET Name = 'x'", 'DELETE FROM Items']) {
      for (const extended of [false, true]) {
        const reply = extended ? await c.extended(sql) : await c.simple(sql);
        assert.equal(errorOf(reply)?.code, '25006', sql);
      }
    }
    assert.match(errorOf(await c.simple("INSERT INTO Items (Name) VALUES ('x')"))!.message, /--sql-writes/);
    assert.equal(count(s.store), 0);
    const show = rowsOf(await c.simple('SHOW transaction_read_only'));
    assert.deepEqual(show, [['on']]);
    assert.deepEqual(rowsOf(await c.simple('SHOW default_transaction_read_only')), [['on']]);
    const begin = await c.simple('BEGIN');
    assert.ok(begin.some((m) => m.type === 'N'), 'BEGIN still warns that there is no storage transaction');
    await c.simple('ROLLBACK');
    // The startup message tells the client the same.
    const raw = new Client(s.port);
    const startup = await raw.login('Ann');
    assert.ok(startup.some((m) => m.type === 'S' && m.body.toString().includes('default_transaction_read_only\0on')));
    raw.close();
  } finally { await s.close(); }
});

test('with the switch on, the session says it can write', async () => {
  const s = await serveShop(true);
  try {
    const raw = new Client(s.port);
    const startup = await raw.login('Ann');
    assert.ok(startup.some((m) => m.type === 'S' && m.body.toString().includes('default_transaction_read_only\0off')));
    assert.deepEqual(rowsOf(await raw.simple('SHOW transaction_read_only')), [['off']]);
    assert.deepEqual(rowsOf(await raw.simple('SHOW default_transaction_read_only')), [['off']]);
    const begin = await raw.simple('BEGIN');
    assert.deepEqual(noticeCodes(begin), []);
    assert.deepEqual(noticeCodes(await raw.simple('COMMIT')), []);
    raw.close();
  } finally { await s.close(); }
});

test('INSERT: columns, several rows, DEFAULT VALUES, parameters, and the serial number is entered', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    assert.deepEqual(tags(await c.simple("INSERT INTO Items (Name, Count) VALUES ('a', 1)")), ['INSERT 0 1']);
    assert.deepEqual(tags(await c.simple("INSERT INTO Items (Name, Count) VALUES ('b', 2), ('c', 3 + 4)")), ['INSERT 0 2']);
    assert.deepEqual(tags(await c.simple('INSERT INTO Items DEFAULT VALUES')), ['INSERT 0 1']);
    assert.deepEqual(tags(await c.simple("INSERT INTO Items (Name, Count) VALUES ('d', DEFAULT)")), ['INSERT 0 1']);
    assert.deepEqual(tags(await c.extended('INSERT INTO Items (Name, Count) VALUES ($1, $2)', ['param', '41'])), ['INSERT 0 1']);
    const all = await c.simple('SELECT Name, Count, Seq FROM Items ORDER BY Seq');
    assert.deepEqual(rowsOf(all), [['a', '1', '1'], ['b', '2', '2'], ['c', '7', '3'], [null, null, '4'], ['d', null, '5'], ['param', '41', '6']]);
    const tail = await c.simple("INSERT INTO Items (Name) VALUES ('semi;colon''s -- not a comment') RETURNING Name, Seq");
    assert.deepEqual(rowsOf(tail), [["semi;colon's -- not a comment", '7']]);
  } finally { await s.close(); }
});

test('UPDATE and DELETE: WHERE with AND, OR, IN, BETWEEN and LIKE, arithmetic on a field, no WHERE touches every record', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    for (let i = 1; i <= 6; i++) await c.simple(`INSERT INTO Items (Name, Count) VALUES ('item${i}', ${i})`);
    assert.deepEqual(tags(await c.simple('UPDATE Items SET Count = Count + 10 WHERE Count BETWEEN 2 AND 3')), ['UPDATE 2']);
    assert.deepEqual(tags(await c.simple("UPDATE Items SET Name = 'hit' WHERE Count IN (1, 12) OR Name LIKE 'item6'")), ['UPDATE 3']);
    assert.deepEqual(tags(await c.simple("UPDATE Items SET Name = 'x' WHERE Count > 4 AND NOT (Name = 'hit')")), ['UPDATE 2']);
    assert.deepEqual(rowsOf(await c.simple('SELECT Name, Count FROM Items ORDER BY Count')), [['hit', '1'], ['item4', '4'], ['x', '5'], ['hit', '6'], ['hit', '12'], ['x', '13']]);
    assert.deepEqual(tags(await c.simple("UPDATE Items SET Name = 'all'")), ['UPDATE 6']);
    assert.deepEqual(names(s.store), Array(6).fill('all'));
    assert.deepEqual(tags(await c.simple('DELETE FROM Items WHERE Count < 5')), ['DELETE 2']);
    assert.deepEqual(tags(await c.simple('DELETE FROM Items')), ['DELETE 4']);
    assert.equal(count(s.store), 0);
    // A statement that matches nothing still answers its tag.
    assert.deepEqual(tags(await c.simple("UPDATE Items SET Name = 'none'")), ['UPDATE 0']);
  } finally { await s.close(); }
});

test('RETURNING gives back the stored rows: INSERT and UPDATE after the change, DELETE before it', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    const inserted = await c.simple("INSERT INTO Items (Name, Count) VALUES ('a', 1), ('b', 2) RETURNING *");
    assert.deepEqual(rowsOf(inserted), [['a', '1', '1', null], ['b', '2', '2', null]]);
    const cols = inserted.find((m) => m.type === 'T')!;
    assert.equal(cols.body.readInt16BE(0), 4);
    assert.deepEqual(rowsOf(await c.simple("UPDATE Items SET Count = Count * 2 WHERE Name = 'b' RETURNING Name, Count")), [['b', '4']]);
    assert.deepEqual(rowsOf(await c.simple('DELETE FROM Items WHERE Count = 1 RETURNING Seq, Name')), [['1', 'a']]);
    // Extended protocol: Describe of a write with RETURNING answers its columns, without a RETURNING, NoData; Execute runs once.
    c.parse('INSERT INTO Items (Name) VALUES ($1) RETURNING Name, Seq', 'ins');
    c.send('D', Buffer.concat([Buffer.from('S'), cstr('ins')]));
    c.parse('DELETE FROM Items WHERE Name = $1', 'del');
    c.send('D', Buffer.concat([Buffer.from('S'), cstr('del')]));
    c.send('S');
    const described = await c.untilReady();
    assert.deepEqual(described.filter((m) => ['T', 'n'].includes(m.type)).map((m) => m.type), ['T', 'n']);
    assert.equal(count(s.store), 1, 'Parse and Describe changed nothing');
    c.bind(['zed'], 'ins');
    c.send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
    c.send('E', Buffer.concat([cstr(''), i32(0)]));
    c.send('S');
    const ran = await c.untilReady();
    assert.deepEqual(rowsOf(ran), [['zed', '3']]);
    assert.deepEqual(tags(ran), ['INSERT 0 1']);
    assert.equal(count(s.store), 2, 'Execute ran the insert once');
  } finally { await s.close(); }
});

test('a portal over RETURNING rows is served from the buffered rows, the write runs once', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    c.parse("INSERT INTO Items (Name) VALUES ('a'), ('b'), ('c') RETURNING Name");
    c.bind([]);
    c.send('E', Buffer.concat([cstr(''), i32(2)]));
    c.send('E', Buffer.concat([cstr(''), i32(2)]));
    c.send('S');
    const reply = await c.untilReady();
    assert.deepEqual(rowsOf(reply), [['a'], ['b'], ['c']]);
    assert.ok(reply.some((m) => m.type === 's'), 'the first Execute stopped at its row limit');
    assert.deepEqual(tags(reply), ['INSERT 0 3']);
    assert.equal(count(s.store), 3);
  } finally { await s.close(); }
});

test('a multi-row INSERT with a bad row, and a failing second statement, leave nothing behind', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    // Required field empty in the third row.
    let e = errorOf(await c.simple("INSERT INTO Checked (Req, Code) VALUES ('a', '1'), ('b', '2'), ('', '3')"));
    assert.equal(e?.code, '23502', JSON.stringify(e));
    assert.match(e!.message, /^FileMaker \d+: /);
    assert.equal(count(s.store, 'Checked'), 0);
    // A value that breaks a length rule.
    e = errorOf(await c.simple("INSERT INTO Checked (Req, Short) VALUES ('a', 'ok'), ('b', 'much too long')"));
    assert.equal(e?.code, '23514', JSON.stringify(e));
    assert.equal(count(s.store, 'Checked'), 0);
    // Unique field repeated inside the statement.
    e = errorOf(await c.simple("INSERT INTO Checked (Req, Code) VALUES ('a', 'same'), ('b', 'same')"));
    assert.equal(e?.code, '23505', JSON.stringify(e));
    assert.equal(count(s.store, 'Checked'), 0);
    // A query of several writes is one unit.
    e = errorOf(await c.simple("INSERT INTO Checked (Req, Code) VALUES ('a', 'x'); INSERT INTO Checked (Req, Code) VALUES ('b', 'x')"));
    assert.equal(e?.code, '23505');
    assert.equal(count(s.store, 'Checked'), 0, 'the first statement was undone too');
    assert.deepEqual(tags(await c.simple("INSERT INTO Checked (Req, Code) VALUES ('a', 'x'); INSERT INTO Checked (Req, Code) VALUES ('b', 'y')")), ['INSERT 0 1', 'INSERT 0 1']);
    assert.equal(count(s.store, 'Checked'), 2);
    // An UPDATE that fails on a later record puts every earlier one back.
    e = errorOf(await c.simple("UPDATE Checked SET Code = 'z'"));
    assert.equal(e?.code, '23505');
    assert.deepEqual((s.store.sql.prepare('SELECT Code FROM "Checked" ORDER BY _fm_record_id').all() as { Code: string }[]).map((r) => r.Code), ['x', 'y']);
  } finally { await s.close(); }
});

test('the row cap on RETURNING fails 54000 and writes nothing; the 100,000 record limit fails 812 before anything is kept', async () => {
  const s = await serveShop(true);
  const saved = process.env.TABULARIUS_PGWIRE_MAX_ROWS;
  process.env.TABULARIUS_PGWIRE_MAX_ROWS = '2';
  try {
    const c = await s.client();
    const e = errorOf(await c.simple("INSERT INTO Items (Name) VALUES ('a'), ('b'), ('c') RETURNING Name"));
    assert.equal(e?.code, '54000', JSON.stringify(e));
    assert.equal(count(s.store), 0);
    // Without RETURNING the cap on result rows does not apply.
    assert.deepEqual(tags(await c.simple("INSERT INTO Items (Name) VALUES ('a'), ('b'), ('c')")), ['INSERT 0 3']);
    const u = errorOf(await c.simple("UPDATE Items SET Name = 'q' RETURNING Name"));
    assert.equal(u?.code, '54000');
    assert.deepEqual(names(s.store), ['a', 'b', 'c']);
  } finally {
    if (saved === undefined) delete process.env.TABULARIUS_PGWIRE_MAX_ROWS; else process.env.TABULARIUS_PGWIRE_MAX_ROWS = saved;
    await s.close();
  }
  // The planner with a stubbed limit stands in for 100,000 real records.
  const t = await serveShop(true);
  try {
    assert.equal(WRITE_LIMIT, 100_000);
    for (let i = 0; i < 5; i++) t.store.create('Items', { Name: `r${i}` });
    const tx: Transaction = { files: new Map() };
    const privileges = t.store.privileges('Ann');
    for (const sql of ["UPDATE Items SET Name = 'x'", 'DELETE FROM Items', "INSERT INTO Items (Name) VALUES ('a'), ('b'), ('c'), ('d')"]) {
      await assert.rejects(() => executeWrite(parseWrite(sql)!, t.store, privileges, [], 0, () => false, tx, 3), (e: unknown) => e instanceof StoreError && e.code === 812, sql);
    }
    assert.equal(count(t.store), 5, 'nothing was changed');
    assert.equal(tx.files.size, 0, 'nothing was held');
  } finally { await t.close(); }
});

test('privileges are checked when the statement runs, not when it is prepared', async () => {
  const s = await serveShop(true);
  try {
    s.store.create('Items', { Name: 'seed', Count: 1 });
    const cases: [string, string, string, number][] = [
      ['NoCreate', "INSERT INTO Items (Name) VALUES ('x')", '42501', 1],
      ['NoEdit', "UPDATE Items SET Name = 'x'", '42501', 1],
      ['NoDelete', 'DELETE FROM Items', '42501', 1],
      // A statement that matches no record is still refused.
      ['NoEdit', "UPDATE Items SET Name = 'x' WHERE Count = 99", '42501', 1],
      ['NoDelete', 'DELETE FROM Items WHERE Count = 99', '42501', 1],
      // A view-only field makes the statement fail even when other fields are writable.
      ['NameViewOnly', "INSERT INTO Items (Count, Name) VALUES (5, 'x')", '42501', 1],
      ['NameViewOnly', "UPDATE Items SET Count = 7, Name = 'x'", '42501', 1],
    ];
    for (const [user, sql, code, records] of cases) {
      const c = await s.client(user);
      for (const extended of [false, true]) {
        const reply = extended ? await c.extended(sql) : await c.simple(sql);
        assert.equal(errorOf(reply)?.code, code, `${user}: ${sql}`);
      }
      assert.equal(count(s.store), records, `${user}: ${sql}`);
      assert.deepEqual(names(s.store), ['seed']);
    }
    // The writable field of the same set still works.
    const c = await s.client('NameViewOnly');
    assert.deepEqual(tags(await c.simple('UPDATE Items SET Count = 7')), ['UPDATE 1']);
    // Prepared while the account could write; the privilege is taken away before it runs.
    const ann = await s.client('Editor');
    ann.parse("INSERT INTO Items (Name) VALUES ('late')", 'late');
    ann.send('S');
    await ann.untilReady();
    s.store.savePrivilegeSet({ ...(sets.Editor as object), name: 'Editor', records: { ...ALL, create: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'] });
    ann.bind([], 'late');
    ann.send('E', Buffer.concat([cstr(''), i32(0)]));
    ann.send('S');
    assert.equal(errorOf(await ann.untilReady())?.code, '42501');
    assert.equal(count(s.store), 1);
    // An account without fmxdbc cannot connect at all.
    const raw = new Client(s.port);
    assert.equal(errorOf(await raw.login('NoSql'))?.code, '42501');
    raw.close();
  } finally { await s.close(); }
});

test('transactions: ROLLBACK undoes, COMMIT keeps, reads see uncommitted rows, an error holds the block until its end', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    assert.deepEqual(tags(await c.simple('BEGIN')), ['BEGIN']);
    await c.simple("INSERT INTO Items (Name) VALUES ('a')");
    assert.deepEqual(rowsOf(await c.simple('SELECT Name FROM Items')), [['a']], 'a read in the transaction sees its own write');
    assert.equal(count(s.store), 1, 'held, not yet committed');
    assert.deepEqual(tags(await c.simple('ROLLBACK')), ['ROLLBACK']);
    assert.equal(count(s.store), 0);
    assert.deepEqual(rowsOf(await c.simple('SELECT Name FROM Items')), []);

    await c.simple('BEGIN');
    await c.simple("INSERT INTO Items (Name) VALUES ('kept')");
    await c.simple("UPDATE Items SET Name = 'kept2'");
    assert.deepEqual(tags(await c.simple('COMMIT')), ['COMMIT']);
    assert.deepEqual(names(s.store), ['kept2']);

    // An error inside BEGIN: 25P02 until the end, and COMMIT then answers ROLLBACK.
    await c.simple('BEGIN');
    await c.simple("INSERT INTO Checked (Req, Code) VALUES ('ok', '1')");
    assert.equal(errorOf(await c.simple("INSERT INTO Checked (Req, Code) VALUES ('', '2')"))?.code, '23502');
    assert.equal(errorOf(await c.simple('SELECT 1'))?.code, '25P02');
    assert.equal(errorOf(await c.simple("INSERT INTO Items (Name) VALUES ('no')"))?.code, '25P02');
    assert.deepEqual(tags(await c.simple('COMMIT')), ['ROLLBACK']);
    assert.equal(count(s.store, 'Checked'), 0);
    assert.deepEqual(names(s.store), ['kept2']);
    // The connection is usable again.
    assert.deepEqual(tags(await c.simple("INSERT INTO Items (Name) VALUES ('after')")), ['INSERT 0 1']);
  } finally { await s.close(); }
});

test('a connection that vanishes mid-transaction rolls back and releases the file; another session meanwhile gets 55P03', async () => {
  const s = await serveShop(true);
  try {
    const a = await s.client();
    const b = await s.client();
    await a.simple('BEGIN');
    await a.simple("INSERT INTO Items (Name) VALUES ('held')");
    // While A holds the file, B's write is refused as busy, and nothing of B's is made.
    assert.equal(errorOf(await b.simple("INSERT INTO Items (Name) VALUES ('b')"))?.code, '55P03');
    a.close();
    for (let i = 0; i < 200 && count(s.store) !== 0; i++) await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 200; i++) {
      const reply = await b.simple("INSERT INTO Items (Name) VALUES ('b')");
      if (!errorOf(reply)) break;
      assert.equal(errorOf(reply)?.code, '55P03');
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.deepEqual(names(s.store), ['b'], 'A\'s insert was rolled back, B\'s now goes through');
  } finally { await s.close(); }
});

test('closing the server rolls back what a connection holds', async () => {
  const s = await serveShop(true);
  try {
    const a = await s.client();
    await a.simple('BEGIN');
    await a.simple("INSERT INTO Items (Name) VALUES ('held')");
    s.pg.close();
    assert.equal(count(s.store), 0);
    s.store.create('Items', { Name: 'direct' });
    assert.deepEqual(names(s.store), ['direct'], 'the file is not held any more');
  } finally { await s.close(); }
});

test('a connection idle inside BEGIN is rolled back and closed with FATAL 25P03 (the clock is advanced, not waited for)', async () => {
  const s = await serveShop(true);
  const savedEnv = process.env.TABULARIUS_PGWIRE_TX_IDLE_MS;
  const realNow = monotonicClock.now;
  process.env.TABULARIUS_PGWIRE_TX_IDLE_MS = '40';
  let offset = 0;
  monotonicClock.now = () => realNow() + offset;
  try {
    const c = await s.client();
    await c.simple('BEGIN');
    await c.simple("INSERT INTO Items (Name) VALUES ('idle')");
    offset = 10_000;
    const m = await c.read();
    const e = errorOf([m]);
    assert.equal(e?.code, '25P03');
    assert.equal(e?.severity, 'FATAL');
    await assert.rejects(() => c.read(), /closed/);
    assert.equal(count(s.store), 0);
    // The file is free.
    s.store.create('Items', { Name: 'free' });
    // Outside BEGIN nothing is limited, and a transaction that is used does not time out.
    offset = 0;
    const d = await s.client();
    await d.simple('BEGIN');
    for (let i = 0; i < 3; i++) {
      offset += 30;
      await d.simple("INSERT INTO Items (Name) VALUES ('busy')");
    }
    assert.deepEqual(tags(await d.simple('COMMIT')), ['COMMIT']);
    process.env.TABULARIUS_PGWIRE_TX_IDLE_MS = '0';
    const f = await s.client();
    await f.simple('BEGIN');
    offset += 1_000_000;
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(tags(await f.simple('ROLLBACK')), ['ROLLBACK'], '0 means no limit');
  } finally {
    monotonicClock.now = realNow;
    if (savedEnv === undefined) delete process.env.TABULARIUS_PGWIRE_TX_IDLE_MS; else process.env.TABULARIUS_PGWIRE_TX_IDLE_MS = savedEnv;
    await s.close();
  }
});

test('shapes this connection does not take are refused with a reason and change nothing', async () => {
  const s = await serveShop(true);
  try {
    s.store.create('Items', { Name: 'seed', Count: 1 });
    const c = await s.client();
    const refused: [string, RegExp, string?][] = [
      ["UPDATE Items SET Name = upper(Name)", /functions are not supported/],
      ["INSERT INTO Items (Name) VALUES (upper('a'))", /functions are not supported/],
      ["UPDATE Items SET Name = (SELECT 'x')", /subqueries/],
      ["DELETE FROM Items WHERE Count IN (SELECT Count FROM Items)", /subqueries/],
      ['INSERT INTO Items (Name) SELECT Name FROM Items', /INSERT … SELECT/],
      ['UPDATE Items SET Name = 1 FROM Items i', /not supported/],
      ['DELETE FROM Items USING Items i', /join/],
      ["UPDATE Items SET Items.Name = 'x'", /qualified names/],
      ["UPDATE Items SET Name = 'x' WHERE Items.Count = 1", /qualified names/],
      ['UPDATE Items SET Name = NULL', /NULL/],
      ['UPDATE Items SET Name = DEFAULT', /DEFAULT/],
      ["INSERT INTO Items (Name, Count) VALUES ('a')", /2 columns but 1 value/],
      ["INSERT INTO Items VALUES ('a')", /list the columns/],
      ["UPDATE Items SET Name = 'x' WHERE Count = 1 AND", /ends with an operator/],
      ["UPDATE Items SET Name = 'x' WHERE (Count = 1", /unbalanced/],
      ["UPDATE Items SET Name = 'x' WHERE Count = 1)", /unbalanced/],
      ["UPDATE Items SET Name = 'a' || 'b'", /"\|" is not supported/],
      ['TRUNCATE Items', /SELECT, INSERT, UPDATE and DELETE only/],
      ['CREATE TABLE T (a int)', /SELECT, INSERT, UPDATE and DELETE only/],
      ['DROP TABLE Items', /SELECT, INSERT, UPDATE and DELETE only/],
    ];
    for (const [sql, message] of refused) {
      const e = errorOf(await c.simple(sql));
      assert.ok(e, sql);
      assert.match(e.message, message, sql);
    }
    // Name errors and field rules.
    assert.equal(errorOf(await c.simple("UPDATE Items SET Missing = 'x'"))?.message.includes('Field "Missing" is missing'), true);
    assert.equal(errorOf(await c.simple("INSERT INTO Missing (a) VALUES (1)"))?.code, '42000');
    const record = errorOf(await c.simple("UPDATE Items SET _fm_record_id = 9"));
    assert.equal(record?.code, '42501');
    assert.match(record!.message, /^FileMaker 201: /);
    assert.equal(errorOf(await c.simple('UPDATE Items SET Name = _fm_record_id'))?.code, '42501');
    assert.deepEqual(names(s.store), ['seed']);
    assert.equal(Number((s.store.sql.prepare('SELECT Count FROM "Items"').get() as { Count: number }).Count), 1);
  } finally { await s.close(); }
});

test('a table occurrence that belongs to another hosted file is refused before anything is read or written', async () => {
  const elsewhere = { occurrence: () => ({ name: 'Remote', table: 'Remote', owner: {}, fields: [] }) } as unknown as Store;
  const tx: Transaction = { files: new Map() };
  for (const sql of ["INSERT INTO Remote (a) VALUES (1)", "UPDATE Remote SET a = 1", 'DELETE FROM Remote']) {
    await assert.rejects(() => executeWrite(parseWrite(sql)!, elsewhere, {} as never, [], 0, () => false, tx), (e: unknown) => e instanceof WriteRefusal && /another hosted file/.test(e.message), sql);
  }
});

test('NULL and binary values are refused at execution, including from a parameter', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    const e = errorOf(await c.extended('INSERT INTO Items (Name) VALUES ($1)', [null]));
    assert.match(e!.message, /NULL value for Name/);
    assert.equal(count(s.store), 0);
    s.store.create('Items', { Name: 'seed' });
    assert.match(errorOf(await c.extended('UPDATE Items SET Name = $1', [null]))!.message, /NULL value for Name/);
    assert.deepEqual(names(s.store), ['seed']);
    // A parameter the statement names but the client did not send.
    assert.match(errorOf(await c.simple('INSERT INTO Items (Name) VALUES ($1)'))!.message, /\$1 but 0 parameters/);
  } finally { await s.close(); }
});

test('the audit log names the account and the sql surface for each write; a refused write adds none', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    await c.simple("INSERT INTO Items (Name) VALUES ('a')");
    await c.simple("UPDATE Items SET Name = 'b'");
    await c.simple('DELETE FROM Items');
    const entries = s.store.auditLog({ table: 'Items' }).filter((e) => ['create', 'update', 'delete'].includes(e.kind));
    assert.deepEqual(entries.map((e) => e.kind).sort(), ['create', 'delete', 'update']);
    for (const e of entries) {
      assert.equal(e.account, 'Ann');
      assert.equal(e.surface, 'sql');
    }
    const before = s.store.auditLog({ table: 'Items' }).length;
    const denied = await s.client('NoCreate');
    assert.equal(errorOf(await denied.simple("INSERT INTO Items (Name) VALUES ('x')"))?.code, '42501');
    assert.equal(s.store.auditLog({ table: 'Items' }).length, before);
  } finally { await s.close(); }
});

test('parseWrite on accepted and refused statements', () => {
  const plan = (sql: string) => parseWrite(sql);
  // Not writes.
  for (const sql of ['SELECT 1', 'WITH x AS (SELECT 1) SELECT * FROM x', 'BEGIN', 'TRUNCATE t', '']) assert.equal(plan(sql), undefined, sql);
  // Accepted forms.
  assert.deepEqual(plan('INSERT INTO t (a, "b c") VALUES (1, \'x\')')!.columns, ['a', 'b c']);
  assert.equal(plan('insert into T DEFAULT VALUES')!.rows!.length, 1);
  assert.deepEqual(plan('INSERT INTO t (a, b) VALUES (DEFAULT, $2), (1.5e3, -2)')!.rows![0][0], 'default');
  assert.equal(plan('INSERT INTO t (a, b) VALUES (DEFAULT, $2), (1.5e3, -2)')!.params, 2);
  assert.equal(plan('UPDATE t SET a = a + 1, b = 0x1F WHERE a BETWEEN 1 AND 2 AND NOT (b IS NULL)')!.set!.length, 2);
  assert.equal(plan('DELETE FROM t WHERE a LIKE \'%x\' ESCAPE \'\\\' OR a IN (1, 2)')!.kind, 'delete');
  assert.equal(plan('DELETE FROM t')!.where, undefined);
  assert.deepEqual(plan('UPDATE t SET a = 1 RETURNING a, b')!.returning, ['a', 'b']);
  assert.equal(plan('DELETE FROM t WHERE a = 1 RETURNING *')!.returning, '*');
  // Comments, quoted names, strings that hold keywords and semicolons are read as the SQL reads do.
  assert.equal(plan("UPDATE /* x */ \"My Table\" SET a = ';' -- tail\n WHERE b = 'WHERE; DELETE FROM x'")!.table, 'My Table');
  assert.deepEqual(plan("UPDATE t SET a = 'x; DROP TABLE t; --' ")!.set!.map((s) => s.field), ['a']);
  assert.equal(plan("UPDATE t SET a = E'it\\'s'")!.set!.length, 1);
  assert.equal(plan("INSERT INTO t (a) VALUES ('RETURNING * ) VALUES (')")!.rows!.length, 1);
  // Refused.
  const refused = [
    'INSERT INTO t VALUES (1)', 'INSERT INTO t (a) SELECT 1', 'INSERT INTO t (a, a) VALUES (1, 2)', 'INSERT INTO t (a) VALUES (1, 2)', 'INSERT INTO t (a) VALUES ()',
    'INSERT INTO t (a) VALUES (1) ON CONFLICT DO NOTHING', 'INSERT INTO t.u (a) VALUES (1)', 'INSERT INTO t (a) VALUES (f(1))', 'INSERT INTO t (a) VALUES (b)',
    'INSERT INTO t (a) VALUES (1); DELETE FROM t', 'INSERT INTO t (a) VALUES (1', 'INSERT INTO t (a) VALUES (1))', 'INSERT INTO t (_fm_record_id) VALUES (1)',
    'INSERT INTO t ("a(2)") VALUES (1)',
    'UPDATE t SET', 'UPDATE t SET a', 'UPDATE t SET a = 1,', 'UPDATE t SET a = 1, a = 2', 'UPDATE t SET a = DEFAULT', 'UPDATE t SET a = NULL', 'UPDATE t SET a = f(b)',
    'UPDATE t SET a = (SELECT 1)', 'UPDATE t SET a = 1 FROM u', 'UPDATE t SET a = 1 WHERE', 'UPDATE t SET (a, b) = (1, 2)', 'UPDATE t SET a = 1 WHERE a IN (SELECT 1)',
    'UPDATE t SET a = 1 WHERE t.a = 1', 'UPDATE t SET a::int = 1', 'UPDATE t SET a = b::int', 'UPDATE t SET a = 1 ORDER BY a', 'UPDATE t SET a = 1 LIMIT 1',
    'DELETE t', 'DELETE FROM t USING u', 'DELETE FROM t WHERE', 'DELETE FROM t WHERE (a = 1', 'DELETE FROM t LIMIT 1', 'DELETE FROM t RETURNING a AS b',
    'UPDATE t SET a = 1 RETURNING upper(a)', "UPDATE t SET a = 'unterminated",
  ];
  for (const sql of refused) {
    assert.throws(() => parseWrite(sql), (e: unknown) => e instanceof Error, sql);
  }
  assert.throws(() => parseWrite('UPDATE t SET a = f(1)'), WriteRefusal);
});

test('a write\'s condition on a native decimal compares numbers inside BEGIN too, so the same records match as outside it', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    await c.simple("INSERT INTO Items (Name, Price) VALUES ('ten', 10), ('nine-half', 9.5), ('big', 2000)");
    assert.deepEqual(rowsOf(await c.simple('SELECT Name FROM Items WHERE Price > 1000')), [['big']]);
    await c.simple('BEGIN');
    await c.simple("INSERT INTO Items (Name, Price) VALUES ('first', 1)");
    // The write's own condition and values are read as numbers whatever the connection holds.
    assert.deepEqual(rowsOf(await c.simple('DELETE FROM Items WHERE Price > 1000 RETURNING Name')), [['big']]);
    assert.deepEqual(tags(await c.simple('UPDATE Items SET Price = Price * 2 WHERE Price BETWEEN 9 AND 10.5')), ['UPDATE 2']);
    assert.deepEqual(tags(await c.simple('COMMIT')), ['COMMIT']);
    assert.deepEqual((s.store.sql.prepare('SELECT Name, Price FROM "Items" ORDER BY _fm_record_id').all() as { Name: string; Price: string }[]).map((r) => [r.Name, Number(r.Price)]),
      [['ten', 20], ['nine-half', 19], ['first', 1]]);
  } finally { await s.close(); }
});

test('<=, >=, <> and != are operators', async () => {
  const s = await serveShop(true);
  try {
    const c = await s.client();
    for (let i = 1; i <= 4; i++) await c.simple(`INSERT INTO Items (Name, Count) VALUES ('n${i}', ${i})`);
    assert.deepEqual(rowsOf(await c.simple('UPDATE Items SET Name = Name WHERE Count <= 1 RETURNING Count')), [['1']]);
    assert.deepEqual(rowsOf(await c.simple('UPDATE Items SET Name = Name WHERE Count >= 4 RETURNING Count')), [['4']]);
    assert.deepEqual(tags(await c.simple('UPDATE Items SET Name = Name WHERE Count <> 2')), ['UPDATE 3']);
    assert.deepEqual(tags(await c.simple('UPDATE Items SET Name = Name WHERE Count != 99')), ['UPDATE 4']);
    assert.deepEqual(tags(await c.simple('DELETE FROM Items WHERE Count < 2 OR Count > 3')), ['DELETE 2']);
    assert.match(errorOf(await c.simple('UPDATE Items SET Name = Name WHERE Count ! 1'))!.message, /"!" is not supported/);
    assert.ok(errorOf(await c.simple('UPDATE Items SET Name = Name WHERE Count < = 1')), 'a space inside the operator is not one');
  } finally { await s.close(); }
});

test('a transaction older than the maximum age is rolled back however busy the connection is', async () => {
  const s = await serveShop(true);
  const saved = { idle: process.env.TABULARIUS_PGWIRE_TX_IDLE_MS, max: process.env.TABULARIUS_PGWIRE_TX_MAX_MS };
  const realNow = monotonicClock.now;
  let offset = 0;
  monotonicClock.now = () => realNow() + offset;
  process.env.TABULARIUS_PGWIRE_TX_IDLE_MS = '0';
  // A limit far above the time the test itself takes, so a slow runner cannot reach it by waiting: only the clock offsets below do.
  process.env.TABULARIUS_PGWIRE_TX_MAX_MS = '60000';
  try {
    const c = await s.client();
    await c.simple('BEGIN');
    await c.simple("INSERT INTO Items (Name) VALUES ('held')");
    // Keeping the connection busy does not keep the file.
    for (let i = 0; i < 3; i++) { offset += 1000; await c.simple('SELECT 1'); }
    offset += 100_000;
    const e = errorOf([await c.read()]);
    assert.equal(e?.code, '25P03');
    assert.equal(e?.severity, 'FATAL');
    assert.match(e!.message, /open for more than/);
    assert.equal(count(s.store), 0);
    s.store.create('Items', { Name: 'free' });
  } finally {
    monotonicClock.now = realNow;
    for (const [key, name] of [['idle', 'TABULARIUS_PGWIRE_TX_IDLE_MS'], ['max', 'TABULARIUS_PGWIRE_TX_MAX_MS']] as const) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
    await s.close();
  }
});
