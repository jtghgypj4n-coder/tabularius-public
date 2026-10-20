import { DatabaseSync } from 'node:sqlite';
import type { Schema } from '../../fmp12/src/index.ts';
import { oneStatement } from '../../store/src/sql-dates.ts';

type Ref = { table: number; field: number };
type Instruction = { opcode: string; p1: number; p2: number; p3: number };
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Compile against schema only, including an uncommitted design preview. SQLite
 * resolves quoting, aliases, stars, joins, expressions, CTEs and parameters. No
 * records, store functions, indexes or views enter this connection. Inspecting
 * base-table Column instructions also covers predicates and computed results,
 * whose result-column metadata alone would not identify their dependencies. */
export function sqlFieldRefs(schema: Schema, text: string): Ref[] | undefined {
  const first = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(\w+)/.exec(text)?.[1]?.toUpperCase();
  if (!oneStatement(text) || !['SELECT', 'WITH', 'VALUES'].includes(first ?? '')) return undefined;
  // ExecuteSQL rewrites occurrence names before SQLite sees the query. A
  // nonidentity rewrite (including a foreign source or a shadowed CTE) cannot
  // be proved by compiling the base schema; fail closed even inside literals.
  // Ordinary SQL table/column aliases are still resolved by SQLite below.
  if (schema.tableOccurrences.some((o) => (o.dataSourceId || schema.tables.find((t) => t.id === o.baseTableId)?.name.toLowerCase() !== o.name.toLowerCase())
    && text.toLowerCase().includes(o.name.toLowerCase()))) return undefined;
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: false });
  try {
    const tables = new Map<string, { id: number; fields: (number | undefined)[] }>();
    for (const table of schema.tables) {
      // These are the store's public record metadata columns, not secret fields.
      const names = ['_fm_record_id', '_fm_mod_id', ...table.fields.map((f) => f.name)];
      db.exec(`CREATE TABLE ${quote(table.name)} (${names.map(quote).join(', ')})`);
      tables.set(table.name.toLowerCase(), { id: table.id, fields: [undefined, undefined, ...table.fields.map((f) => f.id)] });
    }
    const roots = new Map((db.prepare('SELECT name, rootpage FROM sqlite_master WHERE type = \'table\'').all() as { name: string; rootpage: number }[])
      .map((row) => [row.rootpage, tables.get(row.name.toLowerCase())!]));
    const program = db.prepare(`EXPLAIN ${text}`).all() as Instruction[];
    if (program.some((op) => op.opcode === 'VOpen' || op.opcode === 'VFilter' || op.opcode === 'OpenWrite' || (op.opcode === 'Transaction' && op.p2 !== 0))) return undefined;
    // Cursors can be reused across subqueries. Keep every owner, conservatively.
    const cursors = new Map<number, Set<NonNullable<ReturnType<typeof roots.get>>>>();
    for (const op of program) if (op.opcode === 'OpenRead' || op.opcode === 'ReopenIdx') {
      const table = roots.get(op.p2);
      if (op.p3 !== 0 || !table) return undefined;
      const owners = cursors.get(op.p1) ?? new Set();
      owners.add(table);
      cursors.set(op.p1, owners);
    }
    const refs: Ref[] = [];
    for (const op of program) if (op.opcode === 'Column') {
      for (const table of cursors.get(op.p1) ?? []) {
        if (op.p2 < 0 || op.p2 >= table.fields.length) return undefined;
        const field = table.fields[op.p2];
        if (field !== undefined) refs.push({ table: table.id, field });
      }
    }
    return refs;
  } catch {
    // Missing names, unsupported SQL/functions and malformed queries are secret.
    return undefined;
  } finally {
    db.close();
  }
}
