// "Who can see this?" The question a privilege audit is really asked, answered the other way round from explain_access:
// for a table (or one field), which accounts of a file can view it, change it, add to it or delete from it, grouped by
// privilege set and said in plain words. A record rule that limits rows ("only its own") reads as "some records".
// Read-only, names only: it shows accounts, privilege sets and field names, never a record's values.

import type { Store } from '../../store/src/index.ts';

export type Reach = 'all records' | 'some records' | 'no';

export interface SetReach {
  privilegeSet: string;
  accounts: string[];
  view: Reach;
  edit: Reach;
  create: 'yes' | 'no';
  delete: Reach;
  /** Fields of the table this set can't see at all, when it can see the table. */
  hiddenFields: string[];
  /** Fields it can see but not change. */
  readOnlyFields: string[];
  /** Fields it sees only as a stand-in (last four characters, or a fixed text), not the value. */
  maskedFields: string[];
  /** For a single field: the set sees only a masked version of it. */
  masked?: boolean;
  /** One sentence, e.g. "Sales (ann, bob) can see all records, change some records and not delete." */
  says: string;
}

export interface WhoCan {
  database: string;
  table: string;
  field?: string;
  /** Sets with at least one active account, most access first. */
  sets: SetReach[];
  /** Active accounts that can see the table (or field) at all. */
  canSee: string[];
  /** For a single field: active accounts that see only a masked version of it (not counted in canSee). */
  canSeeMasked?: string[];
  /** One paragraph for a person or an AI to quote. */
  summary: string;
}

const reach = (rule: boolean | string): Reach => (rule === true ? 'all records' : rule === false ? 'no' : 'some records');
const rank = (r: Reach) => (r === 'all records' ? 2 : r === 'some records' ? 1 : 0);
const list = (xs: string[]) => (xs.length <= 6 ? xs.join(', ') : `${xs.slice(0, 6).join(', ')} and ${xs.length - 6} more`);

export function whoCan(store: Store, tableName: string, fieldName?: string): WhoCan {
  const table = store.schema.tables.find((t) => t.name.toLowerCase() === tableName.toLowerCase());
  if (!table) throw new Error(`No table named "${tableName}"`);
  const field = fieldName === undefined ? undefined : table.fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
  if (fieldName !== undefined && !field) throw new Error(`No field "${fieldName}" in ${table.name}`);

  const bySet = new Map<string, string[]>();
  for (const a of store.accounts()) {
    if (a.inactive || !a.privilegeSet) continue;
    (bySet.get(a.privilegeSet) ?? bySet.set(a.privilegeSet, []).get(a.privilegeSet)!).push(a.name);
  }

  const sets: SetReach[] = [];
  const canSee: string[] = [];
  const canSeeMasked: string[] = [];
  for (const [set, accounts] of bySet) {
    const p = store.privileges(accounts[0]);
    const t = p.table(table.name);
    const level = field ? p.fieldAccess(table.name, field.name) : undefined;
    // A field the set can't see, or can only see, narrows what the table row says.
    const seen = field ? (level === 'none' ? 'no' : reach(t.view)) : reach(t.view);
    const canEdit = field && level !== 'modifiable' ? 'no' : reach(t.edit);
    const hidden: string[] = [];
    const readOnly: string[] = [];
    const masked: string[] = [];
    if (!field && seen !== 'no') {
      for (const f of table.fields) {
        const l = p.fieldAccess(table.name, f.name);
        if (l === 'none') hidden.push(f.name);
        else if (l === 'masked') masked.push(f.name);
        else if (l === 'viewOnly') readOnly.push(f.name);
      }
    }
    const r: SetReach = {
      privilegeSet: set, accounts: accounts.sort(), view: seen, edit: seen === 'no' ? 'no' : canEdit, create: t.create && seen !== 'no' && !field ? 'yes' : 'no',
      delete: seen === 'no' || field ? 'no' : reach(t.delete), hiddenFields: hidden, readOnlyFields: readOnly, maskedFields: masked, says: '',
    };
    if (field && level === 'masked' && seen !== 'no') r.masked = true;
    if (field) r.create = 'no';
    const parts: string[] = [];
    if (r.view === 'no') parts.push(field ? `cannot see ${table.name}::${field!.name}` : `cannot see ${table.name}`);
    else {
      parts.push(r.masked ? `can see ${r.view} but only a masked version of ${table.name}::${field!.name}` : `can see ${r.view}`);
      if (r.edit !== 'no') parts.push(`change ${r.edit}`); else parts.push('not change any');
      if (!field) {
        parts.push(r.create === 'yes' ? 'add new ones' : 'not add');
        parts.push(r.delete === 'no' ? 'not delete' : `delete ${r.delete}`);
      }
    }
    const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    r.says = `${set} (${list(r.accounts)}) ${joined}${r.hiddenFields.length ? `; cannot see ${list(r.hiddenFields)}` : ''}${r.maskedFields.length ? `; sees only a masked version of ${list(r.maskedFields)}` : ''}.`;
    sets.push(r);
    if (r.masked) canSeeMasked.push(...r.accounts);
    else if (r.view !== 'no') canSee.push(...r.accounts);
  }
  sets.sort((a, b) => rank(b.view) - rank(a.view) || rank(b.edit) - rank(a.edit) || a.privilegeSet.localeCompare(b.privilegeSet));
  const what = field ? `${table.name}::${field.name}` : table.name;
  const summary = sets.length
    ? `${canSee.length} of ${bySet.size ? [...bySet.values()].flat().length : 0} active accounts can see ${what}${canSeeMasked.length ? ` (${canSeeMasked.length} more see only a masked version)` : ''}. ${sets.map((s) => s.says).join(' ')}`
    : `No active account has a privilege set, so nobody can see ${what}.`;
  return { database: store.name, table: table.name, ...(field ? { field: field.name } : {}), sets, canSee: canSee.sort(), ...(canSeeMasked.length ? { canSeeMasked: canSeeMasked.sort() } : {}), summary };
}
