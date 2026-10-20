// Pending design changes: staged by a person (or the assistant, or a script) and looked over before they are applied.
//
// A staged change is a DesignOp with who staged it, when, and the design history position it was staged against.
// Reviewing them describes each in words, shows the text of a calculation, custom function or script before and after,
// what a rename or delete would break (change-impact.ts), whether it would apply at all, and whether someone else has
// changed the same thing since it was staged. Applying takes the ones asked for, in order, leaves out what cannot be
// applied (saying why), and keeps those for another go. The pending list lives in memory: it is a to-do list, and
// a restart of the server clears it (what was applied is in the design history for good).
//
//   GET  /tabularius/design/v1/databases/<db>/pending           the review
//   POST /tabularius/design/v1/databases/<db>/pending           {"changes": [...]} stages them
//   POST /tabularius/design/v1/databases/<db>/pending/apply     {"ids": [...], "overrideConflicts": [...]} (ids absent: all)
//   POST /tabularius/design/v1/databases/<db>/pending/discard   {"ids": [...]} (ids absent: all)

import { scriptText, type LayoutDesigns, type Schema } from '../../fmp12/src/index.ts';
import { StoreError, type DesignOp, type Store } from '../../store/src/index.ts';
import { describeDiff } from './design-preview.ts';
import type { ChangeImpact, ChangeKind, ImpactKind } from './change-impact.ts';

/** How many changes can wait at once; the review checks each against those before it. */
export const MAX_PENDING = 100;
/** Text longer than this (a very long script) is cut in the review; the change itself is kept whole. */
const MAX_TEXT = 400_000;

export interface PendingChange {
  id: number;
  op: DesignOp;
  by: string | null;
  at: string;
  /** The last design history entry when it was staged: later entries by others on the same thing are conflicts. */
  baseSeq: number;
}

/** What a change is about, for grouping and for finding other changes to the same thing. */
export interface ObjectRef {
  kind: string;
  /** "script", "table occurrence", ... */
  label: string;
  name: string;
  /** Names of this thing: by id, and by name (a thing not made yet has no id). Two changes touch the same thing when these meet. */
  keys: string[];
  /** The thing this belongs to (a field's table): changing that wholesale touches this too. */
  parent?: string;
}

export interface TextDiff {
  label: string;
  before: string;
  after: string;
  /** The text was cut at this many characters. */
  cut?: number;
}

export interface Conflict {
  seq: number;
  at: string;
  account: string | null;
  /** What they did, in words. */
  what: string;
}

export interface ReviewedChange {
  id: number;
  op: DesignOp;
  by: string | null;
  at: string;
  title: string;
  object: Pick<ObjectRef, 'kind' | 'label' | 'name'>;
  /** What it does, one line each. */
  lines: string[];
  diffs: TextDiff[];
  impact?: Pick<ChangeImpact, 'change' | 'summary' | 'useCount'> & { breaking: number };
  /** ready: applies as things stand. blocked: it would be refused (message says why). */
  status: 'ready' | 'blocked';
  message?: string;
  /** Changes made to the same thing since this was staged. */
  conflicts: Conflict[];
}

export interface Review {
  changes: ReviewedChange[];
  /** The design history position now. */
  seq: number;
}

export interface ApplyResult {
  applied: { id: number; title: string }[];
  blocked: { id: number; title: string; message: string }[];
  conflicts: { id: number; title: string; conflicts: Conflict[] }[];
  /** Still waiting (blocked, in conflict, or not asked for). */
  remaining: number;
}

type Catalog = { kind: string; label: string; ref: string; list: (s: Schema, d: LayoutDesigns) => { id: number; name: string }[] };

