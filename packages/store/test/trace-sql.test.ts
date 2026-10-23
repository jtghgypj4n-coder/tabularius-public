// TABULARIUS_TRACE_SQL: statements are logged by shape, rows and time, with no
// names or values from the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqlShape, tracing } from '../src/trace.ts';
import { testCommandPath } from '../../../scripts/test-command-path.ts';

test('a statement\'s shape keeps keywords and hides names and values', () => {
  assert.equal(sqlShape(`SELECT "Secret Name", _fm_record_id FROM "Customers" AS c WHERE "Email" = 'ann@example.com' AND n > 42 LIMIT 5`),
    'SELECT x, x FROM x AS x WHERE x = ? AND x > ? LIMIT ?');
  assert.equal(sqlShape(`SELECT * FROM "T" WHERE _fm_record_id IN (SELECT value FROM json_each(?)) ORDER BY _fm_record_id`),
    'SELECT * FROM x WHERE x IN (SELECT VALUE FROM JSON_EACH(?)) ORDER BY x');
});

test('with TABULARIUS_TRACE_SQL=1 a store logs each statement, its rows and time, and nothing of the data', (t) => {
  const env = testCommandPath(t);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-trace-'));
  try {
    const store = join(import.meta.dirname, '..', 'src', 'index.ts');
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      import { createStore, Store } from ${JSON.stringify(store)};
      const path = ${JSON.stringify(join(dir, 'Crm.sqlite'))};
      createStore(path);
      const s = new Store(path, 'Crm');
      s.applyDesign([{ op: 'createTable', name: 'Patients', fields: [{ name: 'Diagnosis' }] }]);
      s.create('Patients', { Diagnosis: 'very private words' });
      s.find('Patients', { limit: 1 });
    `], { encoding: 'utf8', env: { ...env, TABULARIUS_TRACE_SQL: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stderr.split('\n').filter((l) => l.startsWith('[sql]'));
    assert.ok(lines.length > 5);
    assert.ok(lines.some((l) => /ms +1 rows +all +SELECT \* FROM x WHERE \(\?\) AND \? ORDER BY x LIMIT \? OFFSET \?  <- .*\bfind\b/.test(l)), lines.join('\n'));
    for (const l of lines) assert.doesNotMatch(l, /Patients|Diagnosis|private/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('SQL tracing accepts only explicit boolean values and warns once for invalid input', (t) => {
  const saved = process.env.TABULARIUS_TRACE_SQL;
  t.after(() => { if (saved === undefined) delete process.env.TABULARIUS_TRACE_SQL; else process.env.TABULARIUS_TRACE_SQL = saved; });
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  for (const [values, expected] of [
    [['1', 'true', 'yes', 'on', 'TRUE', 'YeS', 'ON'], true],
    [['', '0', 'false', 'no', 'off', 'FALSE', 'No', 'OFF'], false],
  ] as const) {
    for (const value of values) {
      process.env.TABULARIUS_TRACE_SQL = value;
      assert.equal(tracing(), expected, JSON.stringify(value));
    }
  }
  delete process.env.TABULARIUS_TRACE_SQL;
  assert.equal(tracing(), false);
  assert.equal(warnings.length, 0);
  for (const value of ['maybe', '2', ' ', '1e3']) {
    process.env.TABULARIUS_TRACE_SQL = value;
    assert.equal(tracing(), false);
    assert.equal(tracing(), false);
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /TABULARIUS_TRACE_SQL.*disabled/);
});
