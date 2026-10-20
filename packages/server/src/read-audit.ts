import type { Privileges, Store } from '../../store/src/index.ts';

/** Records disclosed by one response, once per owning file/table even through multiple occurrences. */
export class ReadAudit {
  private readonly tables = new Map<Store, Map<string, Set<number>>>();

  add(store: Store, table: string, ids: number[]): void {
    if (!ids.length) return;
    let tables = this.tables.get(store);
    if (!tables) this.tables.set(store, tables = new Map());
    let records = tables.get(table);
    if (!records) tables.set(table, records = new Set());
    for (const id of ids) records.add(id);
  }

  log(privileges: Privileges): void {
    for (const [store, tables] of this.tables) {
      for (const [table, ids] of tables) store.logRead(table, [...ids], { privileges });
    }
  }
}
