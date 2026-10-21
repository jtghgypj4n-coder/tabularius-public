import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-recalc-cycle-'));
try {
  const path = join(dir, 'S.sqlite');
  createStore(path);
  const store = new Store(path, 'S');
  try {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [
      { name: 'A', type: 'number', kind: 'calculation', calculation: 'B + 1' },
      { name: 'B', type: 'number', kind: 'calculation', calculation: 'A + 1' },
      { name: 'N', type: 'number' },
    ] }] as never);
    assert.throws(() => store.create('T', { N: '1' }), /Cyclic calculation dependencies: A, B/);
    assert.equal(store.recordCount('T'), 0);
  } finally { store.close(); }
} finally { rmSync(dir, { recursive: true, force: true }); }
