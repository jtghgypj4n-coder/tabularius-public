// Taking design changes back to FileMaker by hand: what changed between the
// schema read from the original .fmp12 and the file as it is now, as
// clipboard snippets to paste into FileMaker Pro in order, plus a list of the
// changes a paste can't make. This is the write-back path that needs no
// Claris tools (docs/research/write-back.md, route D): FileMaker Pro pastes
// new objects but never overwrites one, so anything renamed, edited in place
// or deleted is written down for the person to do in FileMaker.
//
// Objects are matched by id: an imported object keeps FileMaker's id, and one
// made here gets an id the original never had.

import type { CustomFunction, Field, Relationship, Schema, Script, Table, TableOccurrence, ValueList } from '../../fmp12/src/index.ts';
import { designSnippet } from './snippet-xml.ts';

export interface PasteStep {
  /** Where to paste it in FileMaker Pro, as a sentence. */
  where: string;
  /** The objects it carries, by name. */
  names: string[];
  /** fmxmlsnippet XML, to put on FileMaker's clipboard. */
  xml: string;
  /** What the snippet leaves out (from designSnippet). */
  notes: string[];
  /** Fields go into this existing table, steps into this existing script. */
  into?: { table?: string; script?: string };
}

export interface WriteBackKit {
  /** In the order to paste them: functions, tables and fields come before what refers to them. */
  paste: PasteStep[];
  /** Changes to make by hand in FileMaker, one sentence each. */
  byHand: string[];
}

/** A stable JSON form for comparing two objects (key order ignored). */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, norm((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * `v` with every renamed name swapped for its new one, as FileMaker itself
 * updates formulas and references when something is renamed: whole strings
 * that are an old name, and old names inside formulas (as whole words).
 */
function follow<T>(v: T, renames: [string, string][]): T {
  if (!renames.length) return v;
  const word = (n: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'gu');
  const res = renames.map(([from, to]) => [word(from), to] as const);
  const map = (x: unknown): unknown => {
    if (typeof x === 'string') return res.reduce((s, [re, to]) => s.replace(re, () => to), x);
    if (Array.isArray(x)) return x.map(map);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, map(y)]));
    return x;
  };
  return map(v) as T;
}

/** Every rename between the two schemas (tables, fields, occurrences and the named catalogs), old name first. */
function renamesOf(a: Schema, b: Schema): [string, string][] {
  const out: [string, string][] = [];
  const pair = <T extends { id: number; name: string }>(xs: T[], ys: T[]) => {
    const old = new Map(xs.map((x) => [x.id, x.name]));
    for (const y of ys) {
      const was = old.get(y.id);
      if (was !== undefined && was !== y.name) out.push([was, y.name]);
    }
  };
  pair(a.tables, b.tables);
  for (const t of b.tables) pair(a.tables.find((x) => x.id === t.id)?.fields ?? [], t.fields);
  pair(a.tableOccurrences, b.tableOccurrences);
  pair(a.customFunctions, b.customFunctions);
  pair(a.valueLists, b.valueLists);
  pair(a.scripts, b.scripts);
  pair(a.layouts, b.layouts);
  return out;
}

interface Diff<T> { added: T[]; removed: T[]; renamed: [T, T][]; changed: [T, T][] }

/**
 * Added, removed, renamed and otherwise changed items of two lists, by id. A
 * difference that is only a rename showing through (a formula naming a
 * renamed field) doesn't count as a change.
 */
function diff<T extends { id: number; name: string }>(before: T[], after: T[], renames: [string, string][] = []): Diff<T> {
  const old = new Map(before.map((x) => [x.id, x]));
  const now = new Map(after.map((x) => [x.id, x]));
  const out: Diff<T> = { added: [], removed: [], renamed: [], changed: [] };
  for (const x of after) {
    const was = old.get(x.id);
    if (!was) out.added.push(x);
    else {
      if (was.name !== x.name) out.renamed.push([was, x]);
      if (!same(follow({ ...was, name: '' }, renames), { ...x, name: '' })) out.changed.push([was, x]);
    }
  }
  for (const x of before) if (!now.has(x.id)) out.removed.push(x);
  return out;
}

