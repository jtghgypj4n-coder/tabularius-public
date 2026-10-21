// What renaming or deleting a field, table, layout, value list or script would do, before it is done: every
// place in the file that uses it (and whether that use follows a rename or names it in text, where it breaks),
// privilege set entries that name it, other hosted files that reach into it, and Data API clients seen in the
// server's fmdapi log calling it.
//
// FileMaker's own references (a field on a layout, a calculation, a script step's target) are by id, so they
// follow a rename; a name inside quotes (GetField, ExecuteSQL, Evaluate, "by name" steps), a privilege set entry
// or a record limit's calculation (both kept by name) and an outside client (which sends names) do not. A delete breaks all of them.
//
//   GET /tabularius/design/v1/databases/<db>/impact?kind=&name=&change=rename|delete     (design.ts)
//   MCP tool check_change_impact                                                         ([Full Access])

import { isFullAccess, type Store } from '../../store/src/index.ts';
import { dataSourceFile } from '../../store/src/import.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { ServerLogs } from './server-logs.ts';
import { resolveTargets, solutionIndex, whereUsed, type Target, type TargetKind } from './insight.ts';

export type ImpactKind = Extract<TargetKind, 'field' | 'table' | 'layout' | 'script' | 'valueList'>;
export type ChangeKind = 'rename' | 'delete';

export interface ImpactUse {
  /** Where, as a person would find it. */
  where: string;
  text: string;
  /** True when this use stops working. */
  breaks: boolean;
  why: string;
}

export interface ImpactPrivilege {
  privilegeSet: string;
  entry: string;
  breaks: boolean;
  why: string;
}

export interface ImpactClient {
  surface: 'Data API';
  account: string;
  /** Calls seen in the log, and the latest. */
  calls: number;
  last: string;
  via: string;
}

/** A use in another hosted file: a table occurrence, relationship, script call or value list that points into this one. */
export interface CrossFileUse {
  /** The other file. */
  file: string;
  where: string;
  breaks: boolean;
  why: string;
}

export interface ChangeImpact {
  target: Target;
  change: ChangeKind;
  uses: ImpactUse[];
  /** Uses found in all, when more than are listed. */
  useCount: number;
  privileges: ImpactPrivilege[];
  clients: ImpactClient[];
  /** Uses in other hosted files that reach into this one. */
  crossFile: CrossFileUse[];
  /** Other files that reach into this one but whose names are kept from AI (so they are counted, not named, for an AI client). */
  crossFileHidden?: number;
  /** How far back the log was read, and whether it was there at all. */
  logDays: number;
  logRead: boolean;
  /** Plain sentences, what breaks first. */
  summary: string[];
}

/** Calculation text that names things in strings: a rename doesn't reach inside the quotes. */
const BY_NAME = /\b(ExecuteSQL|GetField|GetFieldName|Evaluate|GetNthRecord|ValueListItems|FieldNames|FieldType|FieldStyle|FieldRepetitions|FieldBounds|FieldComment|LayoutObjectNames|GetLayoutObjectAttribute|ScriptNames|LayoutNames|ValueListNames)\b|\bby name\b|\bby calculation\b/i;
const SQL = /\bSELECT\b[\s\S]*\bFROM\b/i;

const lower = (s: string) => s.toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A use that names the target inside a string (or a SQL query), which a rename won't change. */
function namesInText(text: string, target: Target): boolean {
  if (!BY_NAME.test(text) && !SQL.test(text)) return false;
  const bare = target.name.replace(/^.*::/, '');
  const names = target.kind === 'field' ? [target.name, bare] : [target.name];
  // Inside double quotes, or (for SQL) as a word anywhere in the query.
  const quoted = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  if (names.some((n) => quoted.some((q) => new RegExp(`(^|[^\\w])${esc(n)}($|[^\\w])`, 'i').test(q)))) return true;
  return SQL.test(text) && names.some((n) => new RegExp(`(^|[^\\w])"?${esc(n)}"?($|[^\\w])`, 'i').test(text));
}