const CATALOGS: Record<string, Catalog> = {
  Table: { kind: 'table', label: 'table', ref: 'table', list: (s) => s.tables },
  Occurrence: { kind: 'occurrence', label: 'table occurrence', ref: 'occurrence', list: (s) => s.tableOccurrences },
  Relationship: { kind: 'relationship', label: 'relationship', ref: 'relationship', list: (s) => s.relationships.map((r) => ({ id: r.id, name: `relationship ${r.id}` })) },
  ValueList: { kind: 'valueList', label: 'value list', ref: 'valueList', list: (s) => s.valueLists },
  ExtendedPrivilege: { kind: 'extendedPrivilege', label: 'extended privilege', ref: 'extendedPrivilege', list: (s) => s.extendedPrivileges },
  CustomFunction: { kind: 'customFunction', label: 'custom function', ref: 'customFunction', list: (s) => s.customFunctions },
  DataSource: { kind: 'dataSource', label: 'data source', ref: 'dataSource', list: (s) => s.dataSources },
  ContainerDirectory: { kind: 'containerDirectory', label: 'container folder', ref: 'directory', list: (s) => (s.containerDirectories ?? []).map((d) => ({ id: d.id, name: (d as { path?: string }).path ?? `folder ${d.id}` })) },
  Layout: { kind: 'layout', label: 'layout', ref: 'layout', list: (s) => s.layouts },
  Component: { kind: 'component', label: 'component', ref: 'component', list: (_s, d) => d.components ?? [] },
  Script: { kind: 'script', label: 'script', ref: 'script', list: (s) => s.scripts },
  CustomMenu: { kind: 'customMenu', label: 'custom menu', ref: 'customMenu', list: (s) => s.customMenus },
  MenuSet: { kind: 'menuSet', label: 'menu set', ref: 'menuSet', list: (s) => s.customMenuSets },
  Theme: { kind: 'theme', label: 'theme', ref: 'theme', list: (s) => s.themes },
};

const VERBS: Record<string, string> = { create: 'Add', update: 'Change', delete: 'Delete' };

interface State { schema: Schema; designs: LayoutDesigns }

const lower = (s: string) => s.toLowerCase();

function find(list: { id: number; name: string }[], ref: unknown): { id: number; name: string } | undefined {
  if (typeof ref === 'number') return list.find((x) => x.id === ref);
  if (typeof ref === 'string') return list.find((x) => lower(x.name) === lower(ref));
  return undefined;
}

/** What an op is about, read against a design state (current names; a thing already gone is named by its id). */
export function objectOf(op: DesignOp, state: State): ObjectRef {
  const o = op as Record<string, unknown>;
  const m = /^(create|update|delete)([A-Za-z]+)$/.exec(op.op);
  const named = (cat: Catalog, ref: unknown, create: boolean): ObjectRef => {
    const hit = create ? undefined : find(cat.list(state.schema, state.designs), ref);
    const name = hit?.name ?? (typeof ref === 'string' ? ref : create && typeof o.name === 'string' ? o.name : `${cat.label} ${String(ref)}`);
    const keys = [];
    const id = hit?.id ?? (typeof ref === 'number' ? ref : typeof o.id === 'number' && create ? o.id : undefined);
    if (id !== undefined) keys.push(`${cat.kind}:${id}`);
    keys.push(`${cat.kind}:~${lower(name)}`);
    return { kind: cat.kind, label: cat.label, name, keys };
  };
  if (m && m[2] === 'Field') {
    const create = m[1] === 'create';
    const table = find(state.schema.tables, o.table);
    const tableName = table?.name ?? String(o.table);
    const field = create ? undefined : table ? find((table as unknown as { fields: { id: number; name: string }[] }).fields, o.field) : undefined;
    const fieldName = field?.name ?? (create ? String(o.name) : String(o.field));
    const keys = [];
    const tid = table?.id ?? (typeof o.table === 'number' ? o.table : undefined);
    const fid = field?.id ?? (typeof o.field === 'number' ? o.field : create && typeof o.id === 'number' ? o.id : undefined);
    if (tid !== undefined && fid !== undefined) keys.push(`field:${tid}.${fid}`);
    keys.push(`field:~${lower(tableName)}::${lower(fieldName)}`);
    return { kind: 'field', label: 'field', name: `${tableName}::${fieldName}`, keys, parent: tid !== undefined ? `table:${tid}` : `table:~${lower(tableName)}` };
  }
  if (m && m[2] === 'Style') {
    const theme = find(state.schema.themes, o.theme);
    const themeName = theme?.name ?? String(o.theme);
    const style = String(o.style ?? o.name);
    return { kind: 'style', label: 'style', name: `${themeName}: ${style}`, keys: [`style:${theme?.id ?? `~${lower(themeName)}`}/${lower(style)}`], parent: theme ? `theme:${theme.id}` : `theme:~${lower(themeName)}` };
  }
  if (m && CATALOGS[m[2]]) {
    const cat = CATALOGS[m[2]];
    return named(cat, m[1] === 'create' ? o.name : o[cat.ref], m[1] === 'create');
  }
  if (op.op === 'setOrder') return { kind: 'order', label: 'list order', name: `${String(o.list)} list`, keys: [`order:${String(o.list)}`] };
  if (op.op === 'setDefaultMenuSet') return { kind: 'file', label: 'file option', name: 'Default menu set', keys: ['file:menuSet'] };
  if (op.op === 'setFileOptions') return { kind: 'file', label: 'file option', name: 'File options', keys: ['file:options'] };
  if (op.op === 'restoreDeleted') return { kind: 'deleted', label: 'deleted item', name: `Deleted item ${String(o.deleted)}`, keys: [`deleted:${String(o.deleted)}`] };
  return { kind: 'other', label: 'design', name: op.op, keys: [`other:${op.op}`] };
}

