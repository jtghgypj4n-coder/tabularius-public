// A small store that uses most of what a store keeps: tables, records, a script, a value list,
// accounts, an API token, a container and an audit trail. Used to make the checked-in snapshot
// (npm run store:snapshot) and by the forward-compatibility test.
import { createStore, Store } from '../../src/index.ts';
import { DatabaseSync } from 'node:sqlite';

export function buildSampleStore(path: string): void {
  createStore(path);
  const store = new Store(path, 'Sample');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Clients', fields: [{ name: 'Name', type: 'text' }, { name: 'Email', type: 'text' }, { name: 'Balance', type: 'number' }, { name: 'Photo', type: 'container' }] },
      { op: 'createValueList', name: 'Tiers', values: ['Gold', 'Silver'] },
      { op: 'createScript', name: 'Hello', text: 'Set Variable [ $x ; Value: 1 ]\nExit Script [ Text Result: $x ]' },
    ] as never);
    const a = store.create('Clients', { Name: 'Ann Example', Email: 'ann@example.test', Balance: 12.5 }, { account: 'Admin' });
    store.create('Clients', { Name: 'Bo Example', Email: 'bo@example.test', Balance: 0 }, { account: 'Admin' });
    store.update('Clients', a.recordId, { Balance: 40 }, undefined, { account: 'Admin' });
    store.setContainer('Clients', a.recordId, 'Photo', 1, { filename: 'dot.png', mime: 'image/png', data: Buffer.from('not really a png') });
    store.setPassword('Admin', 'sample passphrase 1', store.privilegeSets()[0].name);
    store.createApiToken('Admin', { label: 'sample', readOnly: true });
  } finally {
    store.close();
  }
}

/** The store as SQL text: every table, index and row, in a stable order. */
export function dumpStore(path: string): string {
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    const out: string[] = [];
    const objects = sql.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").all() as { type: string; name: string; sql: string }[];
    for (const o of objects) out.push(`${o.sql};`);
    for (const o of objects.filter((x) => x.type === 'table')) {
      const cols = (sql.prepare(`PRAGMA table_info("${o.name}")`).all() as { name: string; hidden?: number }[]).map((c) => c.name);
      if (!cols.length) continue;
      const q = cols.map((c) => `quote("${c}")`).join(" || ',' || ");
      for (const r of sql.prepare(`SELECT ${q} AS v FROM "${o.name}" ORDER BY 1`).all() as { v: string }[]) {
        out.push(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${r.v});`);
      }
    }
    return out.join('\n') + '\n';
  } finally {
    sql.close();
  }
}
