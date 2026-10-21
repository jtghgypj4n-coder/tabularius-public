// Fixed-point decimal arithmetic for SetPrecision. All intermediates have guard
// digits; only the result crossing the SetPrecision boundary is rounded.
import { EMPTY, asNumberOrEmpty, isEmpty, num, type Value } from './values.ts';

// Decimal work is synchronous. Keep the enclosing evaluation's clock active
// through nested operations, and restore it after each SetPrecision call.
let checkBudget: (() => void) | undefined;
export function withDecimalBudget<T>(check: () => void, work: () => T): T {
  const previous = checkBudget;
  checkBudget = check;
  try { return work(); } finally { checkBudget = previous; }
}

const DECIMAL_FUNCTIONS = new Set(['abs','ceiling','floor','int','round','truncate','mod','div','sign','sqrt','exp','ln','log','lg','factorial','combination','sum','average','min','max','count','variance','variancep','stdev','stdevp','pmt','fv','pv','degrees','radians']);
export const supportsDecimalFunction = (name: string): boolean => DECIMAL_FUNCTIONS.has(name.toLowerCase());

/** Same text-to-number rules as numberFromText, retaining every decimal digit. */
export function decimalNumberText(s: string): string | undefined {
  let digits = '', point = false, neg = false, seenDigit = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { digits += ch; seenDigit = true; }
    else if (ch === '.' && !point) { digits += '.'; point = true; }
    else if ((ch === '-' || ch === '(') && !seenDigit && !point) neg = true;
  }
  return seenDigit ? `${neg ? '-' : ''}${digits}` : undefined;
}