const list = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

/** The paste-by-hand kit that takes `current`'s design changes back to the FileMaker file `original` was read from. */
export function writeBackKit(original: Schema, current: Schema): WriteBackKit {
  const paste: PasteStep[] = [];
  const byHand: string[] = [];
  const renames = renamesOf(original, current);
  const step = (where: string, names: string[], pick: Parameters<typeof designSnippet>[1], into?: PasteStep['into']) => {
    const { xml, notes } = designSnippet(current, pick);
    paste.push({ where, names, xml, notes, ...(into && { into }) });
  };

  // Custom functions first: fields and scripts pasted later may call them.
  const cfs = diff<CustomFunction>(original.customFunctions, current.customFunctions, renames);
  const newCfs = cfs.added.filter((f) => f.language !== 'javascript');
  for (const f of cfs.added) if (f.language === 'javascript') byHand.push(`Custom function "${f.name}" is written in JavaScript, which FileMaker can't run: it has no FileMaker version.`);
  if (newCfs.length) step('File > Manage > Custom Functions, then paste.', newCfs.map((f) => f.name), { customFunctions: newCfs.map((f) => f.id) });
  for (const [was, now] of cfs.renamed) byHand.push(`Rename custom function "${was.name}" to "${now.name}" (File > Manage > Custom Functions).`);
  for (const [, now] of cfs.changed) byHand.push(`Edit custom function "${now.name}": its parameters or formula changed. The formula is now: ${now.formula ?? '(none)'}`);
  for (const f of cfs.removed) byHand.push(`Delete custom function "${f.name}" (File > Manage > Custom Functions).`);

  // Tables, then fields added to tables FileMaker already has.
  const tables = diff<Table>(original.tables, current.tables);
  if (tables.added.length) step('File > Manage > Database, Tables tab, then paste. Each table comes with its fields.', tables.added.map((t) => t.name), { tables: tables.added.map((t) => t.id) });
  for (const [was, now] of tables.renamed) byHand.push(`Rename table "${was.name}" to "${now.name}" (File > Manage > Database, Tables tab).`);
  for (const t of tables.removed) byHand.push(`Delete table "${t.name}" (File > Manage > Database, Tables tab). Its records go with it.`);
  for (const [wasT, nowT] of tables.changed) {
    const fields = diff<Field>(wasT.fields, nowT.fields, renames);
    if (fields.added.length) {
      step(`File > Manage > Database, Fields tab, choose table "${nowT.name}", then paste.`, fields.added.map((f) => f.name), { fields: { table: nowT.id, ids: fields.added.map((f) => f.id) } }, { table: nowT.name });
    }
    for (const [was, now] of fields.renamed) byHand.push(`Rename field "${nowT.name}::${was.name}" to "${now.name}".`);
    for (const [was, now] of fields.changed) byHand.push(fieldChange(nowT, was, now));
    for (const f of fields.removed) byHand.push(`Delete field "${nowT.name}::${f.name}". Its data goes with it.`);
  }

  // The relationships graph can't be pasted.
  const occ = diff<TableOccurrence>(original.tableOccurrences, current.tableOccurrences);
  const tableName = (id: number | undefined) => current.tables.find((t) => t.id === id)?.name ?? original.tables.find((t) => t.id === id)?.name ?? '?';
  for (const o of occ.added) byHand.push(`Add table occurrence "${o.name}" of table "${tableName(o.baseTableId)}" to the relationships graph.`);
  for (const [was, now] of occ.renamed) byHand.push(`Rename table occurrence "${was.name}" to "${now.name}".`);
  for (const [was, now] of occ.changed) if (was.baseTableId !== now.baseTableId || was.dataSourceId !== now.dataSourceId) byHand.push(`Point table occurrence "${now.name}" at table "${tableName(now.baseTableId)}".`);
  for (const o of occ.removed) byHand.push(`Delete table occurrence "${o.name}" from the relationships graph.`);
  const occName = (id: number) => current.tableOccurrences.find((o) => o.id === id)?.name ?? original.tableOccurrences.find((o) => o.id === id)?.name ?? '?';
  const rels = diff<Relationship & { name: string }>(
    original.relationships.map((r) => ({ ...r, name: '' })),
    current.relationships.map((r) => ({ ...r, name: '' })),
  );
  const between = (r: Relationship) => `"${occName(r.leftTableOccurrenceId)}" and "${occName(r.rightTableOccurrenceId)}"`;
  for (const r of rels.added) byHand.push(`Add a relationship between ${between(r)} (${predicates(current, r)}).`);
  for (const [, now] of rels.changed) byHand.push(`Change the relationship between ${between(now)}: it is now ${predicates(current, now)}.`);
  for (const r of rels.removed) byHand.push(`Delete the relationship between ${between(r)}.`);

  // Value lists.
  const vls = diff<ValueList>(original.valueLists, current.valueLists, renames);
  if (vls.added.length) step('File > Manage > Value Lists, then paste.', vls.added.map((v) => v.name), { valueLists: vls.added.map((v) => v.id) });
  for (const [was, now] of vls.renamed) byHand.push(`Rename value list "${was.name}" to "${now.name}".`);
  for (const [, now] of vls.changed) byHand.push(now.values ? `Edit value list "${now.name}": its values are now ${list(now.values)}.` : `Edit value list "${now.name}": where its values come from changed.`);
  for (const v of vls.removed) byHand.push(`Delete value list "${v.name}".`);

  // Scripts: new ones paste whole; an edited one gets all its steps, to paste over the old ones.
  const scripts = diff<Script>(original.scripts, current.scripts, renames);
  if (scripts.added.length) step('Scripts > Script Workspace, click in the scripts list, then paste.', scripts.added.map((s) => s.name), { scripts: scripts.added.map((s) => s.id) });
  for (const [was, now] of scripts.renamed) byHand.push(`Rename script "${was.name}" to "${now.name}".`);
  for (const [was, now] of scripts.changed) {
    if (same(follow(was.steps, renames), now.steps)) continue;
    if (!now.steps.length) byHand.push(`Delete every step of script "${now.name}".`);
    else step(`Scripts > Script Workspace, open script "${now.name}", select all its steps, delete them, then paste.`, [now.name], { steps: { script: now.id, indexes: now.steps.map((_, i) => i) } }, { script: now.name });
  }
  for (const s of scripts.removed) byHand.push(`Delete script "${s.name}".`);

  // Layouts: only which exist is compared here; objects on them are copied from Design mode.
  const layouts = diff(original.layouts, current.layouts);
  for (const l of layouts.added) byHand.push(`Make layout "${l.name}" in FileMaker, then copy its objects from Tabularius's Design mode and paste them in Layout mode.`);
  for (const [was, now] of layouts.renamed) byHand.push(`Rename layout "${was.name}" to "${now.name}".`);
  for (const l of layouts.removed) byHand.push(`Delete layout "${l.name}".`);

  return { paste, byHand };
}

function fieldChange(t: Table, was: Field, now: Field): string {
  const what: string[] = [];
  if (was.type !== now.type) what.push(`its type is now ${now.type}`);
  if (was.kind !== now.kind) what.push(`it is now a ${now.kind} field`);
  if (was.calculation !== now.calculation) what.push(now.calculation === undefined ? 'its calculation was removed' : `its calculation is now: ${now.calculation}`);
  if ((was.comment ?? '') !== (now.comment ?? '')) what.push(`its comment is now "${now.comment ?? ''}"`);
  if (!what.length) what.push('its options changed');
  return `Edit field "${t.name}::${now.name}": ${what.join('; ')}.`;
}

function predicates(s: Schema, r: Relationship): string {
  const occ = (id: number) => s.tableOccurrences.find((o) => o.id === id);
  const field = (occId: number, fieldId: number) => s.tables.find((t) => t.id === occ(occId)?.baseTableId)?.fields.find((f) => f.id === fieldId)?.name ?? '?';
  return r.predicates.map((p) => `${field(r.leftTableOccurrenceId, p.leftFieldId)} ${p.operator} ${field(r.rightTableOccurrenceId, p.rightFieldId)}`).join(' and ');
}
