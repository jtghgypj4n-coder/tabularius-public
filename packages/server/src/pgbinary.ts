// PostgreSQL's binary format for values, for clients that ask for it: asyncpg
// and Npgsql use it for every value whose type they know, and psycopg and
// pgjdbc can. Results come in the column types the Postgres wire server
// describes (text, numeric, bool, bytea); parameters come in the types the
// client named at Parse (or a cast in the query names), and are read into the
// value the text format gives, so a query sees the same thing whichever format
// the client picked. Booleans are the exception: 1 or 0, as FileMaker keeps them.

import { maskSql } from '../../store/src/sql-tokens.ts';
import type { SqlValue } from '../../store/src/find.ts';

export const BINARY_OID = {
  bool: 16, bytea: 17, name: 19, int8: 20, int2: 21, int4: 23, text: 25, oid: 26, float4: 700, float8: 701,
  unknown: 705, bpchar: 1042, varchar: 1043, date: 1082, time: 1083, timestamp: 1114, timestamptz: 1184, numeric: 1700,
  uuid: 2950, jsonb: 3802,
} as const;

const NUMERIC_POS = 0x0000;
const NUMERIC_NEG = 0x4000;
const NUMERIC_NAN = 0xc000;

/** A plain decimal string ("-12.5", never exponent notation) for a number field's value; undefined when it holds no number. */
export function decimalText(v: unknown): string | undefined {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? expand(String(v)) : undefined;
  const s = String(v).trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? expand(s) : undefined;
}

/** "1.5e-7" -> "0.00000015", "1e+21" -> "1000000000000000000000". */
function expand(s: string): string {
  const m = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  if (!m) return s;
  const [, sign, int, frac, exp] = m;
  let digits = (int || '') + (frac || '');
  let point = (int || '').length + Number(exp ?? 0);
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0';
  const rest = digits.slice(point);
  return `${sign === '-' ? '-' : ''}${whole}${rest ? '.' + rest : ''}`;
}

/** numeric's binary form: digit count, weight, sign and display scale, then base-10000 digits. */
export function encodeNumeric(text: string): Buffer {
  const neg = text.startsWith('-');
  const [int, frac = ''] = text.replace(/^[+-]/, '').split('.');
  const dscale = frac.length;
  const intPadded = int.padStart(Math.ceil(int.length / 4) * 4, '0');
  const fracPadded = frac.padEnd(Math.ceil(frac.length / 4) * 4, '0');
  const groups: number[] = [];
  for (let i = 0; i < intPadded.length; i += 4) groups.push(Number(intPadded.slice(i, i + 4)));
  let weight = groups.length - 1;
  for (let i = 0; i < fracPadded.length; i += 4) groups.push(Number(fracPadded.slice(i, i + 4)));
  while (groups.length && groups[0] === 0) {
    groups.shift();
    weight--;
  }
  while (groups.length && groups[groups.length - 1] === 0) groups.pop();
  if (!groups.length) weight = 0;
  const out = Buffer.alloc(8 + groups.length * 2);
  out.writeInt16BE(groups.length, 0);
  out.writeInt16BE(weight, 2);
  out.writeUInt16BE(groups.length && neg ? NUMERIC_NEG : NUMERIC_POS, 4);
  out.writeInt16BE(dscale, 6);
  groups.forEach((g, i) => out.writeInt16BE(g, 8 + i * 2));
  return out;
}

export function decodeNumeric(b: Buffer): string {
  const n = b.readInt16BE(0);
  const weight = b.readInt16BE(2);
  const sign = b.readUInt16BE(4);
  const dscale = b.readInt16BE(6);
  if (sign === NUMERIC_NAN) return 'NaN';
  const groups = Array.from({ length: n }, (_, i) => b.readInt16BE(8 + i * 2));
  let int = '';
  for (let w = weight; w >= 0; w--) {
    const g = groups[weight - w] ?? 0;
    int += int ? String(g).padStart(4, '0') : String(g);
  }
  let frac = '';
  for (let i = Math.max(0, weight + 1); i < n; i++) frac += String(groups[i]).padStart(4, '0');
  if (weight < -1) frac = '0'.repeat((-weight - 1) * 4) + frac;
  frac = frac.padEnd(dscale, '0').slice(0, dscale);
  return `${sign === NUMERIC_NEG ? '-' : ''}${int || '0'}${frac ? '.' + frac : ''}`;
}