export class Decimal {
  readonly n: bigint;
  readonly scale: bigint;
  readonly places: number;
  constructor(n: bigint, places: number) {
    // Keep the existing literal boundary (1e399 is out of range) for results
    // from arithmetic too. Guard digits extend precision, not magnitude.
    if ((n < 0n ? -n : n).toString().length > places + 399) throw new RangeError('Decimal result is too large');
    this.n = n;
    this.places = places;
    this.scale = 10n ** BigInt(places);
  }
  static parse(s: string, places: number): Decimal {
    const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(s);
    if (!m || !(m[2] || m[3])) return new Decimal(0n, places);
    const significant = ((m[2] || '0') + (m[3] ?? '')).replace(/^0+/, '');
    if (!significant) return new Decimal(0n, places);
    const exponent = BigInt(m[4] ?? 0);
    const fractionalDigits = BigInt(m[3]?.length ?? 0);
    const order = exponent - fractionalDigits + BigInt(significant.length - 1);
    if (order >= 399n) throw new RangeError('Decimal result is too large');
    if (order < -BigInt(places) - 1n) return new Decimal(0n, places);
    const digits = BigInt(significant);
    const shift = BigInt(places) + exponent - fractionalDigits;
    const magnitude = shift >= 0n ? digits * 10n ** shift : quotient(digits, 10n ** -shift);
    return new Decimal(m[1] === '-' ? -magnitude : magnitude, places);
  }
  static value(v: Value, places: number): Decimal {
    if (v.type === 'number' && !Number.isFinite(v.value) && v.decimal === undefined) throw new RangeError('Nonfinite decimal value');
    const source = v.type === 'number' ? v.decimal ?? v.exact?.toString() ?? String(v.value)
      : v.type === 'text' || v.type === 'container' ? decimalNumberText(v.value) ?? '0'
      : String(v.value);
    return Decimal.parse(source, places);
  }
  static pi(places: number): Decimal {
    const scale = 10n ** BigInt(places);
    const atanInverse = (divisor: bigint): bigint => {
      const square = divisor * divisor;
      let power = scale / divisor, sum = power;
      for (let k = 3n, sign = -1n; power !== 0n; k += 2n, sign = -sign) {
        checkBudget?.();
        power /= square;
        const term = power / k;
        if (term === 0n) break;
        sum += sign * term;
      }
      return sum;
    };
    return new Decimal(16n * atanInverse(5n) - 4n * atanInverse(239n), places);
  }
  with(n: bigint): Decimal { return new Decimal(n, this.places); }
  add(b: Decimal): Decimal { return this.with(this.n + b.n); }
  sub(b: Decimal): Decimal { return this.with(this.n - b.n); }
  mul(b: Decimal): Decimal { return this.with(quotient(this.n * b.n, this.scale)); }
  div(b: Decimal): Decimal { checkBudget?.(); if (b.n === 0n) throw new RangeError('Division by zero'); return this.with(quotient(this.n * this.scale, b.n)); }
  trunc(): Decimal { return this.with(this.n / this.scale * this.scale); }
  floor(): Decimal { return this.with((this.n >= 0n || this.n % this.scale === 0n ? this.n / this.scale : this.n / this.scale - 1n) * this.scale); }
  ceil(): Decimal { return this.with((this.n <= 0n || this.n % this.scale === 0n ? this.n / this.scale : this.n / this.scale + 1n) * this.scale); }
  integer(): bigint { return this.n / this.scale; }
  powInteger(k: bigint): Decimal {
    // Invert first: a large negative power may underflow even when its
    // positive counterpart would exceed the magnitude limit.
    let result = this.with(this.scale);
    let base: Decimal = k < 0n ? result.div(this) : this;
    let power = k < 0n ? -k : k;
    while (power) { checkBudget?.(); if (power & 1n) result = result.mul(base); power >>= 1n; if (power) base = base.mul(base); }
    return result;
  }
  sqrt(): Decimal {
    if (this.n < 0n) throw new RangeError('Square root of a negative number');
    if (this.n === 0n) return this;
    const target = this.n * this.scale;
    let x = 1n << BigInt(Math.ceil(target.toString(2).length / 2));
    for (;;) { checkBudget?.(); const next = (x + target / x) / 2n; if (next >= x) return this.with(x); x = next; }
  }
  exp(): Decimal {
    if (this.n > this.scale * 1000n) throw new RangeError('Decimal result is too large');
    if (this.n < -this.scale * 10000n) return this.with(0n);
    let x: Decimal = this, halves = 0;
    const two = this.with(2n * this.scale);
    while ((x.n < 0n ? -x.n : x.n) > this.scale) { x = x.div(two); halves++; }
    let sum = this.with(this.scale), term = sum;
    for (let i = 1; i < this.places * 4 + 100; i++) {
      term = term.mul(x).div(this.with(BigInt(i) * this.scale));
      if (term.n === 0n) break;
      sum = sum.add(term);
    }
    while (halves--) { checkBudget?.(); sum = sum.mul(sum); }
    return sum;
  }
  ln(): Decimal {
    if (this.n <= 0n) throw new RangeError('Logarithm of a nonpositive number');
    let x: Decimal = this, roots = 0;
    const one = this.with(this.scale);
    // Repeated square roots make the atanh series converge quickly.
    while ((x.n > this.scale * 11n / 10n || x.n < this.scale * 9n / 10n) && roots < 32) { x = x.sqrt(); roots++; }
    const z = x.sub(one).div(x.add(one));
    const z2 = z.mul(z);
    let term = z, sum = z;
    for (let k = 3; k < this.places * 4 + 100; k += 2) {
      term = term.mul(z2);
      const part = term.div(this.with(BigInt(k) * this.scale));
      if (part.n === 0n) break;
      sum = sum.add(part);
    }
    return sum.mul(this.with((2n << BigInt(roots)) * this.scale));
  }
  pow(b: Decimal): Decimal {
    if (b.n % this.scale === 0n) return this.powInteger(b.integer());
    if (this.n === 0n && b.n > 0n) return this;
    return this.ln().mul(b).exp();
  }
  string(places = this.places): string {
    const shift = this.places - places;
    const n = shift > 0 ? quotient(this.n, 10n ** BigInt(shift)) : this.n;
    const scale = 10n ** BigInt(places);
    const abs = n < 0n ? -n : n;
    const fraction = (abs % scale).toString().padStart(places, '0').replace(/0+$/, '');
    return `${n < 0n ? '-' : ''}${abs / scale}${fraction ? '.' + fraction : ''}`;
  }
  value(places = this.places): Value {
    const decimal = this.string(places);
    return { type: 'number', value: Number(decimal), decimal };
  }
}

function quotient(a: bigint, b: bigint): bigint {
  const neg = (a < 0n) !== (b < 0n);
  const x = a < 0n ? -a : a, y = b < 0n ? -b : b;
  const q = (x + y / 2n) / y;
  return neg ? -q : q;
}

