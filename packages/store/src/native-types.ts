import type { FieldType } from '../../fmp12/src/index.ts';

/** Native scalar syntax. undefined means the value is invalid. Empty values are handled by Store. */
export function nativeValue(value: string, type: FieldType): string | number | undefined {
  const v = value.trim();
  switch (type) {
    case 'boolean': return /^(true|1)$/i.test(v) ? 1 : /^(false|0)$/i.test(v) ? 0 : undefined;
    case 'integer': {
      if (!/^[+-]?\d+$/.test(v)) return undefined;
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : undefined;
    }
    case 'decimal': {
      const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(v);
      if (!m || ((m[3] ?? m[4])?.length ?? 0) > 30 || (m[2] ?? '0').length > 1000) return undefined;
      const whole = (m[2] ?? '0').replace(/^0+(?=\d)/, '');
      const fraction = (m[3] ?? m[4] ?? '').replace(/0+$/, '');
      const zero = whole === '0' && !fraction;
      return `${m[1] === '-' && !zero ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
    }
    case 'json': {
      if (Buffer.byteLength(v, 'utf8') > 1024 * 1024) throw new Error('JSON size exceeds 1 MiB');
      try { return canonicalJson(v); } catch (e) {
        if (e instanceof RangeError || /depth|stack/i.test(String(e))) throw new Error('JSON depth exceeds the supported limit', { cause: e });
        return undefined;
      }
    }
    case 'uuid': return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : undefined;
    default: return undefined;
  }
}

/** JSON parser that keeps numeric lexemes intact and rejects duplicate decoded keys. */
export function canonicalJson(input: string): string {
  JSON.parse(input); // Full grammar validation; the scanner below preserves number tokens.
  let i = 0;
  const scalar = /(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/y;
  let depth = 0;
  const ws = () => { while (/\s/.test(input[i] ?? '') && i < input.length) i++; };
  const string = (): string => {
    const start = i++;
    while (i < input.length) {
      if (input[i] === '\\') { i += 2; continue; }
      if (input[i++] === '"') return JSON.stringify(JSON.parse(input.slice(start, i)) as string);
    }
    throw new Error('Unclosed string');
  };
  const value = (): string => {
    if (++depth > 64) throw new Error('JSON depth exceeds 64 levels');
    try {
    ws();
    if (input[i] === '"') return string();
    if (input[i] === '[') {
      i++; ws();
      const items: string[] = [];
      if (input[i] !== ']') for (;;) {
        items.push(value()); ws();
        if (input[i] !== ',') break;
        i++;
      }
      if (input[i++] !== ']') throw new Error('Invalid array');
      return `[${items.join(',')}]`;
    }
    if (input[i] === '{') {
      i++; ws();
      const entries: [string, string][] = [];
      const seen = new Set<string>();
      if (input[i] !== '}') for (;;) {
        ws();
        if (input[i] !== '"') throw new Error('Invalid key');
        const key = string();
        if (seen.has(key)) throw new Error('Duplicate key');
        seen.add(key); ws();
        if (input[i++] !== ':') throw new Error('Missing colon');
        entries.push([key, value()]); ws();
        if (input[i] !== ',') break;
        i++;
      }
      if (input[i++] !== '}') throw new Error('Invalid object');
      entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      return `{${entries.map(([k, x]) => `${k}:${x}`).join(',')}}`;
    }
    scalar.lastIndex = i;
    const token = scalar.exec(input)?.[0];
    if (!token) throw new Error('Invalid value');
    i += token.length;
    return token;
    } finally { depth--; }
  };
  const result = value(); ws();
  if (i !== input.length) throw new Error('Trailing input');
  return result;
}

/** A JSON number is only accepted as decimal when its shortest text has at most 15 significant digits. */
export function safeDecimalNumber(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (Number.isSafeInteger(value)) return true;
  const shortest = String(value);
  const digits = shortest.split(/[eE]/)[0].replace(/^[+-]/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  return digits.length <= 15;
}

export function decimalNumberText(value: number): string | undefined {
  if (!safeDecimalNumber(value)) return undefined;
  const s = String(value);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
  if (!m) return s;
  const digits = m[2] + (m[3] ?? '');
  const point = m[2].length + Number(m[4]);
  if (point < -30 || point > 1000) return undefined;
  return m[1] + (point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`);
}

/** Fixed width decimal sort key, with inverted digits for negative values. */
export function decimalKey(value: string | number | null): string | null {
  if (value === null) return null;
  const canonical = nativeValue(String(value), 'decimal');
  if (typeof canonical !== 'string') return null;
  const negative = canonical.startsWith('-');
  const [whole, fraction = ''] = (negative ? canonical.slice(1) : canonical).split('.');
  const count = String(whole.length).padStart(4, '0');
  const digits = `${whole}.${fraction.padEnd(30, '0')}`;
  const invert = (s: string) => s.replace(/\d/g, (d) => String(9 - Number(d)));
  return negative ? `0${invert(count)}${invert(digits)}` : `1${count}${digits}`;
}
