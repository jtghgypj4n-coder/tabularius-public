import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createStore, Store } from '../src/index.ts';

test('AR-store-core-03: reverse declaration chains recalculate on create and update', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-recalc-order-'));
  try {
    for (const length of [1, 2, 3, 6]) {
      const path = join(dir, `${length}.sqlite`);
      createStore(path);
      const store = new Store(path, 'S');
      try {
        const fields = Array.from({ length }, (_, i) => ({
          name: `C${i}`, type: 'number', kind: 'calculation',
          calculation: `${i + 1 < length ? `C${i + 1}` : 'N'} + 1`,
        }));
        store.applyDesign([{ op: 'createTable', name: 'T', fields: [...fields, { name: 'N', type: 'number' }] }] as never);
        const id = store.create('T', { N: '1' }).recordId;
        const expected = (n: number) => Array.from({ length }, (_, i) => n + length - i);
        const values = () => fields.map((f) => Number(store.get('T', id).fieldData[f.name]));
        assert.deepEqual(values(), expected(1), `create, length ${length}`);
        store.update('T', id, { N: '2' });
        assert.deepEqual(values(), expected(2), `update, length ${length}`);
      } finally { store.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AR-store-core-03: cycles fail clearly and stay bounded', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./recalc-cycle-child.ts', import.meta.url))], {
    timeout: 10_000, encoding: 'utf8',
  });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
});
