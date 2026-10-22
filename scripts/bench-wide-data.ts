// Deterministic, disposable wide solution. No imported files or record exports.
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, type DesignOp } from '../packages/store/src/index.ts';
import type { FieldSpec } from '../packages/store/src/design.ts';

export const WIDE_DEFAULTS = { records: 270_000, tables: 85 };
export function wideOptions(args: string[]): typeof WIDE_DEFAULTS {
  const options = { ...WIDE_DEFAULTS };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i] === '--records' ? 'records' : args[i] === '--tables' ? 'tables' : undefined;
    const value = Number(args[i + 1]);
    if (!key || !Number.isSafeInteger(value) || value < 1) throw new Error('usage: bench-wide.ts [--records positive-integer] [--tables positive-integer]');
    options[key] = value;
  }
  return options;
}

export function wideCounts(records: number, tables: number): number[] {
  const weights = Array.from({ length: tables }, (_, i) => i < 3 ? 100 / (i + 1) : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor(records * w / total));
  for (let i = 0, left = records - counts.reduce((a, b) => a + b, 0); i < left; i++) counts[i % tables]++;
  return counts;
}

export function buildWide(path: string, options = WIDE_DEFAULTS) {
  createStore(path);
  const store = new Store(path, 'Wide');
  const fields: FieldSpec[][] = [];
  const counts = wideCounts(options.records, options.tables);
  try {
    const ops: DesignOp[] = [];
    for (let t = 0; t < options.tables; t++) {
      const name = `Table${t + 1}`;
      const columns: FieldSpec[] = [
        { name: 'Id', type: 'number' }, { name: 'ParentId', type: 'number' }, { name: 'Label' },
        { name: 'Amount', type: 'number' }, { name: 'Scan', type: 'number' },
        { name: 'Stored', type: 'number', kind: 'calculation', calculation: 'Amount * 2' },
        { name: 'Live', type: 'number', kind: 'calculation', calculation: 'Amount + 1', options: { unstored: true } },
        { name: 'Total', type: 'number', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
      ];
      const types = ['text', 'number', 'date', 'time', 'timestamp', 'container'] as const;
      for (let f = 0; f < (t * 17) % 53; f++) columns.push({ name: `Extra${f + 1}`, type: types[f % types.length] });
      fields.push(columns);
      ops.push({ op: 'createTable', name, fields: columns });
      for (let l = 1; l <= 3; l++) ops.push({ op: 'createLayout', name: `${name} Page${l}`, occurrence: name });
      for (let s = 1; s <= 3; s++) ops.push({ op: 'createScript', name: `${name} Script${s}`, text: '# Synthetic benchmark script\nSet Variable [ $value ; 1 ]\nExit Script [ $value ]' });
      ops.push({ op: 'createValueList', name: `${name} Values`, values: ['Open', 'Closed', 'Pending'] });
    }
    for (let t = 1; t < Math.ceil(options.tables / 3); t++) ops.push({ op: 'createRelationship', left: `Table${t}`, right: `Table${t + 1}`, predicates: [{ left: 'ParentId', right: 'Id' }] });
    store.applyDesign(ops);
    // Keep summaries on the default forms, but not on the page used for plain record reads.
    store.designs(); // Generation needs every layout; load the whole design once.
    store.applyDesign(store.schema.layouts.filter((l) => l.name.includes(' Page')).map((l) => {
      const d = store.design(l.id)!;
      return { op: 'updateLayout', layout: l.id, design: {
        objects: d.objects.filter((o) => o.field?.field !== 'Total' && o.text !== 'Total'),
        tableView: d.tableView?.filter((c) => c.field.field !== 'Total'),
      } };
    }));
    store.setPassword('Admin', ['wide', 'benchmark'].join('-'));
  } finally { store.close(); }

  let seed = 20261021;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const db = new DatabaseSync(path);
  try {
    db.exec('BEGIN');
    for (let t = 0; t < options.tables; t++) {
      const columns = fields[t].filter((f) => f.name !== 'Live' && f.name !== 'Total');
      const insert = db.prepare(`INSERT INTO Table${t + 1} (${columns.map((f) => `"${f.name}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (let r = 1; r <= counts[t]; r++) {
        const amount = Math.floor(random() * 100_000) / 100;
        insert.run(...columns.map((f) => {
          if (f.name === 'Id') return r;
          if (f.name === 'ParentId') return 1 + r % Math.max(1, counts[Math.min(t + 1, options.tables - 1)]);
          if (f.name === 'Amount') return amount;
          if (f.name === 'Scan') return r % 100;
          if (f.name === 'Stored') return amount * 2;
          switch (f.type) {
            case 'number': return Math.floor(random() * 1000);
            case 'date': return '2026-01-01';
            case 'time': return '12:30:00';
            case 'timestamp': return '2026-01-01 12:30:00';
            case 'container': return null;
            default: return `Generated ${Math.floor(random() * 1000)}`;
          }
        }));
      }
      db.exec(`CREATE INDEX wide_id_${t + 1} ON Table${t + 1} (Id)`);
    }
    db.exec('COMMIT; ANALYZE');
  } finally { db.close(); }
  return { ...options, fields: fields.reduce((n, f) => n + f.length, 0), layouts: options.tables * 4,
    scripts: options.tables * 3, valueLists: options.tables, relationships: Math.max(0, Math.ceil(options.tables / 3) - 1), largestTable: counts[0] };
}
