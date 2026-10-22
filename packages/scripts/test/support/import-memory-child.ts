// Invoked by import-memory.test.ts under a 128 MB V8 heap. All input is generated here.
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../../src/index.ts';
import type { Script } from '@tabularius/fmp12';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-memory-'));
try {
  const path = join(dir, 'Target.sqlite');
  createStore(path);
  const store = new Store(path, 'Target');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Value', type: 'text' }] }]);
    const source = join(dir, 'data.csv');
    const fd = openSync(source, 'w');
    try {
      // 10,240 rows of 2,048 bytes each: exactly 20 MiB of synthetic CSV.
      const block = Buffer.from(('x'.repeat(2047) + '\n').repeat(256));
      for (let i = 0; i < 40; i++) writeSync(fd, block);
    } finally { closeSync(fd); }
    assert.equal(statSync(source).size, 20 * 1024 * 1024);
    const script: Script = { id: 1, name: 'Import', steps: [{ stepId: 35, name: 'Import Records', enabled: true, params: { filePaths: ['data.csv'] } }] };
    const result = await runScript(store, script, { layout: 'Rows', documents: dir });
    assert.equal(result.error, 0);
    assert.equal(result.foundCount, 10240);
    assert.equal(store.findIds('Rows').length, 10240);
  } finally { store.close(); }
} finally { rmSync(dir, { recursive: true }); }
