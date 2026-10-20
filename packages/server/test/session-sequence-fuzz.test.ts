import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, op, runSequence, shrink } from './session-sequence-harness.ts';

const seeds = process.env.SESSION_SEQUENCE_SEED === undefined ? [0x1906, 0xc0ffee] : [Number(process.env.SESSION_SEQUENCE_SEED)];
const shrinkDeadline = process.hrtime.bigint() + 40_000_000_000n;
for (const seed of seeds) test(`stateful session sequence seed=${seed}`, { timeout: 55_000 }, async t => {
  assert.ok(Number.isInteger(seed) && seed > 0 && seed <= 0xffff_ffff, 'seed must be a nonzero uint32');
  const sequence = generate(seed);
  try { await runSequence(t, sequence); }
  catch (error) {
    const message = (error as Error).message.split('\n')[0];
    const index = (error as Error & { sequenceIndex?: number }).sequenceIndex;
    const prefix = index !== undefined && index >= 0 ? sequence.slice(0, index + 1) : sequence;
    const shrunk = await shrink(prefix, async candidate => {
      if (process.hrtime.bigint() >= shrinkDeadline) return false;
      try { await runSequence(t, candidate); return false; }
      catch (next) { return (next as Error).message.split('\n')[0] === message; }
    }, 40);
    assert.fail(`seed=${seed}\nshrunk sequence=${JSON.stringify(shrunk)}\n${String(error)}`);
  }
});

test('shrinking preserves a causal pair and removes unrelated operations', async () => {
  const result = await shrink([op('expire'), op('basic'), op('unlock'), op('privilege'), op('logout')], async ops =>
    ops.some((x, i) => x.kind === 'basic' && ops.slice(i + 1).some(y => y.kind === 'privilege')), 30);
  assert.deepEqual(result.map(x => x.kind), ['basic', 'privilege']);
});
