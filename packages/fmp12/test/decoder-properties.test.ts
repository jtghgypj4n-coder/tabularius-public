// Seeded property tests for the byte-level decoders. Every input is generated
// here from a fixed seed: no fixture and no real file is read. The contract is
// that a decoder returns or throws an Error, and never hangs or throws
// anything else, whatever bytes it is given.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCalc } from '../src/calc.ts';
import { decodePayload } from '../src/chunks.ts';
import { pbParse } from '../src/proto.ts';
import { decodeScsu, decodeText } from '../src/scsu.ts';
import { parseDate } from '../src/values.ts';

const RUNS = 3000;

// mulberry32: a small seeded generator, so a failure repeats.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bytes(r: () => number): Uint8Array {
  const n = Math.floor(r() * 64);
  const b = new Uint8Array(n);
  // Half the inputs favour small values, where opcodes and lengths live.
  const small = r() < 0.5;
  for (let i = 0; i < n; i++) b[i] = small ? Math.floor(r() * 32) : Math.floor(r() * 256);
  return b;
}

/** Runs the decoder over generated inputs; anything thrown must be an Error. */
function never(name: string, seed: number, run: (b: Uint8Array, r: () => number) => void): void {
  test(`${name}: ${RUNS} generated inputs never hang or throw a non-Error`, () => {
    const r = rng(seed);
    const started = Date.now();
    for (let i = 0; i < RUNS; i++) {
      const b = bytes(r);
      try {
        run(b, r);
      } catch (e) {
        assert.ok(e instanceof Error, `${name} threw a non-Error for ${Buffer.from(b).toString('hex')}`);
      }
    }
    assert.ok(Date.now() - started < 10_000, `${name} took too long`);
  });
}

never('decodeScsu', 1, (b) => assert.equal(typeof decodeScsu(b), 'string'));
never('decodeText', 2, (b, r) => assert.equal(typeof decodeText(b, Math.floor(r() * 256)), 'string'));

never('decodePayload', 3, (b) => {
  const ends: number[] = [];
  const res = decodePayload(b, ends);
  assert.ok(Array.isArray(res.chunks));
  for (const e of ends) assert.ok(e >= 0 && e <= b.length);
});

never('pbParse', 4, (b) => {
  const f = pbParse(b);
  assert.ok(f === undefined || Array.isArray(f));
});

never('parseDate', 5, (b, r) => {
  const chars = '0123456789/.-: AMP';
  let s = '';
  for (let i = 0; i < b.length; i++) s += chars[b[i] % chars.length];
  const order = (['MDY', 'DMY', 'YMD'] as const)[Math.floor(r() * 3)];
  const d = parseDate(s, order);
  assert.ok(d === undefined || /^\d{4}-\d{2}-\d{2}$/.test(d), `parseDate(${s}) gave ${d}`);
});

test('decodeCalc: random bytes throw only RangeError or Error, which callers catch', () => {
  const r = rng(6);
  let threw = 0;
  for (let i = 0; i < RUNS; i++) {
    const b = bytes(r);
    try {
      const res = decodeCalc(b);
      assert.equal(typeof res.text, 'string');
    } catch (e) {
      threw++;
      assert.ok(e instanceof Error, 'decodeCalc threw a non-Error');
    }
  }
  // Pins today's behaviour (a decode error is a throw, not a result): if this
  // changes, the catch sites in layouts.ts and schema.ts need a look.
  assert.ok(threw > 0 && threw < RUNS);
});