/** One line for a change: "Change script Orders", "Delete field Clients::Notes", "Rename table Clients to Customers". */
export function titleOf(op: DesignOp, state: State): string {
  const ref = objectOf(op, state);
  const o = op as Record<string, unknown>;
  if (op.op === 'renameTable') return `Rename table ${ref.name} to ${String(o.name)}`;
  const m = /^(create|update|delete)/.exec(op.op);
  if (m && ref.kind !== 'other') {
    const to = m[1] === 'update' && typeof o.name === 'string' && lower(o.name) !== lower(ref.name) ? ` to ${o.name}` : '';
    return `${to ? 'Rename' : VERBS[m[1]]} ${ref.label} ${ref.name}${to}`;
  }
  if (op.op === 'setOrder') return `Reorder the ${ref.name}`;
  if (op.op === 'restoreDeleted') return `Restore ${ref.name.toLowerCase()}`;
  if (ref.kind === 'file') return `Change ${ref.name.toLowerCase()}`;
  return op.op;
}

/** The texts a thing carries that are worth reading side by side, in a design state (none when it isn't there). */
function textsOf(ref: ObjectRef, state: State): { label: string; text: string }[] {
  const { schema } = state;
  if (ref.kind === 'script') {
    const s = find(schema.scripts, ref.name) as (typeof schema.scripts)[number] | undefined;
    return s ? [{ label: 'Script', text: scriptText(s.steps) }] : [];
  }
  if (ref.kind === 'customFunction') {
    const f = find(schema.customFunctions, ref.name) as (typeof schema.customFunctions)[number] | undefined;
    return f ? [{ label: `Function ${f.name} ( ${f.parameters.join('; ')} )`, text: f.formula ?? '' }] : [];
  }
  if (ref.kind === 'field') {
    const [t, f] = ref.name.split('::');
    const table = schema.tables.find((x) => lower(x.name) === lower(t));
    const field = table?.fields.find((x) => lower(x.name) === lower(f));
    if (!field) return [];
    const out = [];
    if (field.calculation) out.push({ label: field.kind === 'calculation' ? 'Calculation' : 'Auto-enter calculation', text: field.calculation });
    if (field.options?.validation?.calculation) out.push({ label: 'Validation calculation', text: field.options.validation.calculation });
    return out;
  }
  return [];
}

const cut = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);

