import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCKOUT } from '../../store/src/index.ts';
import { setup, snapshot, FROM, names, median } from './lockout-matrix-helpers.ts';

export function credentialMatrix(routes: readonly (typeof names)[number][]) {
  for (const route of routes) test(`${route}: account threshold, shared address threshold, and locked response parity`, async (t) => {
    const s = await setup(t), call = s.routes[route];
    // Freeze presentation timestamps for exact response comparison; hrtime still measures actual latency.
    const mono = performance.now(), wall = Date.now();
    t.mock.method(performance, 'now', () => mono);
    t.mock.method(Date, 'now', () => wall);
    const unknownTimes: number[][] = [[], []];
    let unknownBaseline: Awaited<ReturnType<typeof snapshot>> | undefined;
    for (let i = 0; i < 3; i++) for (const j of i % 2 ? [1, 0] : [0, 1]) {
      const name = j ? 'Ghost' : 'Alice', start = process.hrtime.bigint();
      const result = await snapshot(await call(name, 'wrong', 'unknown'), name);
      unknownTimes[j].push(Number(process.hrtime.bigint() - start) / 1e6);
      if (!unknownBaseline) unknownBaseline = result;
      assert.deepEqual(result, unknownBaseline, 'unknown address: equal responses before either name reaches the limit');
    }
    assert.ok(Math.max(...unknownTimes.map(median)) <= 3 * Math.min(...unknownTimes.map(median)) + 100);
    for (let i = 0; i < LOCKOUT.attempts; i++) {
      await (await call(i % 2 ? 'ALICE' : 'Alice')).text();
      assert.equal(!!s.store.lockedOut('Alice', FROM), i === LOCKOUT.attempts - 1);
    }
    const locked = await snapshot(await call('Alice', 'correct'), 'Alice');
    assert.ok(locked.status >= 400 || /isError/.test(locked.body), 'correct password is refused at threshold');
    assert.equal(s.store.lockedOut('Alice', '198.51.100.7'), undefined, 'another caller is unaffected');
    s.store.unlock('Alice');
    // Distinct account names must still spend one shared budget, including the five failures and the blocked retry above.
    // The Store matrix exercises all 30 failures. Seed the middle here so each route tests the
    // two boundary increments without repeating hundreds of expensive password hashes.
    for (let i = LOCKOUT.attempts + 1; i < LOCKOUT.addressAttempts - 2; i++) s.store.countAddressFailure(FROM);
    for (let i = LOCKOUT.addressAttempts - 2; i < LOCKOUT.addressAttempts; i++) {
      await (await call(`missing${i}`)).text();
      assert.equal(!!s.store.addressLockedOut(FROM), i === LOCKOUT.addressAttempts - 1);
    }
    const times: number[][] = [[], []];
    let baseline: Awaited<ReturnType<typeof snapshot>> | undefined;
    for (let i = 0; i < 5; i++) for (const j of i % 2 ? [1, 0] : [0, 1]) {
      const name = j ? 'Ghost' : 'Alice', start = process.hrtime.bigint();
      const result = await snapshot(await call(name), name);
      times[j].push(Number(process.hrtime.bigint() - start) / 1e6);
      if (!baseline) baseline = result;
      assert.deepEqual(result, baseline, 'status, all non-Date headers and body do not disclose existence');
    }
    // 3x relative headroom plus 100 ms scheduler noise. Structural parity above is the stronger assertion.
    const a = median(times[0]), b = median(times[1]);
    assert.ok(Math.max(a, b) <= 3 * Math.min(a, b) + 100, `locked timing parity (3x + 100 ms tolerance): ${a.toFixed(1)} / ${b.toFixed(1)} ms`);
  });
}
