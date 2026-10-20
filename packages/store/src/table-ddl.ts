// GetTableDDL ( tableOccurrences ; ignoreRelationships ), FileMaker 2024's function for describing tables to a
// language model: one CREATE TABLE per table occurrence, its fields with SQL types and their comments, and a
// FOREIGN KEY for each equijoin to another listed occurrence. FileMaker's exact layout of the text isn't
// documented; this is the same information in plain SQL.

import type { Field, Schema } from '../../fmp12/src/index.ts';

const SQL_TYPE: Record<string, string> = {
  text: 'varchar(255)', number: 'numeric', date: 'date', time: 'time', timestamp: 'timestamp', container: 'varbinary',
  boolean: 'boolean', integer: 'bigint', decimal: 'decimal', json: 'json', uuid: 'uuid',
};

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * The occurrences named in `list`: a JSON array of names, or one name per line. `visible` leaves out the base
 * tables and fields an account can't see (see schemaVisibility).
 */
export function tableDDL(schema: Schema, list: string, ignoreRelationships: boolean, visible?: (table: string, field?: string) => boolean): string {
  let names: string[];
  try {
    const parsed: unknown = JSON.parse(list);
    names = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    names = list.split(/[\r\n]+/);
  }
  const wanted = names.map((n) => n.trim()).filter(Boolean);
  const occurrences = wanted.map((n) => schema.tableOccurrences.find((t) => t.name.toLowerCase() === n.toLowerCase()))
    .filter((t): t is NonNullable<typeof t> => !!t && !t.dataSourceId)
    .filter((t) => !visible || visible(schema.tables.find((b) => b.id === t.baseTableId)?.name ?? ''));
  const fieldsOf = (baseTableId?: number): Field[] => {
    const table = schema.tables.find((t) => t.id === baseTableId);
    return (table?.fields ?? []).filter((f) => !visible || visible(table!.name, f.name));
  };
  const ids = new Set(occurrences.map((t) => t.id));
  return occurrences.map((to) => {
    const lines = fieldsOf(to.baseTableId).filter((f) => f.kind !== 'summary').map((f) =>
      `  ${quote(f.name)} ${SQL_TYPE[f.type] ?? 'varchar(255)'}${f.comment ? ` /* ${f.comment.replace(/\*\//g, '* /')} */` : ''}`);
    if (!ignoreRelationships) {
      for (const r of schema.relationships) {
        const mine = r.leftTableOccurrenceId === to.id ? 'left' : r.rightTableOccurrenceId === to.id ? 'right' : undefined;
        if (!mine) continue;
        const otherId = mine === 'left' ? r.rightTableOccurrenceId : r.leftTableOccurrenceId;
        const other = schema.tableOccurrences.find((t) => t.id === otherId);
        if (!other || !ids.has(other.id) || other.id === to.id) continue;
        for (const p of r.predicates) {
          if (p.operator !== '=' ) continue;
          const here = mine === 'left' ? p.leftField : p.rightField;
          const there = mine === 'left' ? p.rightField : p.leftField;
          const hidden = (occ: { baseTableId?: number }, field: string): boolean => !!visible && !visible(schema.tables.find((b) => b.id === occ.baseTableId)?.name ?? '', field);
          if (here && there && (hidden(to, here) || hidden(other, there))) continue;
          if (here && there && mine === 'left') lines.push(`  FOREIGN KEY (${quote(here)}) REFERENCES ${quote(other.name)} (${quote(there)})`);
        }
      }
    }
    return `CREATE TABLE ${quote(to.name)} (\n${lines.join(',\n')}\n);`;
  }).join('\n\n');
}

/** Which base tables and fields an account sees, by name, for tableDDL and FileMaker_Tables/FileMaker_Fields: all of them without privileges. */
export function schemaVisibility(privileges?: { table(name: string): { view: unknown }; field(table: string, field: string): string }): ((table: string, field?: string) => boolean) | undefined {
  if (!privileges) return undefined;
  return (table, field) => (field === undefined ? privileges.table(table).view !== false : privileges.field(table, field) !== 'none');
}
