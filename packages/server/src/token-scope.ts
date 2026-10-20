// What a scoped API token (store.createApiToken) leaves an AI app at /mcp: the account's own privileges, narrowed
// the way the Data API narrows them, never widened. A read-only token views and runs no scripts; a layout-scoped
// token uses only its layouts and the tables behind them. Either way it is no longer [Full Access], so the design
// tools are gone, and the tools that see the whole file (raw SQL, free-form formulas) are refused (see mcp.ts).

import { Privileges, type Level, type PrivilegeDefinition, type Store, type TablePrivileges } from '../../store/src/index.ts';

export interface TokenScope {
  readOnly?: boolean;
  /** Layout names, as the token was made with. */
  layouts?: string[];
}

const ALL: TablePrivileges = { view: true, edit: true, create: true, delete: true };
const NONE: TablePrivileges = { view: false, edit: false, create: false, delete: false };
const viewOnly = (t: TablePrivileges): TablePrivileges => ({ ...t, edit: false, create: false, delete: false });
const atMostView = (l: Level): Level => (l === 'modifiable' ? 'viewOnly' : l);

export const scoped = (scope: TokenScope | undefined) => !!scope && (!!scope.readOnly || !!scope.layouts?.length);

/** The set as a plain definition, [Full Access] spelled out, so it can be narrowed. */
function explicit(p: Privileges): PrivilegeDefinition {
  if (!p.full) {
    const { id: _id, ...set } = structuredClone(p.set);
    return set;
  }
  return { name: p.name, records: { ...ALL }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [...p.set.extendedPrivileges] };
}

// Field levels and masks are left as they are: a read-only token already cannot change anything, and a masked
// field stays masked (a scope only ever narrows, and masked is never more readable than viewOnly).
function readOnly(set: PrivilegeDefinition): void {
  set.records = viewOnly(set.records);
  if (set.tables) for (const k of Object.keys(set.tables)) set.tables[k] = viewOnly(set.tables[k]);
  set.layouts = atMostView(set.layouts);
  if (set.layoutAccess) for (const k of Object.keys(set.layoutAccess)) set.layoutAccess[k] = { layout: set.layoutAccess[k].layout, records: atMostView(set.layoutAccess[k].records) };
  // A script can change anything its account may: a token that only reads runs none, as on the Data API.
  set.scripts = 'none';
  delete set.scriptAccess;
}

/** The account's privileges in `store`, narrowed to the token's scope. */
export function narrowPrivileges(store: Store, p: Privileges, scope: TokenScope | undefined): Privileges {
  if (!scoped(scope)) return p;
  const fixed = structuredClone(scope!);
  const cache = new WeakMap<Privileges, Privileges>();
  const ceiling = (p: Privileges): Privileges => {
    if (p.ceiling === ceiling) return p;
    const cached = cache.get(p);
    if (cached) return cached;
    // Layout names belong to the token's file; the read-only ceiling follows into every file.
    if (p.file !== store && !fixed.readOnly) {
      const other = p.withCeiling(ceiling);
      cache.set(p, other);
      return other;
    }
    const set = explicit(p);
    set.name = `${p.name} (token)`;
    if (p.file === store && fixed.layouts?.length) {
      const tables: Record<string, TablePrivileges> = {};
      const layoutAccess: Record<string, { layout: Level; records: Level }> = {};
      for (const name of fixed.layouts) {
        const real = store.schema.layouts.find((l) => l.name.toLowerCase() === name.toLowerCase())?.name;
        if (!real) continue;
        layoutAccess[real] = p.layout(real);
        let table: string | undefined;
        try {
          table = store.layout(real).table;
        } catch {
          table = undefined;
        }
        if (table) tables[table] = structuredClone(p.table(table));
      }
      set.layouts = 'none';
      set.layoutAccess = layoutAccess;
      set.records = { ...NONE };
      set.tables = tables;
    }
    if (fixed.readOnly) readOnly(set);
    // Synthetic token rules aren't attributed to the saved privilege set.
    // Related records in other files: the token's read-only rule follows; its layouts are this file's.
    const limited = new Privileges(p.account, set, p.file, (file) => ceiling(p.in(file)), false, ceiling).withVia(p.via);
    cache.set(p, limited);
    return limited;
  };
  return ceiling(p);
}