/** The texts of a thing before and after (matched by label), those that differ. */
function diffsFor(refBefore: ObjectRef, refAfter: ObjectRef, before: State, after: State): TextDiff[] {
  const was = textsOf(refBefore, before);
  const now = textsOf(refAfter, after);
  const labels = [...new Set([...was.map((t) => t.label), ...now.map((t) => t.label)])];
  const out: TextDiff[] = [];
  for (const label of labels) {
    const a = was.find((t) => t.label === label)?.text ?? '';
    const b = now.find((t) => t.label === label)?.text ?? '';
    if (a === b) continue;
    const long = Math.max(a.length, b.length);
    out.push({ label, before: cut(a), after: cut(b), ...(long > MAX_TEXT ? { cut: MAX_TEXT } : {}) });
  }
  return out;
}

/** The thing a change leaves behind: made by a create (read from the state after), or under its new name after a rename. */
function afterRef(op: DesignOp, ref: ObjectRef, after: State): ObjectRef {
  if (op.op.startsWith('create')) return objectOf(op, after);
  const name = (op as Record<string, unknown>).name;
  if (typeof name !== 'string') return ref;
  return { ...ref, name: ref.kind === 'field' ? `${ref.name.split('::')[0]}::${name}` : name };
}

/** What a rename or delete of this change would put at risk, as change-impact.ts looks it up; undefined for changes that neither rename nor delete. */
export function impactOf(op: DesignOp, ref: ObjectRef): { kind: ImpactKind; name: string; change: ChangeKind } | undefined {
  const o = op as Record<string, unknown>;
  const kinds: Record<string, ImpactKind> = { table: 'table', field: 'field', layout: 'layout', script: 'script', valueList: 'valueList' };
  const kind = kinds[ref.kind];
  if (!kind) return undefined;
  if (op.op.startsWith('delete')) return { kind, name: ref.name, change: 'delete' };
  const renamed = op.op === 'renameTable' || (op.op.startsWith('update') && typeof o.name === 'string' && lower(o.name) !== lower(ref.kind === 'field' ? ref.name.split('::')[1] : ref.name));
  return renamed ? { kind, name: ref.name, change: 'rename' } : undefined;
}

/** The pending changes of one hosted file. */
export class PendingChanges {
  private readonly lists = new WeakMap<Store, { next: number; list: PendingChange[]; own: Set<number> }>();

  private of(store: Store) {
    let s = this.lists.get(store);
    if (!s) this.lists.set(store, (s = { next: 1, list: [], own: new Set() }));
    return s;
  }

  private seq(store: Store): number {
    return store.designHistory(1)[0]?.seq ?? 0;
  }

  /** Waiting changes, oldest first. */
  list(store: Store): PendingChange[] {
    return this.of(store).list;
  }

  stage(store: Store, ops: unknown[], by: string | null): PendingChange[] {
    const s = this.of(store);
    if (!ops.length) throw new StoreError(960, 'Send at least one change');
    if (s.list.length + ops.length > MAX_PENDING) throw new StoreError(960, `Only ${MAX_PENDING} changes can wait for review at once; apply or discard some first`);
    for (const op of ops) {
      if (!op || typeof op !== 'object' || typeof (op as { op?: unknown }).op !== 'string') throw new StoreError(960, 'Each change is an object with an "op", such as {"op": "createTable", "name": "Orders"}');
    }
    const at = new Date().toISOString();
    const baseSeq = this.seq(store);
    const made = (ops as DesignOp[]).map((op): PendingChange => ({ id: s.next++, op, by, at, baseSeq }));
    s.list.push(...made);
    return made;
  }

  discard(store: Store, ids?: number[]): number {
    const s = this.of(store);
    const before = s.list.length;
    s.list = ids ? s.list.filter((p) => !ids.includes(p.id)) : [];
    return before - s.list.length;
  }

  /** Changes made to the same thing since this one was staged, by anyone other than this list's own applies. */
  conflicts(store: Store, p: PendingChange): Conflict[] {
    const s = this.of(store);
    const state = { schema: store.schema, designs: store.designs() };
    const mine = objectOf(p.op, state);
    const out: Conflict[] = [];
    for (const h of store.designHistory(2000)) {
      if (h.seq <= p.baseSeq || s.own.has(h.seq)) continue;
      const theirs = objectOf(h.op, state);
      const touches = theirs.keys.some((k) => mine.keys.includes(k)) || (mine.parent !== undefined && theirs.keys.includes(mine.parent)) || (theirs.parent !== undefined && mine.keys.includes(theirs.parent));
      if (touches) out.push({ seq: h.seq, at: h.at, account: h.account, what: titleOf(h.op, state) });
    }
    return out;
  }

