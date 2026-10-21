import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, importTables, planImportTables, Store, type SheetInput } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-list-worker-'));
const path = join(dir, 'test.sqlite');
try {
  createStore(path);
  const store = new Store(path);
  try {
    const name = 'T'.repeat(100);
    const sheet: SheetInput = { name, rows: [['First', 'Second'], ['a', 'b']] };
    const plan = planImportTables([sheet], { overrides: { [name]: { First: 'select', Second: 'select' } } });
    importTables(store, [sheet], plan);
    if (new Set(store.schema.valueLists.map((v) => v.name.toLowerCase())).size !== 2) process.exitCode = 1;
  } finally { store.close(); }
} finally { rmSync(dir, { recursive: true, force: true }); }
