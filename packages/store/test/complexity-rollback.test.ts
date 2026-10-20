import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

// Generated native schema and records only. No imports, child processes or I/O
// beyond this test's disposable database.
for (const expression of [
  'SetRecursion(While([i=0]; i<1000000000; [i=i+1]; i); 1000000000)',
  'Substitute("a"; ' + Array.from({ length: 30 }, () => '["a"; "aa"]').join(';') + ')',
]) test('a calculation complexity refusal rolls back the entire record update', () => {
  const dir = mkdtempSync(join(tmpdir(), 'complexity-rollback-'));
  const path = join(dir, 'generated.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'N', type: 'number' }, { name: 'Label' }] },
      { op: 'createField', table: 'T', name: 'C', type: 'text', kind: 'calculation', calculation: `If(N=0; "before"; ${expression})` },
    ]);
    const { recordId } = store.create('T', { N: 0, Label: 'before' });
    const before = store.get('T', recordId);
    assert.throws(() => store.update('T', recordId, { N: 1, Label: 'after' }), /work budget|Too many text matches|too large/);
    const after = store.get('T', recordId);
    assert.deepEqual(after.fieldData, before.fieldData);
    assert.equal(after.modId, before.modId);
    assert.doesNotThrow(() => store.update('T', recordId, { N: 0, Label: 'valid' }));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