  /** Each waiting change described, checked in order against the ones before it (a field made by an earlier change is there for a later one). */
  async review(store: Store, impact?: (kind: ImpactKind, name: string, change: ChangeKind) => Promise<ChangeImpact>): Promise<Review> {
    const s = this.of(store);
    const accepted: DesignOp[] = [];
    const out: ReviewedChange[] = [];
    let state: State = { schema: store.schema, designs: store.designs() };
    for (const p of s.list) {
      const ref = objectOf(p.op, state);
      const base = { id: p.id, op: p.op, by: p.by, at: p.at, title: titleOf(p.op, state), object: { kind: ref.kind, label: ref.label, name: ref.name }, conflicts: this.conflicts(store, p) };
      let after: State;
      try {
        const r = store.checkDesign([...accepted, p.op]);
        after = { schema: r.schema, designs: r.designs };
      } catch (e) {
        if (!(e instanceof StoreError)) throw e;
        out.push({ ...base, lines: [], diffs: [], status: 'blocked', message: e.message });
        continue;
      }
      accepted.push(p.op);
      const target = afterRef(p.op, ref, after);
      let found: ReviewedChange['impact'];
      const i = impact && impactOf(p.op, ref);
      if (impact && i) {
        try {
          const r = await impact(i.kind, i.name, i.change);
          found = { change: r.change, summary: r.summary, useCount: r.useCount, breaking: r.uses.filter((u) => u.breaks).length + r.privileges.filter((x) => x.breaks).length + r.clients.length };
        } catch { /* the thing isn't there to look up (an earlier change made or removed it) */ }
      }
      out.push({ ...base, lines: describeDiff(state.schema, after.schema), diffs: diffsFor(ref, target, state, after), ...(found ? { impact: found } : {}), status: 'ready' });
      state = after;
    }
    return { changes: out, seq: this.seq(store) };
  }

  /**
   * Applies the ones asked for (all when `ids` is absent), in the order they were staged. A change in conflict is left
   * unless it is named in `override`; one the design would refuse (because of the ones left out, say) is left with the reason.
   */
  apply(store: Store, account: string | null, ids?: number[], override: number[] = []): ApplyResult {
    const s = this.of(store);
    const chosen = s.list.filter((p) => !ids || ids.includes(p.id));
    const state: State = { schema: store.schema, designs: store.designs() };
    const result: ApplyResult = { applied: [], blocked: [], conflicts: [], remaining: 0 };
    const ops: DesignOp[] = [];
    const taken: PendingChange[] = [];
    for (const p of chosen) {
      const title = titleOf(p.op, state);
      const conflicts = this.conflicts(store, p);
      if (conflicts.length && !override.includes(p.id)) {
        result.conflicts.push({ id: p.id, title, conflicts });
        continue;
      }
      try {
        store.checkDesign([...ops, p.op]);
      } catch (e) {
        if (!(e instanceof StoreError)) throw e;
        result.blocked.push({ id: p.id, title, message: e.message });
        continue;
      }
      ops.push(p.op);
      taken.push(p);
    }
    if (ops.length) {
      const last = this.seq(store);
      store.applyDesign(ops, { account: account ?? undefined });
      for (const h of store.designHistory(ops.length + 20)) if (h.seq > last) s.own.add(h.seq);
      const done = new Set(taken.map((p) => p.id));
      const titles = new Map(taken.map((p) => [p.id, titleOf(p.op, state)]));
      s.list = s.list.filter((p) => !done.has(p.id));
      result.applied = taken.map((p) => ({ id: p.id, title: titles.get(p.id)! }));
    }
    result.remaining = s.list.length;
    return result;
  }
}
