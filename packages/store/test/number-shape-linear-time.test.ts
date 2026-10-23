// A number field that holds a long run of digits ending in another character is read as "not a number" in time linear
// in its length, by NUMVAL and by the SQL export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, exportSql, Store } from '../src/index.ts';
import { SQL_DATE_FUNCTIONS } from '../src/sql-dates.ts';

const N = 300_000;
const LIMIT_MS = 5000;
function quick<T>(f: () => T): T {
  const t = performance.now();
  const r = f();
  assert.ok(performance.now() - t < LIMIT_MS, 'took too long: the pattern backtracks');
  return r;
}

test('NUMVAL on a long run of digits before a letter, and on numbers', () => {
  // NUMVAL throws, so the time is read around the throw.
  const t = performance.now();
  assert.throws(() => SQL_DATE_FUNCTIONS.NUMVAL('1'.repeat(N) + 'x'), /not a valid number/);
  assert.ok(performance.now() - t < LIMIT_MS, 'took too long: the pattern backtracks');
  assert.equal(SQL_DATE_FUNCTIONS.NUMVAL(' 12.5e1 '), 125);
});

test('the SQL export of number and decimal fields holding a long run of digits before a letter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-number-shape-'));
  try {
    createStore(join(dir, 'T.sqlite'));
    const store = new Store(join(dir, 'T.sqlite'), 'T');
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'N', type: 'number' }] }]);
    store.create('T', { N: '1'.repeat(N) + 'x' });
    store.create('T', { N: '12.5' });
    let script = '';
    const report = quick(() => exportSql(store, { write: (s) => { script += s; }, file: () => {} }, {}));
    assert.ok(script.includes('12.5'));
    assert.ok(report);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
