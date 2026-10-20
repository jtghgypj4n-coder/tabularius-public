import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('20k-row unstored calculation sorts check design versions once per read', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-design-read-'));
  const path = join(dir, 'Generated.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Computed', type: 'text', kind: 'calculation', calculation: 'Value & "!"', options: { unstored: true } },
  ]);
  store.sql.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 20000)
    INSERT INTO T (_fm_record_id, _fm_mod_id, Value) SELECT x, 0, (x * 7919) % 20000 FROM n`);
  // Count actual scalar version reads, including statements already prepared by the constructor.
  const query = store['metadataVersionQuery']!;
  const get = query.get.bind(query);
  let queries = 0;
  query.get = () => { queries++; return get(); };
  for (let run = 0; run < 4; run++) {
    store.resetCaches();
    const before = queries;
    const start = performance.now();
    const ids = store.findIds('T', { sort: [{ fieldName: 'Computed' }] });
    const ms = performance.now() - start;
    const reads = queries - before;
    assert.equal(reads, 1, 'one design check for the whole sort');
    assert.equal(ids.length, 20000);
    assert.equal(ids[0], 20000);
    t.diagnostic(`20k unstored sort ${run + 1}: ${ms.toFixed(2)} ms, ${reads} version queries`);
  }
});
