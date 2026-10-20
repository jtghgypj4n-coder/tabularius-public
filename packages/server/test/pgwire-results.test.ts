// Generated data only: result limits must hold before rows reach either wire protocol.
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { maxRows, PgServer } from '../src/pgwire.ts';

const cstr = (s: string) => Buffer.from(s + '\0');
const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const testCap = 100;
const originalMaxRows = process.env.TABULARIUS_PGWIRE_MAX_ROWS;
beforeEach(() => { process.env.TABULARIUS_PGWIRE_MAX_ROWS = String(testCap); });
afterEach(() => {
  delete process.env.TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS;
  if (originalMaxRows === undefined) delete process.env.TABULARIUS_PGWIRE_MAX_ROWS;
  else process.env.TABULARIUS_PGWIRE_MAX_ROWS = originalMaxRows;
});
const sockets = new Set<Socket>();
let dir: string;
let host: Host;
let pg: PgServer;
let port: number;
let visited = 0;
let peak = { rss: 0, heapUsed: 0 };
function sample() {
  const m = process.memoryUsage();
  peak.rss = Math.max(peak.rss, m.rss);
  peak.heapUsed = Math.max(peak.heapUsed, m.heapUsed);
}
const query = 'SELECT A, B, C FROM Generated WHERE measure_row(_fm_record_id)';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-results-'));
  const path = join(dir, 'Generated.openhbam.sqlite');
  createStore(path);
  host = new Host(dir);
  const store = host.get('Generated')!;
  store.applyDesign([{ op: 'createTable', name: 'Generated', fields: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }]);
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  store.setPassword('Reader', 'pw', full.name);
  const db = new DatabaseSync(path);
  try {
    db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 1000000)
      INSERT INTO Generated (_fm_record_id, A, B, C)
      SELECT i, printf('%064d', i), printf('%096d', i), printf('%0128d', i) FROM n`);
  } finally { db.close(); }
  store.defineQueryFunction('measure_row', () => {
    if (++visited % 100 === 0) sample();
    return 1;
  });
  pg = new PgServer(host, { port: 0 });
  port = await pg.listen();
});
after(async () => {
  for (const s of sockets) s.destroy();
  pg?.close();
  await host?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Consume messages as they arrive; keeping the result in the client would skew memory checks.
class Client {
  private buf = Buffer.alloc(0);
  private wake?: () => void;
  readonly socket: Socket;
  constructor() {
    this.socket = connect(port, '127.0.0.1');
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
    assert.equal((await this.until()).error, undefined);
    return this;
  }
  send(type: string, ...body: Buffer[]) {
    const b = Buffer.concat(body);
    this.socket.write(Buffer.concat([Buffer.from(type), i32(b.length + 4), b]));
  }
  async read(): Promise<{ type: string; body: Buffer }> {
    for (;;) {
      if (this.buf.length >= 5 && this.buf.length >= this.buf.readInt32BE(1) + 1) {
        const end = this.buf.readInt32BE(1) + 1;
        const m = { type: this.buf.toString('ascii', 0, 1), body: this.buf.subarray(5, end) };
        this.buf = this.buf.subarray(end);
        return m;
      }
      if (this.socket.destroyed || this.socket.readableEnded) throw new Error('connection closed');
      await new Promise<void>((resolve) => { this.wake = resolve; });
    }
  }
  async until(firstRow?: number) {
    const out = { rows: 0, descriptions: 0, tags: [] as string[], error: undefined as string | undefined, code: undefined as string | undefined, suspended: false };
    for (;;) {
      const { type, body } = await this.read();
      if (type === 'D') {
        if (firstRow !== undefined) {
          assert.equal(body.readInt16BE(0), 3);
          let pos = 2;
          for (const width of [64, 96, 128]) {
            assert.equal(body.readInt32BE(pos), width);
            pos += 4;
            assert.equal(body.toString('utf8', pos, pos + width), String(firstRow + out.rows).padStart(width, '0'));
            pos += width;
          }
        }
        out.rows++;
      }
      if (type === 'T') out.descriptions++;
      if (type === 'C') out.tags.push(body.toString('utf8', 0, body.length - 1));
      if (type === 's') out.suspended = true;
      if (type === 'E') {
        const fields = body.toString().split('\0');
        out.error = fields.find((f) => f.startsWith('M'))?.slice(1);
        out.code = fields.find((f) => f.startsWith('C'))?.slice(1);
      }
      if (type === 'Z') return out;
    }
  }
  async query(sql: string, firstRow?: number) {
    this.send('Q', cstr(sql));
    return this.until(firstRow);
  }
  bind(sql: string) {
    this.send('P', cstr(''), cstr(sql), i16(0));
    this.send('B', cstr(''), cstr(''), i16(0), i16(0), i16(0));
  }
  execute(max: number) { this.send('E', cstr(''), i32(max)); this.send('S'); }
  close() { this.socket.destroy(); sockets.delete(this.socket); }
}

function refused(r: Awaited<ReturnType<Client['until']>>, cap = testCap) {
  assert.equal(r.code, '54000');
  assert.equal(r.error, `SQL results are limited to ${cap} rows; use LIMIT and page through the result with a stable ORDER BY`);
  assert.equal(r.rows, 0, 'no partial result');
  assert.deepEqual(r.tags, [], 'no successful completion');
}

test('the default cap is 100000 rows; the environment can raise or lower it, with invalid values falling back', () => {
  delete process.env.TABULARIUS_PGWIRE_MAX_ROWS;
  assert.equal(maxRows(), 100_000);
  for (const [value, expected] of [['200000', 200_000], ['2', 2], [' 123 ', 123], ['1e3', 1000], ['0', 0]] as const) {
    process.env.TABULARIUS_PGWIRE_MAX_ROWS = value;
    assert.equal(maxRows(), expected, value);
  }
  for (const value of ['', '   ', 'lots', '100abc', '1.5', 'NaN', 'Infinity', '-Infinity', '-1']) {
    process.env.TABULARIUS_PGWIRE_MAX_ROWS = value;
    assert.equal(maxRows(), 100_000, value);
  }
});

test('TABULARIUS_PGWIRE_MAX_ROWS=0 removes the cap, as TABULARIUS_DATA_API_MAX_LIMIT=0 does', async () => {
  const c = await new Client().open();
  try {
    const sql = `${query} ORDER BY _fm_record_id LIMIT 3`;
    process.env.TABULARIUS_PGWIRE_MAX_ROWS = '1';
    refused(await c.query(sql), 1);
    process.env.TABULARIUS_PGWIRE_MAX_ROWS = '0';
    const all = await c.query(sql, 1);
    assert.equal(all.error, undefined);
    assert.equal(all.rows, 3);
  } finally {
    delete process.env.TABULARIUS_PGWIRE_MAX_ROWS;
    c.close();
  }
});

test('changing the environment raises and lowers the cap on the next query in both protocols', async () => {
  const c = await new Client().open();
  try {
    for (const cap of [2, 5, 1]) {
      process.env.TABULARIUS_PGWIRE_MAX_ROWS = String(cap);
      for (const extended of [false, true]) {
        const sql = `${query} ORDER BY _fm_record_id LIMIT ${cap}`;
        if (extended) { c.bind(sql); c.execute(0); }
        const full = extended ? await c.until(1) : await c.query(sql, 1);
        assert.equal(full.error, undefined);
        assert.equal(full.rows, cap);
        assert.deepEqual(full.tags, [`SELECT ${cap}`]);
        visited = 0;
        if (extended) { c.bind(query); c.execute(0); }
        refused(extended ? await c.until() : await c.query(query), cap);
        assert.equal(visited, cap + 1);
      }
    }
  } finally { c.close(); }
});

test('extended portals share a connection-wide buffered row cap and closing one frees its rows', async () => {
  const c = await new Client().open();
  try {
    process.env.TABULARIUS_PGWIRE_MAX_ROWS = '100';
    process.env.TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS = '100';
    await c.query('BEGIN');
    c.bind(`${query} ORDER BY _fm_record_id LIMIT 60`);
    c.execute(0);
    const first = await c.until(1);
    assert.equal(first.error, undefined);
    assert.equal(first.rows, 60);

    c.send('P', cstr('second'), cstr(`${query} ORDER BY _fm_record_id LIMIT 60`), i16(0));
    c.send('B', cstr('second'), cstr('second'), i16(0), i16(0), i16(0));
    c.send('C', Buffer.concat([Buffer.from('P'), cstr('')]));
    c.send('S');
    await c.until();
    c.send('E', cstr('second'), i32(0));
    c.send('S');
    const afterClose = await c.until(1);
    assert.equal(afterClose.error, undefined);
    assert.equal(afterClose.rows, 60);

    c.send('P', cstr('third'), cstr(`${query} ORDER BY _fm_record_id LIMIT 60`), i16(0));
    c.send('B', cstr('third'), cstr('third'), i16(0), i16(0), i16(0));
    c.send('E', cstr('third'), i32(0));
    c.send('S');
    const overflow = await c.until();
    assert.equal(overflow.code, '54000');
    assert.match(overflow.error ?? '', /buffered SQL results.*100/i);
    assert.equal(overflow.rows, 0);
  } finally { c.close(); }
});

test('simple queries deliver all rows at the cap and refuse oversized results before sending rows', { timeout: 30_000 }, async () => {
  const c = await new Client().open();
  try {
    const full = await c.query(`${query} ORDER BY _fm_record_id LIMIT ${testCap}`, 1);
    assert.equal(full.error, undefined);
    assert.equal(full.rows, testCap);
    assert.deepEqual(full.tags, [`SELECT ${testCap}`]);
    for (const count of [testCap + 1, 100000, 1000000]) {
      visited = 0;
      const r = await c.query(`${query} LIMIT ${count}; SELECT 1`);
      refused(r);
      assert.equal(r.descriptions, 0);
      assert.equal(visited, testCap + 1, 'stop reading after the overflow row');
    }
    assert.deepEqual((await c.query('SELECT 1')).tags, ['SELECT 1'], 'connection recovers');
    const empty = await c.query('SELECT A FROM Generated WHERE 0');
    assert.equal(empty.rows, 0);
    assert.deepEqual(empty.tags, ['SELECT 0']);
  } finally { c.close(); }
});

test('prepared queries enforce the total limit at Describe and Execute, including suspended portals', { timeout: 30_000 }, async () => {
  const c = await new Client().open();
  try {
    for (const describe of [false, true]) {
      c.bind(query);
      if (describe) c.send('D', Buffer.from('P'), cstr(''));
      c.execute(1);
      refused(await c.until());
      assert.deepEqual((await c.query('SELECT 1')).tags, ['SELECT 1'], 'Sync recovers from the error');
    }
    // Resuming a portal across Sync requires an explicit transaction.
    assert.deepEqual((await c.query('BEGIN')).tags, ['BEGIN']);
    c.bind(`${query} ORDER BY _fm_record_id LIMIT ${testCap}`);
    c.send('D', Buffer.from('P'), cstr(''));
    c.execute(40);
    const first = await c.until(1);
    assert.equal(first.error, undefined);
    assert.equal(first.rows, 40);
    assert.equal(first.suspended, true);
    c.execute(0);
    const rest = await c.until(41);
    assert.equal(rest.error, undefined);
    assert.equal(rest.rows, testCap - 40);
    assert.deepEqual(rest.tags, [`SELECT ${testCap}`]);
    assert.deepEqual((await c.query('COMMIT')).tags, ['COMMIT']);
  } finally { c.close(); }
});

test('a million-row SELECT has bounded result-buffer memory in both protocols', { timeout: 30_000 }, async (t) => {
  const c = await new Client().open();
  try {
    for (const extended of [false, true]) {
      globalThis.gc?.();
      const baseline = process.memoryUsage();
      peak = { rss: baseline.rss, heapUsed: baseline.heapUsed };
      visited = 0;
      const start = performance.now();
      if (extended) { c.bind(query); c.execute(0); }
      const result = extended ? await c.until() : await c.query(query);
      sample();
      const elapsed = performance.now() - start;
      refused(result);
      assert.equal(visited, testCap + 1);
      assert.ok(peak.heapUsed - baseline.heapUsed < 32 * 1024 * 1024, 'result heap growth stays below 32 MiB');
      assert.ok(peak.rss - baseline.rss < 64 * 1024 * 1024, 'result RSS growth stays below 64 MiB');
      t.diagnostic(JSON.stringify({ protocol: extended ? 'extended' : 'simple', ms: elapsed, baseline: { rss: baseline.rss, heapUsed: baseline.heapUsed }, peak }));
    }
  } finally { c.close(); }
});