/** A result value in the binary format of its column's type; null for SQL NULL (or a number field holding no number). */
export function binaryValue(value: SqlValue, oid: number): Buffer | null {
  const v = value as unknown;
  if (v === null || v === undefined) return null;
  switch (oid) {
    case BINARY_OID.bool: return Buffer.from([v === 0 || v === 0n || v === '0' || v === 'f' || v === false ? 0 : 1]);
    case BINARY_OID.int8: {
      const n = BigInt(String(v));
      const out = Buffer.alloc(8);
      out.writeBigInt64BE(n);
      return out;
    }
    case BINARY_OID.uuid: return Buffer.from(String(v).replace(/-/g, ''), 'hex');
    case BINARY_OID.jsonb: return Buffer.concat([Buffer.from([1]), Buffer.from(String(v), 'utf8')]);
    case BINARY_OID.bytea: return Buffer.from(v instanceof Uint8Array ? v : Buffer.from(String(v), 'utf8'));
    case BINARY_OID.numeric: {
      const t = decimalText(v);
      return t === undefined ? null : encodeNumeric(t);
    }
    default: return Buffer.from(String(v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : v), 'utf8');
  }
}

const EPOCH_2000 = Date.UTC(2000, 0, 1);

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A parameter sent in the binary format, as the value its text format would give; undefined for a type it can't read. */
export function binaryParam(b: Buffer, oid: number): SqlValue | undefined {
  switch (oid) {
    case BINARY_OID.bool: return b[0] ? 1 : 0;
    case BINARY_OID.int2: return b.readInt16BE(0);
    case BINARY_OID.int4: case BINARY_OID.oid: return oid === BINARY_OID.oid ? b.readUInt32BE(0) : b.readInt32BE(0);
    // Numbers as the text format reads them (Number of the text), so both formats find the same rows.
    case BINARY_OID.int8: return Number(b.readBigInt64BE(0));
    case BINARY_OID.float4: return b.readFloatBE(0);
    case BINARY_OID.float8: return b.readDoubleBE(0);
    case BINARY_OID.numeric: {
      const t = decodeNumeric(b);
      return t === 'NaN' ? 'NaN' : Number(t);
    }
    case BINARY_OID.bytea: return '\\x' + b.toString('hex');
    case BINARY_OID.date: {
      const d = new Date(EPOCH_2000 + b.readInt32BE(0) * 86_400_000);
      return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    case BINARY_OID.time: {
      const us = Number(b.readBigInt64BE(0));
      const s = Math.floor(us / 1_000_000);
      const frac = us % 1_000_000;
      return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}${frac ? '.' + pad(frac, 6).replace(/0+$/, '') : ''}`;
    }
    case BINARY_OID.timestamp: case BINARY_OID.timestamptz: {
      const us = b.readBigInt64BE(0);
      const ms = Number(us / 1000n);
      const d = new Date(EPOCH_2000 + ms);
      const frac = Number(us % 1_000_000n);
      return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${frac ? '.' + pad(frac, 6).replace(/0+$/, '') : ''}`;
    }
    case 0: case BINARY_OID.text: case BINARY_OID.varchar: case BINARY_OID.bpchar: case BINARY_OID.name: case BINARY_OID.unknown:
      return b.toString('utf8');
    default:
      return undefined;
  }
}

const CAST_TYPES: Record<string, number> = {
  int2: BINARY_OID.int2, smallint: BINARY_OID.int2, int4: BINARY_OID.int4, int: BINARY_OID.int4, integer: BINARY_OID.int4,
  int8: BINARY_OID.int8, bigint: BINARY_OID.int8, float4: BINARY_OID.float4, real: BINARY_OID.float4,
  float8: BINARY_OID.float8, 'double precision': BINARY_OID.float8, numeric: BINARY_OID.numeric, decimal: BINARY_OID.numeric,
  bool: BINARY_OID.bool, boolean: BINARY_OID.bool, date: BINARY_OID.date, time: BINARY_OID.time,
  timestamp: BINARY_OID.timestamp, timestamptz: BINARY_OID.timestamptz, text: BINARY_OID.text, varchar: BINARY_OID.varchar, bytea: BINARY_OID.bytea,
};

/**
 * Parameter types a query names with a cast ($1::numeric), by position, for
 * the ones its Parse left unspecified: Describe tells the client these, so a
 * driver that encodes by type (asyncpg) sends a Decimal or a date as such.
 */
export function castParamTypes(sql: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of maskSql(sql).matchAll(/\$(\d+)\s*::\s*(double\s+precision|[a-z][a-z0-9]*)/gi)) {
    const oid = CAST_TYPES[m[2].toLowerCase().replace(/\s+/g, ' ')];
    if (oid && !out.has(Number(m[1]))) out.set(Number(m[1]), oid);
  }
  return out;
}