function privilegeEntries(store: Store, target: Target, change: ChangeKind): ImpactPrivilege[] {
  const out: ImpactPrivilege[] = [];
  const [table, field] = target.kind === 'field' ? target.name.split('::') : [target.name, ''];
  const gone = change === 'delete' ? 'is left pointing at nothing' : `stops applying once it has a new name (entries are kept by name)`;
  for (const set of store.privilegeSets()) {
    if (isFullAccess(set)) continue;
    const add = (entry: string, fallback: string, breaks = true) =>
      out.push({ privilegeSet: set.name, entry, breaks, why: `This entry ${gone}; the set then gets ${fallback}.` });
    const key = <T>(m: Record<string, T> | undefined, name: string) => m && Object.keys(m).find((k) => lower(k) === lower(name));
    switch (target.kind) {
      case 'layout': {
        const k = key(set.layoutAccess, target.name);
        if (k) add(`layout "${k}": ${set.layoutAccess![k].layout}, records through it ${set.layoutAccess![k].records}`, `its access to all other layouts (${set.layouts})`);
        break;
      }
      case 'script': {
        const k = key(set.scriptAccess, target.name);
        if (k) add(`script "${k}": ${set.scriptAccess![k]}`, `its access to all other scripts (${set.scripts})`);
        break;
      }
      case 'valueList': {
        const k = key(set.valueListAccess, target.name);
        if (k) add(`value list "${k}": ${set.valueListAccess![k]}`, `its access to all other value lists (${set.valueLists})`);
        break;
      }
      case 'table': {
        const k = key(set.tables, table);
        if (k) add(`records in "${k}"`, 'the record access it gives tables without their own entry');
        break;
      }
      case 'field': {
        const k = key(set.tables, table);
        const fk = k ? key(set.tables![k].fields, field) : undefined;
        if (k && fk) add(`field "${k}::${fk}": ${set.tables![k].fields![fk]}`, 'full access to the field (fields not listed can be modified)');
        break;
      }
    }
    // Limits on records worked out by a calculation name fields as text.
    const rules: [string, unknown][] = [['all tables', set.records], ...Object.entries(set.tables ?? {})];
    for (const [where, t] of rules) {
      for (const what of ['view', 'edit', 'delete'] as const) {
        const rule = (t as Record<string, unknown>)[what];
        if (typeof rule !== 'string') continue;
        const names = target.kind === 'field' ? [target.name, field] : target.kind === 'table' ? [table] : [];
        if (!names.some((n) => new RegExp(`(^|[^\\w])${esc(n)}($|[^\\w])`, 'i').test(rule))) continue;
        out.push({ privilegeSet: set.name, entry: `${what} limit on ${where}: ${rule}`, breaks: true,
          why: `The calculation is kept as text and names it, so once it is ${change === 'delete' ? 'gone' : 'renamed'} the limit can't be worked out and allows no records.` });
      }
    }
  }
  return out;
}

