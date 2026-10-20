// Measure the buffered Store.select path used by PostgreSQL queries, in a fresh process per size.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../packages/store/src/index.ts';

if (!process.argv[2]) {
  for (const count of [10_000, 100_000, 1_000_000]) {
    execFileSync(process.execPath, ['--expose-gc', '--no-warnings', fileURLToPath(import.meta.url), String(count)], { stdio: 'inherit' });
  }
  process.exit(0);
}
const count = Number(process.argv[2]);
if (![10_000, 100_000, 1_000_000].includes(count)) throw new Error('row count must be 10000, 100000 or 1000000');
const dir = mkdtempSync(join(tmpdir(), 'pgwire-measure-'));
const path = join(dir, 'Generated.openhbam.sqlite');
createStore(path);
const store = new Store(path, 'Generated');
try {
  store.applyDesign([{ op: 'createTable', name: 'Generated', fields: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }]);
  const db = new DatabaseSync(path);
  try {
    db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ?)
      INSERT INTO Generated (_fm_record_id, A, B, C)
      SELECT i, printf('%064d', i), printf('%096d', i), printf('%0128d', i) FROM n`).run(count);
  } finally { db.close(); }
  globalThis.gc?.();
  const baseline = process.memoryUsage();
  let rss = baseline.rss;
  let heapUsed = baseline.heapUsed;
  const sample = () => { const m = process.memoryUsage(); rss = Math.max(rss, m.rss); heapUsed = Math.max(heapUsed, m.heapUsed); };
  store.defineQueryFunction('measure_row', (id) => { if (Number(id) % 1000 === 0) sample(); return 1; });
  const start = performance.now();
  const result = store.select('SELECT A, B, C FROM Generated WHERE measure_row(_fm_record_id)', [], 1_000_000);
  sample();
  const ms = performance.now() - start;
  console.log(JSON.stringify({ count, returned: result.rows.length, ms, baseline: { rss: baseline.rss, heapUsed: baseline.heapUsed }, peak: { rss, heapUsed }, delta: { rss: rss - baseline.rss, heapUsed: heapUsed - baseline.heapUsed } }));
} finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
