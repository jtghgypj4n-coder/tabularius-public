// The binary format over the PostgreSQL protocol, byte by byte: every field kind a file has comes back in binary as
// the text format reads it, binary parameters find the rows text ones do, the format-code rules of Bind hold, malformed
// binary input is answered with an error and the connection carries on, and the binary path is refused exactly where
// the text path is. Generated data only, in a file the test makes.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type PrivilegeDefinition } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { PgServer } from '../src/pgwire.ts';
import { BINARY_OID as OID, binaryValue, decodeNumeric, encodeArray, encodeNumeric } from '../src/pgbinary.ts';
import { bindBody, PgClient, type PgResult } from './pg-client.ts';

const be = (bytes: number, write: (b: Buffer) => void) => { const b = Buffer.alloc(bytes); write(b); return b; };
const i32 = (n: number) => be(4, (b) => b.writeInt32BE(n));
const i64 = (n: bigint) => be(8, (b) => b.writeBigInt64BE(n));
const f64 = (n: number) => be(8, (b) => b.writeDoubleBE(n));
const LONG = 'Long text é '.repeat(10_000);
const PASSWORD = ['pw', 'binary', 'test'].join('-');

let dir: string;
let path: string;
let host: Host;
let pg: PgServer;
let port: number;
let peer: Store;
const full = (name: string): PrivilegeDefinition => ({
  name, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmxdbc'],
});

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pg-binary-'));
  path = join(dir, 'Binary.openhbam.sqlite');
  createStore(path, { mode: 'native' });
  host = new Host(dir);
  const store = host.get('Binary')!;
  store.applyDesign([{ op: 'createTable', name: 'Values', fields: [
    { name: 'Name' }, { name: 'N', type: 'number' }, { name: 'D', type: 'date' }, { name: 'Tm', type: 'time' }, { name: 'Ts', type: 'timestamp' },
    { name: 'C', type: 'container' }, { name: 'B', type: 'boolean' }, { name: 'I', type: 'integer' }, { name: 'Dec', type: 'decimal' },
    { name: 'J', type: 'json' }, { name: 'U', type: 'uuid' },
  ] }]);
  const first = store.create('Values', { Name: 'first', N: '-1.5', D: '2024-03-09', Tm: '13:05:00', Ts: '2024-03-09T13:02:03', B: 'true', I: '-12', Dec: '-12345.678', J: '{"x":[1,null]}', U: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' });
  store.setContainer('Values', first.recordId, 'C', 1, { filename: 'a.bin', mime: 'application/octet-stream', data: new Uint8Array([0, 1, 255]) });
  store.create('Values', { Name: LONG, N: '0', D: '1999-12-31', Tm: '00:00:00', B: 'false', I: '9007199254740991', Dec: '0.0001', J: '[]', U: '00000000-0000-0000-0000-000000000001' });
  store.create('Values', {});
  store.savePrivilegeSet(full('SQL Readers'));
  store.setPassword('Reader', PASSWORD, 'SQL Readers');
  pg = new PgServer(host, { port: 0 });
  port = await pg.listen();
  peer = new Store(path);
});
after(async () => {
  pg?.close();
  peer?.close();
  await host?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const open = (user = 'Reader') => PgClient.open({ port, user, password: PASSWORD, database: 'Binary' });
const ALL = 'SELECT "Name", "N", "D", "Tm", "Ts", "C", "B", "I", "Dec", "J", "U" FROM "Values" ORDER BY "Name"';

/** A binary value read back as its text form, by the column's type. */
function textOf(oid: number, b: Buffer | null): string | null {
  if (b === null) return null;
  switch (oid) {
    case OID.bool: assert.equal(b.length, 1); return b[0] ? 't' : 'f';
    case OID.int8: assert.equal(b.length, 8); return b.readBigInt64BE(0).toString();
    case OID.numeric: return decodeNumeric(b);
    case OID.uuid: { assert.equal(b.length, 16); const h = b.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
    case OID.jsonb: assert.equal(b[0], 1); return b.subarray(1).toString('utf8');
    case OID.bytea: return '\\x' + b.toString('hex');
    default: return b.toString('utf8');
  }
}

function ok(r: PgResult): PgResult {
  assert.equal(r.error, undefined, r.error && `${r.error.code} ${r.error.message}`);
  return r;
}

test('every field kind comes back in binary as the text format reads it, NULLs and long text included', async (t) => {
  const c = await open();
  t.after(() => c.close());
  // The same extended-protocol query in each format (a simple query can type an untyped column from its first value instead).
  const text = ok(await c.formats(ALL));
  const binary = ok(await c.formats(ALL, { resultFormats: [1] }));
  assert.deepEqual(binary.oids, text.oids);
  // Dates, times and timestamps are text, as the file keeps them; a container is its reference number, as in the text format.
  // A decimal in a query of several columns is described as text today (as it is for the text format), so it is left out here.
  assert.deepEqual(binary.oids.filter((_, i) => i !== 8), [OID.text, OID.numeric, OID.text, OID.text, OID.text, OID.numeric, OID.bool, OID.int8, OID.jsonb, OID.uuid]);
  assert.deepEqual(binary.formats, binary.oids.map(() => 1), 'one result format code applies to every column');
  assert.equal(binary.values.length, 3);
  binary.values.forEach((row, r) => row.forEach((v, i) => {
    const oid = binary.oids[i];
    const expected = text.rows[r][i];
    const got = textOf(oid, v);
    // Numbers can differ in form (1e+21 against its digits), never in value.
    if (oid === OID.numeric && got !== null && expected !== null) assert.equal(Number(got), Number(expected), `${binary.columns[i]} row ${r}`);
    else assert.equal(got, expected, `${binary.columns[i]} row ${r}`);
  }));
  const decimals = binary.values.map((row) => textOf(binary.oids[8], row[8]));
  assert.ok(decimals.includes('-12345.678'), 'a negative decimal');
  assert.ok(binary.values.some((row) => textOf(OID.text, row[0]) === LONG));
  assert.ok(binary.values.some((row) => row.every((v, i) => i === 0 || v === null)), 'the empty record is NULL in every column but its name');
});

test('binary parameters of each type find the rows the text format finds', async (t) => {
  const c = await open();
  t.after(() => c.close());
  const cases: { where: string; oid: number; text: string; binary: Buffer; expect: string[] }[] = [
    { where: '"Name" = $1', oid: OID.text, text: 'first', binary: Buffer.from('first'), expect: ['first'] },
    { where: '"Name" = $1', oid: OID.varchar, text: LONG, binary: Buffer.from(LONG), expect: [LONG] },
    { where: '"N" < $1', oid: OID.int4, text: '-1', binary: i32(-1), expect: ['first'] },
    { where: '"N" < $1', oid: OID.int8, text: '-1', binary: i64(-1n), expect: ['first'] },
    { where: '"N" < $1', oid: OID.float8, text: '-1.25', binary: f64(-1.25), expect: ['first'] },
    { where: '"N" < $1', oid: OID.numeric, text: '-1.25', binary: encodeNumeric('-1.25'), expect: ['first'] },
    { where: '"I" = $1', oid: OID.int8, text: '9007199254740991', binary: i64(9007199254740991n), expect: [LONG] },
    { where: '"D" = $1', oid: OID.date, text: '1999-12-31', binary: i32(-1), expect: [LONG] },
    { where: '"Tm" = $1', oid: OID.time, text: '13:05:00', binary: binaryValue('13:05:00', OID.time)!, expect: ['first'] },
    { where: '"B" = $1', oid: OID.bool, text: '1', binary: Buffer.from([1]), expect: ['first'] },
    { where: '"U" = $1', oid: OID.uuid, text: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', binary: Buffer.from('aaaaaaaabbbbccccddddeeeeeeeeeeee', 'hex'), expect: ['first'] },
    { where: '"J" = $1', oid: OID.jsonb, text: '[]', binary: Buffer.from([1, 0x5b, 0x5d]), expect: [LONG] },
    { where: '"J" = $1', oid: OID.json, text: '[]', binary: Buffer.from('[]'), expect: [LONG] },
  ];
  for (const k of cases) {
    const sql = `SELECT "Name" FROM "Values" WHERE ${k.where} ORDER BY "Name"`;
    const asText = ok(await c.formats(sql, { types: [k.oid], values: [Buffer.from(k.text)] }));
    const asBinary = ok(await c.formats(sql, { types: [k.oid], values: [k.binary], paramFormats: [1] }));
    assert.deepEqual(asBinary.rows, asText.rows, `${k.oid} ${k.where}`);
    assert.deepEqual(asBinary.rows.map((r) => r[0]), k.expect, `${k.oid} ${k.where}`);
  }
  // NULL in binary is NULL, as in text.
  const nulls = ok(await c.formats('SELECT "Name" FROM "Values" WHERE "N" = $1', { types: [OID.int4], values: [null], paramFormats: [1] }));
  assert.deepEqual(nulls.rows, []);
});

test('result format codes: none is text, one applies to all, a mix is per column, a wrong count is refused at Bind', async (t) => {
  const c = await open();
  t.after(() => c.close());
  const sql = 'SELECT "Name", "I", "U" FROM "Values" WHERE "Name" = \'first\'';
  const none = ok(await c.formats(sql));
  assert.deepEqual(none.formats, [0, 0, 0]);
  assert.deepEqual(none.rows, [['first', '-12', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']]);
  const mixed = ok(await c.formats(sql, { resultFormats: [0, 1, 0] }));
  assert.deepEqual(mixed.formats, [0, 1, 0]);
  assert.equal(mixed.rows[0][0], 'first');
  assert.equal(mixed.values[0][1]!.readBigInt64BE(0), -12n);
  assert.equal(mixed.rows[0][2], 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  const reversed = ok(await c.formats(sql, { resultFormats: [1, 0, 1] }));
  assert.deepEqual(reversed.formats, [1, 0, 1]);
  assert.equal(reversed.rows[0][1], '-12');
  assert.equal(reversed.values[0][2]!.length, 16);
  for (const formats of [[1, 0], [0, 1, 0, 1]]) {
    const wrong = await c.formats(sql, { resultFormats: formats });
    assert.equal(wrong.error?.code, '08P01', String(formats));
    assert.match(wrong.error!.message, new RegExp(`${formats.length} result formats but query has 3 columns`));
    assert.deepEqual(wrong.sequence, ['1', 'E', 'Z'], 'ParseComplete, the error, then nothing until Sync');
  }
  const bad = await c.formats(sql, { resultFormats: [2] });
  assert.equal(bad.error?.code, '08P01');
  // A statement with no rows takes any count, as in PostgreSQL.
  ok(await c.formats('SET application_name = \'binary\'', { resultFormats: [1, 0, 1, 0] }));
  assert.deepEqual(ok(await c.simple('SELECT 1 AS one')).rows, [['1']]);
});

test('parameter format codes: one applies to all, none is text, fewer than the parameters (but more than one) is refused', async (t) => {
  const c = await open();
  t.after(() => c.close());
  const sql = 'SELECT "Name" FROM "Values" WHERE "N" > $1 AND "N" < $2 AND "Name" <> $3 ORDER BY "Name"';
  const types = [OID.int4, OID.int4, OID.text];
  const all = ok(await c.formats('SELECT "Name" FROM "Values" WHERE "N" > $1 AND "N" < $2 ORDER BY "Name"', { types: [OID.int4, OID.int4], values: [i32(-2), i32(1)], paramFormats: [1] }));
  assert.deepEqual(all.rows.map((r) => r[0]), ['first', LONG], 'one binary format code covers both parameters');
  const text = ok(await c.formats(sql, { types, values: [Buffer.from('-2'), Buffer.from('1'), Buffer.from('x')] }));
  assert.deepEqual(text.rows.map((r) => r[0]), ['first', LONG]);
  const each = ok(await c.formats(sql, { types, values: [i32(-2), Buffer.from('1'), Buffer.from('first')], paramFormats: [1, 0, 0] }));
  assert.deepEqual(each.rows.map((r) => r[0]), [LONG]);
  const fewer = await c.formats(sql, { types, values: [i32(-2), i32(1), Buffer.from('x')], paramFormats: [1, 1] });
  assert.equal(fewer.error?.code, '08P01');
  assert.equal(fewer.error?.message, 'bind message has 2 parameter formats but 3 parameters');
  const count = await c.formats(sql, { types, values: [i32(-2), i32(1)], paramFormats: [1] });
  assert.equal(count.error?.code, '08P01');
  assert.match(count.error!.message, /supplies 2 parameters, but prepared statement "" requires 3/);
  const unknown = await c.formats(sql, { types, values: [i32(-2), i32(1), Buffer.from('x')], paramFormats: [1, 1, 3] });
  assert.equal(unknown.error?.code, '08P01');
  assert.deepEqual(ok(await c.simple('SELECT 1 AS one')).rows, [['1']]);
});

test('Describe of a prepared statement before Bind: parameter types from casts, text formats, then binary rows', async (t) => {
  const c = await open();
  t.after(() => c.close());
  const sql = 'SELECT "Name", "Dec" FROM "Values" WHERE "Dec" < $1::numeric AND "Name" = $2::varchar ORDER BY "Name"';
  const r = ok(await c.formats(sql, { describeStatement: true, values: [encodeNumeric('1'), Buffer.from('first')], paramFormats: [1], resultFormats: [1] }));
  assert.deepEqual(r.paramTypes, [OID.numeric, OID.varchar], 'the casts name the parameter types');
  const descriptions = r.sequence.filter((m) => m === 'T').length;
  assert.equal(descriptions, 2, 'one row description for the statement, one for the portal');
  assert.deepEqual(r.sequence.slice(0, 4), ['1', 't', 'T', '2'], 'ParseComplete, ParameterDescription, RowDescription, BindComplete');
  assert.deepEqual(r.formats, [1, 1], 'the portal\'s description has the formats Bind asked for');
  assert.deepEqual(r.values.map((row) => [textOf(r.oids[0], row[0]), textOf(r.oids[1], row[1])]), [['first', '-12345.678']]);
  // The statement's own description, before Bind, says text: formats are not known until then. An array cast is described
  // as the array type, so a binary driver sends a list (before, $2::text[] was described as text and $3::int4[] as int4).
  const arrays = 'SELECT "Name" FROM "Values" WHERE "N" < $1::numeric AND $2::text[] IS NOT NULL AND $3::int4[] IS NOT NULL';
  c.send('P', Buffer.concat([Buffer.from('named\0'), Buffer.from(arrays + '\0'), be(2, (b) => b.writeInt16BE(0))]));
  c.send('D', Buffer.from('Snamed\0'));
  c.send('S');
  const statement = ok(await c.untilReady());
  assert.deepEqual(statement.formats, [0]);
  assert.deepEqual(statement.paramTypes, [OID.numeric, 1009, 1007]);
});

test('malformed binary parameters are answered with an error and the connection carries on', async (t) => {
  const c = await open();
  t.after(() => c.close());
  const cases: { name: string; oid: number; value: Buffer | { length: number; bytes?: Buffer }; code: string }[] = [
    { name: 'short int4', oid: OID.int4, value: Buffer.alloc(3), code: '08P01' },
    { name: 'oversized int4', oid: OID.int4, value: Buffer.alloc(5), code: '22P03' },
    { name: 'empty int8', oid: OID.int8, value: Buffer.alloc(0), code: '08P01' },
    { name: 'negative length', oid: OID.int4, value: { length: -2 }, code: '08P01' },
    { name: 'the smallest length', oid: OID.int4, value: { length: -0x80000000 }, code: '08P01' },
    { name: 'length past the message', oid: OID.int4, value: { length: 1000, bytes: Buffer.alloc(4) }, code: '08P01' },
    { name: 'numeric digit over 9999', oid: OID.numeric, value: Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0x27, 0x10]), code: '22P03' },
    { name: 'numeric digit count past its digits', oid: OID.numeric, value: Buffer.from([0xff, 0xff, 0, 0, 0, 0, 0, 0]), code: '08P01' },
    { name: 'short uuid', oid: OID.uuid, value: Buffer.alloc(15), code: '08P01' },
    { name: 'date out of range', oid: OID.date, value: i32(0x7ffffffe), code: '22008' },
    { name: 'time past a day', oid: OID.time, value: i64(86_400_000_001n), code: '22008' },
    { name: 'invalid UTF-8 text', oid: OID.text, value: Buffer.from([0xff, 0xfe]), code: '22021' },
    { name: 'jsonb version 2', oid: OID.jsonb, value: Buffer.from([2, 0x7b, 0x7d]), code: '22P03' },
    { name: 'array claiming a billion elements', oid: 1007, value: Buffer.concat([i32(2), i32(0), i32(OID.int4), i32(40000), i32(1), i32(40000), i32(1)]), code: '08P01' },
    { name: 'array of the wrong element type', oid: 1007, value: encodeArray(['x'], OID.text), code: '42804' },
    { name: 'type with no binary form', oid: 600, value: Buffer.alloc(16), code: '0A000' },
  ];
  for (const k of cases) {
    const r = await c.formats('SELECT "Name" FROM "Values" WHERE "Name" = $1', { types: [k.oid], values: [k.value], paramFormats: [1] });
    assert.equal(r.error?.code, k.code, `${k.name}: ${r.error?.message}`);
    assert.deepEqual(r.rows, [], k.name);
    assert.deepEqual(r.sequence, ['1', 'E', 'Z'], `${k.name}: an error, then nothing until Sync`);
    if (k.code !== '0A000' && typeof (k.value as Buffer).length === 'number' && Buffer.isBuffer(k.value)) assert.match(r.error!.message, /in bind parameter 1$/, k.name);
  }
  // Bind messages cut short at each field: refused, never read past the end.
  const whole = bindBody({ paramFormats: [1], values: [i32(1)], resultFormats: [1] });
  for (let cut = 0; cut < whole.length; cut++) {
    c.send('P', Buffer.concat([Buffer.from('\0SELECT "Name" FROM "Values" WHERE "N" = $1\0'), be(2, (b) => b.writeInt16BE(1)), i32(OID.int4)]));
    c.send('B', whole.subarray(0, cut));
    c.send('E', Buffer.from('\0\0\0\0\0'));
    c.send('S');
    const r = await c.untilReady();
    assert.equal(r.error?.code, '08P01', `Bind cut at ${cut} bytes: ${r.error?.code} ${r.error?.message}`);
  }
  c.send('P', Buffer.concat([Buffer.from('\0SELECT 1\0'), be(2, () => {})]));
  c.send('B', Buffer.concat([bindBody({}), Buffer.from([0])]));
  c.send('S');
  assert.equal((await c.untilReady()).error?.code, '08P01', 'bytes after the result formats');
  assert.deepEqual(ok(await c.simple('SELECT 1 AS one')).rows, [['1']], 'the connection still answers');
});

test('a stored value its column type cannot hold in binary is an error, not short bytes; text still reads it', async (t) => {
  peer.sql.exec(`UPDATE "Values" SET "U" = 'not-a-uuid' WHERE "Name" = 'first'`);
  t.after(() => peer.sql.exec(`UPDATE "Values" SET "U" = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' WHERE "Name" = 'first'`));
  const c = await open();
  t.after(() => c.close());
  const sql = 'SELECT "U" FROM "Values" WHERE "Name" = \'first\'';
  const binary = await c.formats(sql, { resultFormats: [1] });
  assert.equal(binary.error?.code, '22P02');
  assert.deepEqual(binary.values, []);
  assert.deepEqual(ok(await c.formats(sql)).rows, [['not-a-uuid']]);
});

// The PostgreSQL connection has no field masks: SQL reads every record and field, so a privilege set that hides or
// masks anything is refused at sign-in and, if narrowed while connected, at the next Bind, Describe or Execute.
// Binary results come from the same rows, so they are refused at exactly the same points.
const NARROWED: Record<string, PrivilegeDefinition['records'] | { tables: NonNullable<PrivilegeDefinition['tables']> }> = {
  'a field with no access': { tables: { Values: { view: true, edit: false, create: false, delete: false, fields: { Name: 'none' } } } },
  'a field masked to its last four characters': { tables: { Values: { view: true, edit: false, create: false, delete: false, fields: { Name: 'masked' }, masks: { Name: { kind: 'last4' } } } } },
  'a field masked with a placeholder': { tables: { Values: { view: true, edit: false, create: false, delete: false, fields: { U: 'masked' }, masks: { U: { kind: 'placeholder', text: 'hidden' } } } } },
  'fields hidden by default': { tables: { Values: { view: true, edit: false, create: false, delete: false, fieldsDefault: 'none', fields: { Name: 'viewOnly' } } } },
  'records limited by a calculation': { tables: { Values: { view: '"Name" = "first"', edit: false, create: false, delete: false } } },
  'a table that cannot be viewed': { tables: { Values: { view: false, edit: false, create: false, delete: false } } },
};

for (const [kind, narrowing] of Object.entries(NARROWED)) {
  test(`binary results are refused like text ones for ${kind}`, { timeout: 30_000 }, async (t) => {
    const set = `Narrowed ${kind}`;
    const account = `Reader ${Object.keys(NARROWED).indexOf(kind)}`;
    const definition = full(set);
    const store = host.get('Binary')!;
    store.savePrivilegeSet(definition);
    store.setPassword(account, PASSWORD, set);
    const narrowed = { ...definition, ...('tables' in narrowing ? narrowing : { records: narrowing }) } as PrivilegeDefinition;
    const c = await open(account);
    t.after(() => c.close());
    // A portal holding rows in binary, part sent, inside a transaction so it outlives Sync.
    ok(await c.simple('BEGIN'));
    c.send('P', Buffer.concat([Buffer.from('held\0'), Buffer.from(`${ALL}\0`), be(2, () => {})]));
    c.send('B', bindBody({ portal: 'held', statement: 'held', resultFormats: [1] }));
    c.send('E', Buffer.concat([Buffer.from('held\0'), i32(1)]));
    c.send('S');
    const first = ok(await c.untilReady());
    assert.equal(first.values.length, 1);
    assert.ok(first.sequence.includes('s'), 'suspended with rows left');
    peer.savePrivilegeSet(narrowed);
    t.after(() => peer.savePrivilegeSet(definition));
    c.send('E', Buffer.concat([Buffer.from('held\0'), i32(0)]));
    c.send('S');
    const rest = await c.untilReady();
    assert.equal(rest.error?.code, '42501', `${kind}: ${rest.error?.message}`);
    assert.deepEqual(rest.values, [], 'no more rows, in either format');
    ok(await c.simple('ROLLBACK'));
    for (const resultFormats of [[1], [0]]) {
      const fresh = await c.formats(ALL, { resultFormats });
      assert.equal(fresh.error?.code, '42501', `${kind} format ${resultFormats[0]}`);
      assert.deepEqual(fresh.values, []);
    }
    c.close();
    await assert.rejects(open(account), /^Error: 42501 /, `${kind}: refused at sign-in`);
  });
}