/** Data API calls from the fmdapi log that would break: those calling the layout or script, or a layout showing the field or table. */
async function clientsOf(store: Store, logs: ServerLogs | undefined, target: Target, days: number): Promise<{ clients: ImpactClient[]; read: boolean }> {
  if (!logs) return { clients: [], read: false };
  const layouts = new Map<string, string>();
  if (target.kind === 'layout') layouts.set(lower(target.name), `layout ${target.name}`);
  if (target.kind === 'table' || target.kind === 'field') {
    const [table, field] = target.name.split('::');
    for (const l of store.schema.layouts) {
      try {
        const info = store.layout(l.name);
        if (lower(info.table) !== lower(table)) continue;
        if (target.kind === 'field' && !info.fields.some((f) => lower(f.name) === lower(field) || lower(f.name) === lower(target.name))) continue;
        layouts.set(lower(l.name), `layout ${l.name}${target.kind === 'field' ? ', which shows the field' : `, on ${table}`}`);
      } catch {
        // a layout with no table
      }
    }
  }
  let entries;
  try {
    entries = (await logs.read('fmdapi', { from: Date.now() - days * 86_400_000, q: '/databases/', limit: 20_000 })).entries;
  } catch {
    return { clients: [], read: false };
  }
  const db = lower(store.name);
  const seen = new Map<string, ImpactClient>();
  for (const e of entries) {
    const m = /^\S+ (\S+)/.exec(e.message);
    if (!m) continue;
    let path: string;
    try {
      path = decodeURIComponent(m[1].replace(/\+/g, ' '));
    } catch {
      continue;
    }
    const d = /\/databases\/([^/?]+)/.exec(path);
    if (!d || lower(d[1]).replace(/\.fmp12$/, '') !== db) continue;
    const layout = /\/layouts\/([^/?]+)/.exec(path)?.[1];
    let via: string | undefined;
    if (layout && layouts.has(lower(layout))) via = layouts.get(lower(layout));
    if (target.kind === 'script') {
      const scripts = [...path.matchAll(/[?&]script(?:\.prerequest|\.presort)?=([^&]+)/g)].map((x) => x[1]);
      const direct = /\/script\/([^/?]+)/.exec(path)?.[1];
      if (direct) scripts.push(direct);
      if (scripts.some((s) => lower(s) === lower(target.name))) via = `script ${target.name}`;
    }
    if (!via) continue;
    const account = / account (.+)$/.exec(e.message)?.[1] ?? '(no account)';
    const k = `${account}\n${via}`;
    const c = seen.get(k);
    if (c) c.calls++;
    else seen.set(k, { surface: 'Data API', account, calls: 1, last: e.at, via });
  }
  return { clients: [...seen.values()].sort((a, b) => b.calls - a.calls), read: true };
}

/** The file a data source names (its path's file name, else its own name). */
function sourceFile(a: Store, id: number | undefined): string | undefined {
  const d = a.schema.dataSources.find((x) => x.id === id);
  return d ? dataSourceFile(d.paths) ?? d.name : undefined;
}

/**
 * How other hosted files reach into this one's target. A cross-file reference
 * is by id (a table occurrence's base table, a relationship's match field, an
 * external script call, an external value list), so a rename follows it and a
 * delete leaves it pointing at nothing.
 */
