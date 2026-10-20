// Account names must not be guessable by timing: a name that doesn't exist takes as long to refuse as a wrong
// password on one that does (a scrypt hash is checked either way).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, LOCKOUT, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('an unknown, inactive or file-password account takes about as long to refuse as a wrong password', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-timing-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try {
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.setPassword('Ann', 'right-pw', full.name);
    const compareAsync = async (account: string, n = 11, place?: string) => {
      const control: number[] = [], compared: number[] = [];
      const measure = async (name: string, from: string) => {
        const t = performance.now();
        assert.equal(await store.verifyAsync(name, 'wrong-pw', from), false);
        return performance.now() - t;
      };
      for (let i = 0; i < n; i++) {
        const controlFrom = place ?? `10.1.${i}.${account.length}`;
        const comparedFrom = place ?? `10.0.${i}.${account.length}`;
        // Interleave the known wrong-password baseline with the path under
        // test, alternating order to limit drift from machine load.
        const pair = i % 2 === 0
          ? [await measure('Ann', controlFrom), await measure(account, comparedFrom)]
          : [await measure(account, comparedFrom), await measure('Ann', controlFrom)];
        control.push(pair[i % 2 === 0 ? 0 : 1]);
        compared.push(pair[i % 2 === 0 ? 1 : 0]);
      }
      const baseline = median(control), actual = median(compared);
      return { baseline, actual, ratio: actual / baseline };
    };
    store.setPassword('Gone', 'gone-pw', store.privilegeSets().find((p) => p.id !== 1)!.name);
    store.setAccountActive('Gone', false);
    // Scrypt is the same operation on each path. Use a broad same-run ratio
    // interleaved medians so scheduler pauses on a busy runner don't look
    // like an account-name timing leak, while still catching a path that
    // skips or repeats the expensive check.
    const near = (what: string, result: { baseline: number; actual: number; ratio: number }) => assert.ok(result.ratio > 0.25 && result.ratio < 4,
      `${what} took ${result.actual.toFixed(1)} ms, a wrong password ${result.baseline.toFixed(1)} ms`);
    const unknown = await compareAsync('Nobody');
    near('an unknown name', unknown);
    const known = unknown.baseline;
    near('an inactive account', await compareAsync('Gone'));
    // Charts' Admin is on the file's own (blank) password, which FileMaker's cheap hash checks.
    near('an account on the file\'s own password', await compareAsync('Admin', 4, '127.0.0.1'));
    // Compare synchronous paths with each other: sync and async Scrypt have
    // different costs, so an async baseline would be misleading here.
    const syncControl: number[] = [], syncCompared: number[] = [];
    for (let i = 0; i < 11; i++) {
      const fromControl = `10.10.${i}.9`, fromCompared = `10.9.${i}.9`;
      const measure = (account: string, from: string) => {
        const t = performance.now();
        assert.equal(store.verify(account, 'wrong-pw', from), false);
        return performance.now() - t;
      };
      const pair = i % 2 === 0
        ? [measure('Ann', fromControl), measure('Nobody2', fromCompared)]
        : [measure('Nobody2', fromCompared), measure('Ann', fromControl)];
      syncControl.push(pair[i % 2 === 0 ? 0 : 1]);
      syncCompared.push(pair[i % 2 === 0 ? 1 : 0]);
    }
    const syncBaseline = median(syncControl), syncActual = median(syncCompared);
    near('an unknown name (sync)', { baseline: syncBaseline, actual: syncActual, ratio: syncActual / syncBaseline });
    // A place that is locked out is answered at once, as before: the lockout stays cheap.
    for (let i = 0; i < LOCKOUT.attempts; i++) await store.verifyAsync('Nobody3', 'wrong-pw', '10.8.8.8');
    const t = performance.now();
    assert.equal(await store.verifyAsync('Nobody3', 'wrong-pw', '10.8.8.8'), false);
    assert.ok(performance.now() - t < known / 2, 'a locked-out place was made to wait for a hash');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
