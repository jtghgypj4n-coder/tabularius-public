// PostgreSQL binary formats, value by value: every type the server reads or writes in binary round-trips its edge
// values, and malformed input (short, oversized, out of range) is a BinaryFormatError with PostgreSQL's SQLSTATE,
// never a RangeError or a hang. Generated values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRAY_ELEMENT, BINARY_OID as OID, BinaryFormatError, binaryParam, binaryValue, castParamTypes, decodeNumeric, encodeArray, encodeInterval, encodeNumeric,
} from '../src/pgbinary.ts';
import { random } from '../../../scripts/fuzz/generate.ts';
import type { SqlValue } from '../../store/src/find.ts';

const be = (bytes: number, write: (b: Buffer) => void) => { const b = Buffer.alloc(bytes); write(b); return b; };
const i32 = (n: number) => be(4, (b) => b.writeInt32BE(n));
const i64 = (n: bigint) => be(8, (b) => b.writeBigInt64BE(n));

/** The SQLSTATE a call fails with; fails the test if it returns, or throws anything but a BinaryFormatError. */
function code(f: () => unknown): string {
  try { f(); } catch (e) {
    assert.ok(e instanceof BinaryFormatError, `expected a BinaryFormatError, got ${(e as Error).stack}`);
    return e.code;
  }
  assert.fail('expected an error');
}

/** Big integers and container bytes reach the encoders too, though SqlValue does not name them. */
const raw = (v: bigint | Uint8Array) => v as unknown as SqlValue;
const roundTrip = (v: SqlValue, oid: number) => binaryParam(binaryValue(v, oid)!, oid);

test('bool: one byte both ways, with the same rule for false as the text format', () => {
  for (const [v, byte] of [[1, 1], [0, 0], ['t', 1], ['f', 0], ['0', 0], [raw(0n), 0], [-1, 1]] as const) {
    assert.deepEqual([...binaryValue(v, OID.bool)!], [byte], String(v));
  }
  assert.equal(binaryParam(Buffer.from([1]), OID.bool), 1);
  assert.equal(binaryParam(Buffer.from([7]), OID.bool), 1, 'any non-zero byte is true, as PostgreSQL reads it');
  assert.equal(binaryParam(Buffer.from([0]), OID.bool), 0);
  assert.equal(code(() => binaryParam(Buffer.alloc(0), OID.bool)), '08P01');
  assert.equal(code(() => binaryParam(Buffer.alloc(2), OID.bool)), '22P03');
});