export function crossFileImpact(store: Store, others: Store[], target: Target, change: ChangeKind): CrossFileUse[] {
  const s = store.schema;
  const breaks = change === 'delete';
  const out: CrossFileUse[] = [];
  const why = (what: string) =>
    breaks ? `It points into "${store.name}" by id, so deleting the ${what} leaves it with nothing to resolve.`
      : `It points into "${store.name}" by id, so it follows the rename.`;
  // The target's id in this file.
  const table = (name: string) => s.tables.find((t) => t.name === name);
  // Whether a data source in file `a` resolves to this store — identity, as occurrenceTable/resolveFile
  // resolve a table occurrence's base table (not a file-name string compare, which two files could share).
  const pointsHere = (a: Store, dataSourceId: number | undefined): boolean => {
    const name = sourceFile(a, dataSourceId);
    return !!name && a.resolveFile(name) === store;
  };
  for (const a of others) {
    if (a === store) continue;
    switch (target.kind) {
      case 'table': {
        const t = table(target.name);
        if (!t) break;
        // A's table occurrences whose base table is this table.
        for (const occ of a.schema.tableOccurrences) {
          if (!occ.dataSourceId) continue;
          const bt = a.calc.occurrenceTable(occ.id);
          if (bt && bt.store === store && bt.table.id === t.id) out.push({ file: a.name, where: `table occurrence "${occ.name}"`, breaks, why: why('table') });
        }
        break;
      }
      case 'field': {
        const [tn, fn] = target.name.split('::');
        const t = table(tn);
        const f = t?.fields.find((x) => x.name === fn);
        if (!t || !f) break;
        // Every place file `a` names this field resolves — through its occurrence's base table — to the
        // same key insight uses for a cross-file field: "<this file>/<table>::<field>". So one scan of a's
        // sites catches it wherever it is used: a layout field object, a calculation, a script step, an
        // ExecuteSQL query, a merge field, or a relationship match field — not only match fields.
        const wantKey = `${store.name}/${t.name}::${f.name}`.toLowerCase();
        const seen = new Set<string>();
        for (const site of solutionIndex(a).sites) {
          if (seen.has(site.where)) continue;
          if ([...site.refs.fields].some((k) => k.toLowerCase() === wantKey)) {
            seen.add(site.where);
            out.push({ file: a.name, where: site.where, breaks, why: why('field') });
          }
        }
        break;
      }
      case 'script': {
        const sc = s.scripts.find((x) => x.name === target.name);
        if (!sc) break;
        // Cross-file script calls are the Perform Script (and kin) steps that carry an external script ref
        // (`params.script.file`), and a button that names a data source of its own (`action.file`). The reader
        // resolves a data source only for these; a script run from a layout/object trigger, a custom menu item
        // or File Options is resolved by id in the current file and carries no data-source ref, so it is never
        // a cross-file reference here.
        const seen = new Set<string>();
        for (const script of a.schema.scripts) {
          for (const step of script.steps) {
            const ref = step.params?.script?.file ? step.params.script : undefined;
            if (ref?.id === sc.id && pointsHere(a, ref.file!.id) && !seen.has(script.name)) {
              seen.add(script.name);
              out.push({ file: a.name, where: `script "${script.name}" performs it`, breaks, why: why('script') });
            }
          }
        }
        // A button on a layout of file `a` that performs it: the button keeps the script's id and its data source.
        for (const layout of a.designs().layouts) {
          const hit = (objects: LayoutObject[] | undefined): boolean => (objects ?? []).some((o) =>
            (o.action?.file && o.action.scriptId === sc.id && pointsHere(a, o.action.file.id)) || hit(o.children));
          if (hit(layout.objects)) out.push({ file: a.name, where: `a button on layout "${layout.name}" performs it`, breaks, why: why('script') });
        }
        break;
      }
      case 'valueList': {
        const vl = s.valueLists.find((x) => x.name === target.name);
        if (!vl) break;
        for (const other of a.schema.valueLists) {
          if (other.external?.valueListId === vl.id && pointsHere(a, other.external.dataSourceId)) {
            out.push({ file: a.name, where: `value list "${other.name}"`, breaks, why: why('value list') });
          }
        }
        break;
      }
    }
  }
  return out;
}