/** Only Claris's nontrigonometric numeric functions are handled here. */
export function decimalFunction(name: string, values: Value[], places: number): Value | undefined {
  const key = name.toLowerCase();
  if (!DECIMAL_FUNCTIONS.has(key)) return undefined;
  const aggregate = ['sum','average','min','max','count','variance','variancep','stdev','stdevp'].includes(key);
  if (!aggregate && values.length && asNumberOrEmpty(values[0]) === undefined) return EMPTY;
  try {
    if (key === 'count') return Decimal.parse(String(values.filter((v) => !isEmpty(v)).length), places).value();
    const eligible = aggregate ? values.filter((v) => !isEmpty(v) && asNumberOrEmpty(v) !== undefined) : values;
    const ds = eligible.map((v) => Decimal.value(v, places));
    const zero = Decimal.parse('0', places), one = Decimal.parse('1', places);
    const a = ds[0] ?? zero, b = ds[1] ?? zero, c = ds[2] ?? zero;
    let r: Decimal;
    switch (key) {
      case 'abs': r = a.with(a.n < 0n ? -a.n : a.n); break;
      case 'ceiling': r = a.ceil(); break;
      case 'floor': r = a.floor(); break;
      case 'int': r = a.trunc(); break;
      case 'round': case 'truncate': {
        const p = Number(b.integer());
        if (!Number.isSafeInteger(p) || Math.abs(p) > 1000) return num(NaN);
        const factor = 10n ** BigInt(Math.abs(places - p));
        const n = p <= places ? key === 'round' ? quotient(a.n, factor) * factor : a.n / factor * factor : a.n;
        r = a.with(n); break;
      }
      case 'div': r = a.div(b).floor(); break;
      case 'mod': r = a.sub(b.mul(a.div(b).floor())); break;
      case 'sign': r = Decimal.parse(a.n < 0n ? '-1' : a.n > 0n ? '1' : '0', places); break;
      case 'sqrt': r = a.sqrt(); break;
      case 'exp': r = a.exp(); break;
      case 'ln': r = a.ln(); break;
      case 'log': r = a.ln().div(Decimal.parse('10', places).ln()); break;
      case 'lg': r = a.ln().div(Decimal.parse('2', places).ln()); break;
      case 'factorial': {
        const n = a.integer(), stop = b.n ? n - b.integer() : 0n;
        if (n < 0n || n > 1000n) return num(NaN);
        r = one; for (let i = n; i > stop; i--) r = r.mul(Decimal.parse(String(i), places)); break;
      }
      case 'combination': {
        const n = a.integer(), k = b.integer();
        if (n < 0n || k < 0n || k > n || n > 1000n) return num(NaN);
        r = one; for (let i = 1n; i <= k; i++) r = r.mul(Decimal.parse(String(n-k+i), places)).div(Decimal.parse(String(i), places)); break;
      }
      case 'sum': case 'average': {
        if (key === 'average' && !ds.length) return EMPTY;
        r = ds.reduce((acc, d) => acc.add(d), zero);
        if (key === 'average') r = r.div(Decimal.parse(String(ds.length), places)); break;
      }
      case 'min': case 'max': {
        if (!ds.length) return EMPTY;
        r = ds.reduce((acc, d) => key === 'min' ? (d.n < acc.n ? d : acc) : (d.n > acc.n ? d : acc)); break;
      }
      case 'variance': case 'variancep': case 'stdev': case 'stdevp': {
        if (!ds.length) return EMPTY;
        const sample = key === 'variance' || key === 'stdev';
        if (sample && ds.length === 1) return num(NaN);
        const mean = ds.reduce((acc, d) => acc.add(d), zero).div(Decimal.parse(String(ds.length), places));
        r = ds.reduce((acc, d) => acc.add(d.sub(mean).mul(d.sub(mean))), zero)
          .div(Decimal.parse(String(ds.length - (sample ? 1 : 0)), places));
        if (key === 'stdev' || key === 'stdevp') r = r.sqrt();
        break;
      }
      case 'pmt': r = b.n === 0n ? a.div(c) : a.mul(b).div(one.sub(one.add(b).pow(c.with(-c.n)))); break;
      case 'fv': r = b.n === 0n ? a.mul(c) : a.mul(one.add(b).pow(c).sub(one)).div(b); break;
      case 'pv': r = b.n === 0n ? a.mul(c) : a.mul(one.sub(one.add(b).pow(c.with(-c.n)))).div(b); break;
      case 'degrees': r = a.mul(Decimal.parse('180', places)).div(Decimal.pi(places)); break;
      case 'radians': r = a.mul(Decimal.pi(places)).div(Decimal.parse('180', places)); break;
      default: return undefined;
    }
    return r.value();
  } catch (e) { if (e instanceof RangeError) return num(NaN); throw e; }
}
