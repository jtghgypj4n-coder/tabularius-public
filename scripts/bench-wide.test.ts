import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../packages/store/src/index.ts';
import { buildWide, wideCounts, wideOptions } from './bench-wide-data.ts';

test('wide options and uneven allocation preserve exact totals, including tiny runs', () => {
  assert.deepEqual(wideOptions([]), { records: 270000, tables: 85 });
  assert.deepEqual(wideOptions(['--tables', '3', '--records', '7']), { records: 7, tables: 3 });
  for (const args of [['--records'], ['--tables', '0'], ['--records', '1.5'], ['--unknown', '3']]) assert.throws(() => wideOptions(args), /usage/);
  for (const n of [1, 17, 270000]) {
    const counts = wideCounts(n, 85);
    assert.equal(counts.length, 85);
    assert.equal(counts.reduce((a, b) => a + b, 0), n);
    assert.ok(counts.every((c) => Number.isSafeInteger(c) && c >= 0));
  }
  const counts = wideCounts(270000, 85);
  assert.ok(counts[0] > counts[84] * 90);
});

test('wide generation has the full design, seeded records, working calculations and indexes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-wide-test-'));
  try {
    const paths = [join(dir, 'A.sqlite'), join(dir, 'B.sqlite')];
    for (const path of paths) buildWide(path, { records: 200, tables: 85 });
    const a = new Store(paths[0]), b = new Store(paths[1]);
    try {
      assert.equal(a.schema.tables.length, 85);
      assert.equal(a.schema.layouts.length, 340);
      assert.equal(a.schema.scripts.length, 255);
      assert.equal(a.schema.valueLists.length, 85);
      assert.equal(a.schema.relationships.length, 28);
      assert.equal(Math.min(...a.schema.tables.map((t) => t.fields.length)), 8);
      assert.equal(Math.max(...a.schema.tables.map((t) => t.fields.length)), 60);
      const counts = wideCounts(200, 85);
      for (let i = 0; i < 85; i++) {
        const rows = a.sql.prepare(`SELECT * FROM Table${i + 1}`).all();
        assert.equal(rows.length, counts[i]);
        assert.deepEqual(rows, b.sql.prepare(`SELECT * FROM Table${i + 1}`).all());
      }
      const record = a.find('Table1 Page1', { limit: 1, layoutOnly: true }).records[0];
      assert.equal(Number(record.fieldData.Stored), Number(record.fieldData.Amount) * 2);
      assert.equal(Number(record.fieldData.Live), Number(record.fieldData.Amount) + 1);
      assert.equal(record.fieldData.Total, undefined);
      const total = (a.sql.prepare('SELECT sum(Amount) AS n FROM Table1').get() as { n: number }).n;
      assert.ok(Math.abs(Number(a.find('Table1', { limit: 1 }).records[0].fieldData.Total) - total) < 1e-8);
      assert.match(JSON.stringify(a.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM Table1 WHERE Id = 1').all()), /wide_id_1/);
      assert.match(JSON.stringify(a.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM Table1 WHERE Scan = 1').all()), /SCAN Table1/);
    } finally { a.close(); b.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fresh-process HTTP probe reports every phase and cleans its generated folder without external commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-wide-process-'));
  try {
    const bin = join(dir, 'bin'), temp = join(dir, 'temp'), marker = join(dir, 'forbidden-command');
    mkdirSync(bin); mkdirSync(temp);
    for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
      const path = join(bin, command);
      writeFileSync(path, '#!/bin/sh\nprintf forbidden > "$BENCH_WIDE_TEST_MARKER"\nexit 99\n');
      chmodSync(path, 0o755);
    }
    const run = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('./bench-wide.ts', import.meta.url)), '--records', '100', '--tables', '3'], {
      encoding: 'utf8', timeout: 45_000, env: { PATH: bin, TMPDIR: temp, TMP: temp, TEMP: temp, BENCH_WIDE_TEST_MARKER: marker },
    });
    assert.equal(existsSync(marker), false, 'forbidden subprocess attempted');
    assert.ifError(run.error);
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.counts.records, 100);
    assert.equal(output.counts.tables, 3);
    assert.equal(output.layoutCount, 12);
    assert.equal(output.firstPageRecords, 50);
    for (const phase of ['processToListeningMs', 'hostedOpenMs', 'schemaLoadMs', 'designLoadMs', 'layoutListMs', 'firstPageMs', 'indexedFindMs', 'unindexedFindMs', 'bootstrapMs', 'firstLayoutMs']) {
      assert.ok(Number.isFinite(output.timings[phase]) && output.timings[phase] > 0, phase);
    }
    assert.equal(output.metadataReads.schema, 1);
    assert.equal(output.metadataReads.designs, 0, 'first page and web bootstrap must not parse the entire design');
    assert.ok(output.bootstrapBytes > 0 && output.firstLayoutBytes > 0 && output.memoryAfterStart.rss > 0);
    assert.deepEqual(readdirSync(temp), []);
    assert.doesNotMatch(run.stdout, /Generated|Admin|\/Users\//);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