export async function changeImpact(store: Store, logs: ServerLogs | undefined, kind: ImpactKind, name: string, change: ChangeKind, opts: { days?: number; limit?: number; others?: Store[]; hiddenOthers?: Store[] } = {}): Promise<ChangeImpact> {
  const target = resolveTargets(store, name, kind)[0];
  if (!target) throw new Error(`No ${kind === 'valueList' ? 'value list' : kind} named "${name}"`);
  const days = opts.days ?? 30;
  const used = whereUsed(store, target.name, target.kind, opts.limit ?? 200)[0] ?? { count: 0, usages: [] };
  const uses = used.usages.map((u): ImpactUse => {
    if (change === 'delete') return { where: u.where, text: u.text, breaks: true, why: 'It will refer to something that no longer exists.' };
    const byName = namesInText(u.text, target);
    return { where: u.where, text: u.text, breaks: byName, why: byName ? 'It names it in text, which a rename doesn\'t change.' : 'It refers to it by id and follows the rename.' };
  });
  // Names in text (GetField ( "Table::Field" ), ExecuteSQL queries, "by name" steps) aren't references the index
  // resolves, and they are what a rename breaks: found by reading the text.
  const listed = new Set(uses.map((u) => u.where));
  let extra = 0;
  for (const site of solutionIndex(store).sites) {
    if (listed.has(site.where) || !namesInText(site.text, target)) continue;
    if (target.kind === 'field' && site.where.startsWith(`Field ${target.name} (`)) continue;
    extra++;
    if (uses.length < (opts.limit ?? 200)) {
      uses.push({ where: site.where, text: site.text.length > 300 ? `${site.text.slice(0, 299)}…` : site.text, breaks: true,
        why: change === 'delete' ? 'It names it in text, and it will be gone.' : 'It names it in text, which a rename doesn\'t change.' });
    }
  }
  uses.sort((a, b) => Number(b.breaks) - Number(a.breaks));
  const privileges = privilegeEntries(store, target, change);
  const { clients, read } = await clientsOf(store, logs, target, days);

  const what = target.kind === 'valueList' ? 'value list' : target.kind;
  const summary: string[] = [];
  const broken = uses.filter((u) => u.breaks).length;
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  if (clients.length) {
    const calls = clients.reduce((s, c) => s + c.calls, 0);
    const accounts = [...new Set(clients.map((c) => c.account))];
    summary.push(`${n(calls, 'Data API call')} in the last ${days} days (${accounts.slice(0, 4).join(', ')}${accounts.length > 4 ? ', …' : ''}) ${clients.length === 1 ? 'uses' : 'use'} it by name and would fail after the ${change}.`);
  }
  const privBroken = privileges.filter((p) => p.breaks);
  if (privBroken.length) {
    const sets = [...new Set(privBroken.map((p) => p.privilegeSet))];
    summary.push(`${n(sets.length, 'privilege set')} (${sets.join(', ')}) ${sets.length === 1 ? 'has' : 'have'} an entry for it that ${change === 'rename' ? 'stops applying after the rename, so the set gets its default access instead' : 'would point at nothing'}.`);
  }
  if (broken) summary.push(`${n(broken, 'place')} in the file would break${change === 'rename' ? ' (they name it in text: GetField, ExecuteSQL, Evaluate or a step "by name")' : ''}.`);
  const follow = used.count + extra - broken;
  if (change === 'rename' && follow > 0) summary.push(`${n(follow, 'other use')} in the file follow${follow === 1 ? 's' : ''} the rename.`);
  // Other hosted files that reach into this target.
  const crossFile = crossFileImpact(store, opts.others ?? [], target, change);
  // Files whose names are kept from AI (for an AI client): counted, not named.
  const crossFileHidden = opts.hiddenOthers?.length ? new Set(crossFileImpact(store, opts.hiddenOthers, target, change).map((c) => c.file)).size : 0;
  if (crossFile.length) {
    const files = [...new Set(crossFile.map((c) => c.file))];
    summary.push(`${n(files.length, 'other hosted file')} (${files.join(', ')}) ${change === 'delete' ? `reach${files.length === 1 ? 'es' : ''} into it and would break` : `reach${files.length === 1 ? 'es' : ''} into it by id and follow${files.length === 1 ? 's' : ''} the rename`}.`);
  }
  if (crossFileHidden) summary.push(`${n(crossFileHidden, 'other file')} with AI turned off also ${crossFileHidden === 1 ? 'reaches' : 'reach'} into it; an administrator can see which in the console.`);
  if (!summary.length) summary.push(`Nothing uses this ${what}${read ? ', in the file or from the Data API log' : ' in the file'}.`);
  if (!read) summary.push('The Data API log was not available, so outside clients were not checked.');
  else summary.push('OData and ODBC clients are not logged, so they were not checked.');
  return { target, change, uses, useCount: used.count + extra, privileges, clients, crossFile, ...(crossFileHidden ? { crossFileHidden } : {}), logDays: days, logRead: read, summary };
}