test('integers: the whole range of int2, int4, int8 and oid; out of range or not whole is refused', () => {
  for (const [oid, values] of [
    [OID.int2, [-32768, -1, 0, 32767]], [OID.int4, [-2147483648, -1, 0, 2147483647]], [OID.oid, [0, 1, 4294967295]],
    [OID.int8, [-Number.MAX_SAFE_INTEGER, -1, 0, Number.MAX_SAFE_INTEGER]],
  ] as const) {
    for (const v of values) assert.equal(roundTrip(v, oid), v, `${oid} ${v}`);
    for (const v of values) assert.equal(roundTrip(String(v), oid), v, `${oid} "${v}"`);
  }
  assert.equal(binaryValue(raw(-0x8000000000000000n), OID.int8)!.readBigInt64BE(0), -0x8000000000000000n);
  assert.equal(binaryValue(raw(0x7fffffffffffffffn), OID.int8)!.readBigInt64BE(0), 0x7fffffffffffffffn);
  assert.equal(code(() => binaryValue(raw(0x8000000000000000n), OID.int8)), '22003');
  assert.equal(code(() => binaryValue(32768, OID.int2)), '22003');
  assert.equal(code(() => binaryValue(-1, OID.oid)), '22003');
  // Before: BigInt('1.5') threw a SyntaxError and BigInt('') gave 0.
  for (const v of [1.5, '1.5', '', '  ', 'abc', Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(code(() => binaryValue(v as SqlValue, OID.int8)), '22P02', String(v));
  for (const [oid, size] of [[OID.int2, 2], [OID.int4, 4], [OID.oid, 4], [OID.int8, 8]] as const) {
    assert.equal(code(() => binaryParam(Buffer.alloc(size - 1), oid)), '08P01', `short ${oid}`);
    assert.equal(code(() => binaryParam(Buffer.alloc(size + 1), oid)), '22P03', `oversized ${oid}`);
    assert.equal(code(() => binaryParam(Buffer.alloc(0), oid)), '08P01', `empty ${oid}`);
  }
});

test('floats: negative, NaN, both infinities, negative zero and the extremes', () => {
  for (const v of [-1.5, 0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE, Number.MIN_VALUE, -123456.789]) {
    assert.ok(Object.is(roundTrip(v, OID.float8), v), `float8 ${v}`);
  }
  for (const v of [-1.5, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Math.fround(3.4e38)]) {
    assert.ok(Object.is(roundTrip(v, OID.float4), v), `float4 ${v}`);
  }
  assert.ok(Object.is(roundTrip('NaN', OID.float8), Number.NaN));
  assert.equal(roundTrip('-Infinity', OID.float8), Number.NEGATIVE_INFINITY);
  assert.equal(code(() => binaryValue('$12', OID.float8)), '22P02');
  assert.equal(code(() => binaryParam(Buffer.alloc(7), OID.float8)), '08P01');
  assert.equal(code(() => binaryParam(Buffer.alloc(5), OID.float4)), '22P03');
});

test('numeric: signs, scales, NaN and infinities; malformed headers and digits are refused', () => {
  const long = '9'.repeat(1000) + '.' + '1'.repeat(500);
  for (const t of ['0', '-1', '0.00', '-0.0001', '12345.678', '-99999999.99', long, `-${long}`, 'NaN', 'Infinity', '-Infinity']) {
    assert.equal(decodeNumeric(encodeNumeric(t)), t, t.slice(0, 20));
  }
  assert.equal(binaryParam(encodeNumeric('NaN'), OID.numeric), 'NaN', 'NaN stays text, as Number of the text format would not read it');
  assert.equal(binaryParam(encodeNumeric('-Infinity'), OID.numeric), Number.NEGATIVE_INFINITY);
  assert.equal(binaryParam(encodeNumeric('-2.50'), OID.numeric), -2.5);
  // Digits past the display scale are cut, and a zero that is left has no sign.
  const cut = encodeNumeric('-0.00001');
  cut.writeUInt16BE(2, 6);
  assert.equal(decodeNumeric(cut), '0.00');
  const header = (n: number, weight: number, sign: number, dscale: number, ...digits: number[]) =>
    Buffer.concat([be(8, (b) => { b.writeUInt16BE(n, 0); b.writeInt16BE(weight, 2); b.writeUInt16BE(sign, 4); b.writeUInt16BE(dscale, 6); }), ...digits.map((d) => be(2, (b) => b.writeInt16BE(d)))]);
  assert.equal(decodeNumeric(header(1, 0, 0, 0, 42)), '42');
  assert.equal(code(() => decodeNumeric(Buffer.alloc(7))), '08P01', 'short header');
  assert.equal(code(() => decodeNumeric(header(2, 0, 0, 0, 1))), '08P01', 'fewer digits than the count');
  assert.equal(code(() => decodeNumeric(header(1, 0, 0, 0, 1, 2))), '22P03', 'more digits than the count');
  assert.equal(code(() => decodeNumeric(header(0xffff, 0, 0, 0))), '08P01', 'a huge count with no digits');
  assert.equal(code(() => decodeNumeric(header(1, 0, 0x1234, 0, 1))), '22P03', 'bad sign');
  assert.equal(code(() => decodeNumeric(header(1, 0, 0, 0x4000, 1))), '22P03', 'scale over the maximum');
  assert.equal(code(() => decodeNumeric(header(1, 0, 0, 0, 10000))), '22P03', 'digit over 9999');
  assert.equal(code(() => decodeNumeric(header(1, 0, 0, 0, -1))), '22P03', 'negative digit');
  // A ten-byte numeric may not expand to 131,072 digits: whole parts past 1,000 digits (FileMaker keeps 400) are refused.
  assert.equal(decodeNumeric(header(1, 249, 0, 0, 1)), '1' + '0'.repeat(249 * 4), 'a 997-digit whole part is read');
  assert.equal(decodeNumeric(header(1, 249, 0, 0, 9999)).length, 1000, 'a 1,000-digit whole part is read');
  assert.equal(code(() => decodeNumeric(header(1, 250, 0, 0, 1))), '22003', 'a 1,001-digit whole part is refused');
  assert.equal(code(() => decodeNumeric(header(1, 0x7fff, 0, 0, 1))), '22003', 'the largest weight is refused');
  // The smallest weight with the largest scale stays bounded by the scale, not by the weight.
  assert.equal(decodeNumeric(header(1, -0x8000, 0, 0x3fff, 1)), '0.' + '0'.repeat(0x3fff));
  // A number field's text: exponents beyond 1,000 are refused at once instead of writing out the zeros.
  const started = performance.now();
  assert.equal(code(() => binaryValue('1e999999999', OID.numeric)), '22003');
  assert.equal(code(() => binaryValue('1e-20000', OID.numeric)), '22003');
  assert.equal(code(() => binaryValue('1e150000', OID.numeric)), '22003', 'not a 75 KB numeric per row');
  assert.equal(code(() => binaryValue('1e1000', OID.numeric)), '22003', '1,001 whole digits');
  assert.equal(code(() => binaryValue('1e-1001', OID.numeric)), '22003');
  assert.equal(decodeNumeric(binaryValue('1e999', OID.numeric)!), '1' + '0'.repeat(999), 'what is written can be read back');
  assert.ok(performance.now() - started < 1000);
  // A long run of digits that ends in a character that is not part of a number is read in linear time.
  for (const bad of ['1'.repeat(80_000) + 'x', '1'.repeat(80_000) + '.1.', '.' + '1'.repeat(80_000) + 'e']) {
    const t0 = performance.now();
    assert.equal(binaryValue(bad, OID.numeric), null, 'no number, as the text format reads it');
    assert.equal(code(() => binaryValue(bad, OID.float8)), '22P02');
    assert.ok(performance.now() - t0 < 250, `${bad.length} characters took ${performance.now() - t0} ms`);
  }
  assert.equal(binaryValue('$3750', OID.numeric), null, 'no number reads as NULL, as in the text format');
});

test('text types: empty, very long and non-ASCII text; invalid UTF-8 and NUL are refused as in the text format', () => {
  const long = 'é€😀'.repeat(300_000);
  for (const oid of [OID.text, OID.varchar, OID.bpchar, OID.name, OID.unknown, OID.json, 0]) {
    for (const v of ['', 'plain', long]) assert.equal(roundTrip(v, oid), v, `${oid} ${v.length}`);
    assert.equal(code(() => binaryParam(Buffer.from([0xc3, 0x28]), oid)), '22021', `invalid UTF-8 ${oid}`);
    assert.equal(code(() => binaryParam(Buffer.from('a\0b'), oid)), '22021', `NUL ${oid}`);
  }
});

test('jsonb: version 1 then the text; another version, or nothing, is refused', () => {
  assert.equal(roundTrip('{"a":[1,null]}', OID.jsonb), '{"a":[1,null]}');
  assert.deepEqual([...binaryValue('{}', OID.jsonb)!], [1, 0x7b, 0x7d]);
  assert.equal(code(() => binaryParam(Buffer.from([2, 0x7b, 0x7d]), OID.jsonb)), '22P03');
  assert.equal(code(() => binaryParam(Buffer.alloc(0), OID.jsonb)), '08P01');
  assert.equal(code(() => binaryParam(Buffer.from([1, 0xff]), OID.jsonb)), '22021');
});

test('uuid: sixteen bytes both ways; a value that is not a uuid is refused instead of written short', () => {
  const text = '0123abcd-4567-89ef-0123-456789abcdef';
  assert.equal(roundTrip(text, OID.uuid), text);
  assert.equal(roundTrip(text.toUpperCase(), OID.uuid), text);
  assert.equal(roundTrip(`{${text.replace(/-/g, '')}}`, OID.uuid), text);
  // Before: Buffer.from('not-a-uuid', 'hex') gave zero bytes and the column went out short.
  for (const v of ['not-a-uuid', '', '0123', text + '0']) assert.equal(code(() => binaryValue(v, OID.uuid)), '22P02', v);
  assert.equal(code(() => binaryParam(Buffer.alloc(15), OID.uuid)), '08P01');
  assert.equal(code(() => binaryParam(Buffer.alloc(17), OID.uuid)), '22P03');
});

test('bytea: bytes out, the text format\'s \\x form in', () => {
  const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  assert.deepEqual(binaryValue(raw(new Uint8Array(all)), OID.bytea), all);
  assert.equal(binaryParam(all, OID.bytea), '\\x' + all.toString('hex'));
  assert.equal(binaryParam(Buffer.alloc(0), OID.bytea), '\\x');
  assert.deepEqual(binaryValue(raw(new Uint8Array(0)), OID.bytea), Buffer.alloc(0));
});

test('date: days from 2000-01-01, BC dates, infinities and the ends of PostgreSQL\'s range', () => {
  for (const t of ['2000-01-01', '2024-03-09', '1999-12-31', '0001-01-01', '0001-12-31 BC', '0044-03-15 BC', '4714-11-24 BC', '5874897-12-31', '2024-02-29', 'infinity', '-infinity']) {
    assert.equal(roundTrip(t, OID.date), t, t);
  }
  assert.equal(binaryParam(i32(8834), OID.date), '2024-03-09');
  assert.equal(binaryParam(i32(-1), OID.date), '1999-12-31');
  assert.equal(binaryParam(i32(-2_451_545), OID.date), '4714-11-24 BC');
  assert.equal(code(() => binaryParam(i32(-2_451_546), OID.date)), '22008');
  assert.equal(code(() => binaryParam(i32(2_145_031_949), OID.date)), '22008');
  assert.equal(code(() => binaryParam(i32(2_147_483_646), OID.date)), '22008');
  assert.equal(code(() => binaryValue('2023-02-29', OID.date)), '22008');
  assert.equal(code(() => binaryValue('3/9/2024', OID.date)), '22007');
  assert.equal(code(() => binaryParam(Buffer.alloc(3), OID.date)), '08P01');
});

test('time: microseconds after midnight, 24:00:00 included; negative or past a day is refused', () => {
  for (const t of ['00:00:00', '13:05:00', '23:59:59.999999', '00:00:00.5', '24:00:00']) assert.equal(roundTrip(t, OID.time), t, t);
  assert.equal(code(() => binaryParam(i64(-1n), OID.time)), '22008');
  assert.equal(code(() => binaryParam(i64(86_400_000_001n), OID.time)), '22008');
  assert.equal(code(() => binaryParam(i64(-0x8000000000000000n), OID.time)), '22008');
  assert.equal(code(() => binaryValue('25:00:00', OID.time)), '22008');
  assert.equal(code(() => binaryValue('12:61:00', OID.time)), '22008');
  assert.equal(code(() => binaryParam(Buffer.alloc(9), OID.time)), '22P03');
});

test('timestamp and timestamptz: before and after 2000, BC, infinities and the ends of the range', () => {
  for (const oid of [OID.timestamp, OID.timestamptz]) {
    for (const t of ['2024-03-09 00:30:00.5', '1999-12-31 23:59:59.999999', '2000-01-01 00:00:00', '0044-03-15 12:00:00 BC', '4714-11-24 00:00:00 BC', '294276-12-31 23:59:59.999999', 'infinity', '-infinity']) {
      assert.equal(roundTrip(t, oid), t, `${oid} ${t}`);
    }
    // Before: a negative count gave "1999-12-31 23:59:59.-1" style text.
    assert.equal(binaryParam(i64(-1n), oid), '1999-12-31 23:59:59.999999');
    assert.equal(binaryParam(i64(763_259_400_500_000n), oid), '2024-03-09 00:30:00.5');
    assert.equal(code(() => binaryParam(i64(-211_813_488_000_000_001n), oid)), '22008');
    assert.equal(code(() => binaryParam(i64(9_223_371_331_200_000_000n), oid)), '22008');
    assert.equal(code(() => binaryParam(Buffer.alloc(4), oid)), '08P01');
  }
  assert.equal(roundTrip('2024-03-09T13:02:03', OID.timestamp), '2024-03-09 13:02:03', 'the T a stored timestamp has is read as a space');
});

test('interval: months, days and microseconds as PostgreSQL\'s default interval text', () => {
  const cases: [bigint, number, number, string][] = [
    [0n, 0, 0, '00:00:00'],
    [14_706_500_000n, 3, 14, '1 year 2 mons 3 days 04:05:06.5'],
    [7_380_000_000n, -1, 0, '-1 days +02:03:00'],
    [-14_706_000_000n, 3, -14, '-1 years -2 mons +3 days -04:05:06'],
    [0n, 1, 1, '1 mon 1 day'],
    [-1n, 0, 0, '-00:00:00.000001'],
    [0n, 0, 12, '1 year'],
    [0x7fffffffffffffffn, 0x7fffffff, 0x7fffffff, '178956970 years 7 mons 2147483647 days 2562047788:00:54.775807'],
  ];
  for (const [micros, days, months, text] of cases) assert.equal(binaryParam(encodeInterval({ micros, days, months }), OID.interval), text, text);
  assert.equal(code(() => binaryParam(Buffer.alloc(15), OID.interval)), '08P01');
  assert.equal(code(() => binaryParam(Buffer.alloc(17), OID.interval)), '22P03');
  assert.equal(code(() => binaryValue('1 day', OID.interval)), '0A000', 'no column is an interval, so none is written');
});

test('arrays: the text form a client would have sent, with quoting, NULL, bounds and dimensions', () => {
  assert.equal(binaryParam(encodeArray([1, -2, null, 2147483647], OID.int4), 1007), '{1,-2,NULL,2147483647}');
  assert.equal(binaryParam(encodeArray([], OID.int4), 1007), '{}');
  assert.equal(binaryParam(encodeArray([], OID.text), 1009), '{}');
  assert.equal(binaryParam(encodeArray(['plain', 'a b', '', 'NULL', 'null', 'x"y', 'back\\slash', '{}', 'a,b', 'é'], OID.text), 1009),
    '{plain,"a b","","NULL","null","x\\"y","back\\\\slash","{}","a,b",é}');
  assert.equal(binaryParam(encodeArray([1, 0], OID.bool), 1000), '{t,f}');
  assert.equal(binaryParam(encodeArray(['-1.50', '$3750'], OID.numeric), 1231), '{-1.50,NULL}', 'a number field holding no number is NULL');
  const numerics = ['-1.50', 'NaN', 'Infinity'].map((t) => { const b = encodeNumeric(t); return Buffer.concat([i32(b.length), b]); });
  assert.equal(binaryParam(Buffer.concat([i32(1), i32(0), i32(OID.numeric), i32(3), i32(1), ...numerics]), 1231), '{-1.50,NaN,Infinity}');
  assert.equal(binaryParam(encodeArray([raw(0x7fffffffffffffffn)], OID.int8), 1016), '{9223372036854775807}', 'int8 elements are exact');
  assert.equal(binaryParam(encodeArray([0.1, -0, 1e-7, Number.NaN], OID.float8), 1022), '{0.1,-0,1e-07,NaN}');
  assert.equal(binaryParam(encodeArray([0.1], OID.float4), 1021), '{0.1}');
  assert.equal(binaryParam(encodeArray(['2024-03-09 00:30:00'], OID.timestamp), 1115), '{"2024-03-09 00:30:00"}');
  assert.equal(binaryParam(encodeArray([raw(new Uint8Array([1, 255]))], OID.bytea), 1001), '{"\\\\x01ff"}');
  assert.equal(binaryParam(encodeArray([16, 17, 4294967295], OID.oid), 1028), '{16,17,4294967295}', 'oid[] as asyncpg sends it to load types');
  assert.equal(binaryParam(encodeArray(['0123abcd-4567-89ef-0123-456789abcdef'], OID.uuid), 2951), '{0123abcd-4567-89ef-0123-456789abcdef}');
  // Two dimensions and a lower bound other than 1, built by hand.
  const elements = [1, 2, 3, 4].map((n) => Buffer.concat([i32(4), i32(n)]));
  const twoByTwo = Buffer.concat([i32(2), i32(0), i32(OID.int4), i32(2), i32(1), i32(2), i32(1), ...elements]);
  assert.equal(binaryParam(twoByTwo, 1007), '{{1,2},{3,4}}');
  const fromZero = Buffer.concat([i32(1), i32(0), i32(OID.int4), i32(2), i32(0), ...elements.slice(0, 2)]);
  assert.equal(binaryParam(fromZero, 1007), '[0:1]={1,2}');
  // Every array type the server knows decodes its own empty array.
  for (const [array, element] of Object.entries(ARRAY_ELEMENT)) assert.equal(binaryParam(encodeArray([], element), Number(array)), '{}', array);
});

test('arrays: malformed headers, counts and elements are refused with PostgreSQL\'s codes', () => {
  const head = (ndim: number, flags: number, element: number, ...dims: number[]) => Buffer.concat([i32(ndim), i32(flags), i32(element), ...dims.map(i32)]);
  const one = Buffer.concat([i32(4), i32(1)]);
  assert.equal(code(() => binaryParam(Buffer.alloc(11), 1007)), '08P01', 'short header');
  assert.equal(code(() => binaryParam(head(-1, 0, OID.int4), 1007)), '22P03', 'negative dimensions');
  assert.equal(code(() => binaryParam(head(7, 0, OID.int4), 1007)), '54000', 'too many dimensions');
  assert.equal(code(() => binaryParam(head(1, 2, OID.int4, 1, 1), 1007)), '22P03', 'bad flags');
  assert.equal(code(() => binaryParam(Buffer.concat([head(1, 0, OID.text, 1, 1), one]), 1007)), '42804', 'wrong element type');
  assert.equal(code(() => binaryParam(head(1, 0, OID.int4, -1, 1), 1007)), '22P03', 'negative size');
  assert.equal(code(() => binaryParam(head(1, 0, OID.int4, 2, 0x7fffffff), 1007)), '54000', 'upper bound past int4');
  // A billion elements claimed with one present: refused before any is read, so it cannot take time or memory.
  const started = performance.now();
  assert.equal(code(() => binaryParam(Buffer.concat([head(2, 0, OID.int4, 40000, 1, 40000, 1), one]), 1007)), '08P01');
  assert.ok(performance.now() - started < 100);
  assert.equal(code(() => binaryParam(Buffer.concat([head(1, 0, OID.int4, 1, 1), i32(-2)]), 1007)), '08P01', 'element length below -1');
  assert.equal(code(() => binaryParam(Buffer.concat([head(1, 0, OID.int4, 1, 1), i32(8), i32(1)]), 1007)), '08P01', 'element longer than the message');
  assert.equal(code(() => binaryParam(Buffer.concat([head(1, 0, OID.int4, 1, 1), i32(2), Buffer.alloc(2)]), 1007)), '08P01', 'element shorter than its type');
  assert.equal(code(() => binaryParam(Buffer.concat([head(1, 0, OID.int4, 1, 1), one, Buffer.alloc(1)]), 1007)), '22P03', 'bytes after the last element');
  assert.equal(code(() => binaryParam(Buffer.concat([head(0, 0, OID.int4), Buffer.alloc(1)]), 1007)), '22P03', 'bytes after an empty array');
});

test('types with no binary form here: parameters say so (undefined), results refuse rather than write text bytes', () => {
  assert.equal(binaryParam(Buffer.alloc(16), 600), undefined, 'point');
  assert.equal(binaryParam(Buffer.alloc(8), 1266), undefined, 'timetz');
  assert.equal(code(() => binaryValue('x', 600)), '0A000');
});

test('casts name parameter types, arrays included', () => {
  assert.deepEqual([...castParamTypes('SELECT * FROM t WHERE a < $1::numeric AND b = $2 :: date AND c = $3::double precision')], [[1, 1700], [2, 1082], [3, 701]]);
  // Before: $1::int4[] was described as int4, so a binary driver sent one integer for a list.
  assert.deepEqual([...castParamTypes('SELECT 1 WHERE x = ANY($1::int4[]) AND t.oid = any($2::oid[]) AND k = $3::uuid AND j = $4::jsonb AND d < $5::interval AND n = ANY($6::text [ ])')],
    [[1, 1007], [2, 1028], [3, 2950], [4, 3802], [5, 1186], [6, 1009]]);
  assert.deepEqual([...castParamTypes("SELECT '$1::int4' AS a, $1::point")], [], 'a cast inside a string, or to a type with no binary form, names nothing');
});

test('arrays: what a parameter expands to is capped, so a ten-kilobyte Bind cannot become ninety megabytes', () => {
  const numericArray = (count: number, weight: number, dscale = 0) => {
    const value = Buffer.concat([be(8, (b) => { b.writeUInt16BE(1, 0); b.writeInt16BE(weight, 2); b.writeUInt16BE(dscale, 6); }), be(2, (b) => b.writeInt16BE(1))]);
    const element = Buffer.concat([i32(value.length), value]);
    return Buffer.concat([i32(1), i32(0), i32(OID.numeric), i32(count), i32(1), ...Array.from({ length: count }, () => element)]);
  };
  // The reviewer's shape: 707 numerics at weight 32767 in 9,918 bytes, which read as a 92,668,612-character string.
  const reviewer = numericArray(707, 0x7fff);
  assert.equal(reviewer.length, 9918);
  let started = performance.now();
  assert.equal(code(() => binaryParam(reviewer, 1231)), '22003');
  assert.ok(performance.now() - started < 100, `${performance.now() - started} ms`);
  // Each element under the digit cap, together far past what the message could hold: refused by the budget.
  const wide = numericArray(707, 249);
  started = performance.now();
  assert.equal(code(() => binaryParam(wide, 1231)), '54000');
  // The smallest weight with the largest scale: 16,385 characters from ten bytes, each.
  assert.equal(code(() => binaryParam(numericArray(707, -0x8000, 0x3fff), 1231)), '54000');
  assert.ok(performance.now() - started < 250, `${performance.now() - started} ms`);
  // The budget is shared by every parameter of one Bind.
  const shared = { left: 10_000, total: 10_000 };
  assert.equal(String(binaryParam(numericArray(4, 249), 1231, shared)).length, 4 * 997 + 5);
  assert.equal(code(() => binaryParam(numericArray(8, 249), 1231, shared)), '54000');
  // What real lists need still reads: 100,000 int4 and a megabyte of text, each well within four characters per byte.
  const ints = encodeArray(Array.from({ length: 100_000 }, (_, i) => -2147483648 + i), OID.int4);
  assert.equal(String(binaryParam(ints, 1007)).length, 100_000 * 12 + 1);
  const texts = encodeArray(Array.from({ length: 1000 }, () => 'q"'.repeat(500)), OID.text);
  assert.equal(String(binaryParam(texts, 1009)).length, 1000 * (1500 + 3) + 1);
});

test('seeded random bytes in every type: a value or a BinaryFormatError, nothing else, quickly', () => {
  const r = random(21);
  const oids = [...Object.values(OID), ...Object.keys(ARRAY_ELEMENT).map(Number)];
  const started = performance.now();
  for (let i = 0; i < 20_000; i++) {
    const oid = oids[r(oids.length)];
    const len = [0, 1, 2, 3, 4, 7, 8, 9, 12, 15, 16, 17, 20, 24, 40, r(200)][r(16)];
    const b = Buffer.from(Array.from({ length: len }, () => r(256)));
    // Array headers that name the right element type, so the element readers are reached too.
    if (ARRAY_ELEMENT[oid] !== undefined && len >= 12 && r(2)) b.writeUInt32BE(ARRAY_ELEMENT[oid], 8);
    if (ARRAY_ELEMENT[oid] !== undefined && len >= 12 && r(2)) b.writeInt32BE(r(3), 0);
    try { binaryParam(b, oid); } catch (e) { assert.ok(e instanceof BinaryFormatError, `${oid} ${b.toString('hex')}: ${(e as Error).stack}`); }
  }
  assert.ok(performance.now() - started < 10_000);
});
