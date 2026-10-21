// Compares two hosted solutions, usually two versions of one file (a staged
// copy against production, last month's backup against today's): what was
// added, removed, renamed or changed in tables, fields, relationships,
// layouts, scripts, value lists, custom functions and security, and how the
// record counts moved.
//
// FileMaker keeps an item's id when it is renamed, so in two versions of one
// file items are matched by id and renames show up as renames. Unrelated files
// are matched by name.

import { scriptText, stepLine, type Field, type Schema } from '../../fmp12/src/index.ts';
import { q } from '../../store/src/import.ts';
import type { Store } from '../../store/src/index.ts';

export interface Change {
  name: string;
  /** Previous name, for a rename. */
  was?: string;
  /** What changed, in words. */
  details?: string[];
  /** Script changes as a line diff ("- old", "+ new"). */
  diff?: string[];
}

export interface Section {
  added: string[];
  removed: string[];
  renamed: Change[];
  changed: Change[];
}

export interface Comparison {
  from: string;
  to: string;
  /** Whether items were matched by id (two versions of one file) or by name. */
  matchedBy: 'id' | 'name';
  summary: string;
  tables: Section;
  fields: Section;
  tableOccurrences: Section;
  relationships: Section;
  layouts: Section;
  scripts: Section;
  valueLists: Section;
  customFunctions: Section;
  /** Left out without `security`. */
  accounts?: Section;
  privilegeSets?: Section;
  /** Other file-level design and behavior settings. */
  settings: Section;
  records: { table: string; from: number; to: number }[];
}

interface Item {
  id: number;
  name: string;
}

const lower = (s: string) => s.toLowerCase();

/** Matches items of two lists, by id when the files share a lineage, else by name. */
function pair<T extends Item>(a: T[], b: T[], byId: boolean): { both: [T, T][]; added: T[]; removed: T[] } {
  const key = (x: T) => (byId ? String(x.id) : lower(x.name));
  const bByKey = new Map(b.map((x) => [key(x), x]));
  const both: [T, T][] = [];
  const removed: T[] = [];
  const used = new Set<T>();
  for (const x of a) {
    let y = bByKey.get(key(x));
    // An id reused for something else entirely: fall back to the name.
    if (y && byId && lower(y.name) !== lower(x.name) && b.some((z) => lower(z.name) === lower(x.name) && z !== y)) y = undefined;
    if (!y && byId) y = b.find((z) => !used.has(z) && lower(z.name) === lower(x.name));
    if (y && !used.has(y)) {
      both.push([x, y]);
      used.add(y);
    } else removed.push(x);
  }
  return { both, removed, added: b.filter((y) => !used.has(y)) };
}

function section<T extends Item>(a: T[], b: T[], byId: boolean, diff: (x: T, y: T) => Omit<Change, 'name' | 'was'> | undefined, prefix = ''): Section {
  const p = pair(a, b, byId);
  const out: Section = { added: p.added.map((x) => prefix + x.name), removed: p.removed.map((x) => prefix + x.name), renamed: [], changed: [] };
  for (const [x, y] of p.both) {
    const d = diff(x, y);
    if (x.name !== y.name) out.renamed.push({ name: prefix + y.name, was: prefix + x.name, ...(d ?? {}) });
    else if (d) out.changed.push({ name: prefix + y.name, ...d });
  }
  return out;
}

const merge = (sections: Section[]): Section => ({
  added: sections.flatMap((s) => s.added),
  removed: sections.flatMap((s) => s.removed),
  renamed: sections.flatMap((s) => s.renamed),
  changed: sections.flatMap((s) => s.changed),
});

const exact = (s: string | undefined) => s ?? '';

function fieldShape(f: Field): Record<string, string> {
  const o = f.options;
  const shape: Record<string, string> = { type: f.type, kind: f.kind, 'has calculation': String(f.hasCalculation), 'calculation context': String(f.calculationContextId) };
  if (f.calculation !== undefined) shape[f.kind === 'calculation' ? 'formula' : 'auto-enter calculation'] = exact(f.calculation);
  if (f.comment) shape.comment = f.comment;
  if (o?.global) shape.storage = 'global';
  if (o?.unstored) shape.storage = 'unstored';
  if (o && o.repetitions > 1) shape.repetitions = String(o.repetitions);
  if (o?.autoEnter?.serial) shape['serial increment'] = String(o.autoEnter.serial.increment);
  if (o?.autoEnter?.value) shape['auto-enter'] = o.autoEnter.value;
  if (o?.autoEnter?.data) shape['auto-enter data'] = o.autoEnter.data;
  const v = o?.validation;
  if (v) {
    const rules = [v.notEmpty && 'not empty', v.unique && 'unique', v.range && `range ${v.range.min}..${v.range.max}`,
      v.maxLength && `max length ${v.maxLength}`, v.calculation && `calculation ${exact(v.calculation)}`].filter(Boolean);
    if (rules.length) shape.validation = rules.join(', ');
  }
  if (f.summary) shape.summary = JSON.stringify(f.summary);
  if (o) shape['field options'] = JSON.stringify(o);
  return shape;
}

function shapeDiff(a: Record<string, string>, b: Record<string, string>): string[] | undefined {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    if (a[k] === undefined) out.push(`${k} added: ${clip(b[k])}`);
    else if (b[k] === undefined) out.push(`${k} removed (was ${clip(a[k])})`);
    else out.push(`${k}: ${around(a[k], b[k])}`);
  }
  return out.length ? out : undefined;
}

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** "old → new", cut to the part around the first difference for long texts (formulas). */
function around(a: string, b: string): string {
  if (a.length <= 120 && b.length <= 120) return `${a} → ${b}`;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const start = Math.max(0, i - 40);
  const cut = (s: string) => (start > 0 ? '…' : '') + clip(s.slice(start, Math.max(s.length - j + 40, i + 40)), 200) + (s.length - j + 40 < s.length ? '…' : '');
  return `${cut(a)} → ${cut(b)}`;
}

/** Line diff (longest common subsequence), keeping only changed lines with a little context. */
export function lineDiff(a: string[], b: string[], maxLines = 60): string[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return [`(too long to compare line by line: ${n} → ${m} lines)`];
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) out.push(`+ ${b[j++].trim()}`);
    else out.push(`- ${a[i++].trim()}`);
  }
  return out.length > maxLines ? [...out.slice(0, maxLines), `… ${out.length - maxLines} more changed lines`] : out;
}

function layoutShape(store: Store, id: number): { occurrence?: string; fields: Set<string>; objects: number; scripts: Set<string> } {
  const d = store.design(id);
  const fields = new Set<string>();
  const scripts = new Set<string>();
  let objects = 0;
  const walk = (objs: NonNullable<typeof d>['objects']) => {
    for (const o of objs) {
      objects++;
      if (o.field?.tableOccurrence) fields.add(`${o.field.tableOccurrence}::${o.field.field}`);
      if (o.action?.script) scripts.add(o.action.script);
      if (o.children) walk(o.children);
    }
  };
  if (d) walk(d.objects);
  const toId = store.schema.layouts.find((l) => l.id === id)?.tableOccurrenceId;
  return { occurrence: store.schema.tableOccurrences.find((t) => t.id === toId)?.name, fields, scripts, objects };
}

function setDiff(label: string, a: Set<string>, b: Set<string>): string[] {
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  const out: string[] = [];
  if (added.length) out.push(`${label} added: ${list(added)}`);
  if (removed.length) out.push(`${label} removed: ${list(removed)}`);
  return out;
}

const list = (xs: string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(', ')}, … (${xs.length - max} more)` : xs.join(', '));

function relText(s: Schema, r: Schema['relationships'][number], fieldName: (toId: number, id: number) => string | undefined): string {
  const name = (id: number) => s.tableOccurrences.find((t) => t.id === id)?.name ?? `#${id}`;
  return r.predicates.map((p) =>
    `${name(r.leftTableOccurrenceId)}::${p.leftField ?? fieldName(r.leftTableOccurrenceId, p.leftFieldId) ?? p.leftFieldId} ${p.operator} ` +
    `${name(r.rightTableOccurrenceId)}::${p.rightField ?? fieldName(r.rightTableOccurrenceId, p.rightFieldId) ?? p.rightFieldId}`).join(' AND ');
}

const count = (store: Store, table: string) => {
  try {
    return Number(store.query(`SELECT count(*) AS n FROM ${q(table)}`)[0]?.n ?? 0);
  } catch {
    return 0;
  }
};

/** `security: false` leaves out accounts and privilege sets (for accounts without [Full Access]). */
export function compareSolutions(a: Store, b: Store, opts: { scriptDiffLines?: number; security?: boolean } = {}): Comparison {
  const sa = a.schema;
  const sb = b.schema;
  // Two versions of one file keep their ids: most tables have the same name under the same id.
  const sameId = sa.tables.filter((t) => sb.tables.some((u) => u.id === t.id && lower(u.name) === lower(t.name))).length;
  const byId = sa.tables.length > 0 && sameId / Math.min(sa.tables.length, sb.tables.length || 1) >= 0.5;

  const tables = section(sa.tables, sb.tables, byId, () => undefined);
  const fieldSections: Section[] = [];
  for (const [ta, tb] of pair(sa.tables, sb.tables, byId).both) {
    fieldSections.push(section(ta.fields, tb.fields, byId, (x, y) => {
      const details = shapeDiff(fieldShape(x), fieldShape(y));
      return details && { details };
    }, `${tb.name}::`));
  }
  const fields = merge(fieldSections);

  const tableOccurrences = section(sa.tableOccurrences, sb.tableOccurrences, byId, (x, y) => {
    const ta = a.calc.occurrenceTable(x.id)?.table.name;
    const tb = b.calc.occurrenceTable(y.id)?.table.name;
    const details = [
      ...(ta !== tb ? [`base table: ${ta ?? '?'} → ${tb ?? '?'}`] : []),
      ...(x.dataSourceId !== y.dataSourceId ? ['data source changed'] : []),
      ...(JSON.stringify(x.graph) !== JSON.stringify(y.graph) || x.color !== y.color ? ['graph appearance changed'] : []),
    ];
    return details.length ? { details } : undefined;
  });

  const fieldNameIn = (store: Store) => (toId: number, id: number) => store.calc.occurrenceTable(toId)?.table.fields.find((f) => f.id === id)?.name;
  const relItems = (s: Schema, store: Store) => s.relationships.map((r) => ({
    id: r.id, name: relText(s, r, fieldNameIn(store)),
    leftCreate: !!r.leftCreate, rightCreate: !!r.rightCreate, leftDelete: !!r.leftDelete, rightDelete: !!r.rightDelete, sorted: !!r.sorted,
  }));
  // Relationships have no names: matched by id within one file's versions, else by their join text.
  const relationships = section(relItems(sa, a), relItems(sb, b), byId, (x, y) => {
    const details = shapeDiff(
      { 'left create': String(x.leftCreate), 'right create': String(x.rightCreate), 'left delete': String(x.leftDelete), 'right delete': String(x.rightDelete), sort: String(x.sorted) },
      { 'left create': String(y.leftCreate), 'right create': String(y.rightCreate), 'left delete': String(y.leftDelete), 'right delete': String(y.rightDelete), sort: String(y.sorted) },
    );
    return details && { details };
  });
  if (byId) {
    // A changed join keeps its id: report it as a change, not a rename.
    for (const r of relationships.renamed) relationships.changed.push({ name: r.name, details: [`was ${r.was}`] });
    relationships.renamed = [];
  }

  const layouts = section(sa.layouts, sb.layouts, byId, (x, y) => {
    const la = layoutShape(a, x.id);
    const lb = layoutShape(b, y.id);
    const details = [
      ...(la.occurrence !== lb.occurrence ? [`shows records from ${la.occurrence ?? '?'} → ${lb.occurrence ?? '?'}`] : []),
      ...setDiff('fields', la.fields, lb.fields),
      ...setDiff('script buttons', la.scripts, lb.scripts),
      ...(la.objects !== lb.objects && !la.fields.size && !lb.fields.size ? [`objects: ${la.objects} → ${lb.objects}`] : []),
    ];
    if ((JSON.stringify(a.design(x.id)) !== JSON.stringify(b.design(y.id)) || JSON.stringify(x.labels) !== JSON.stringify(y.labels)) && !details.length) details.push('layout behavior or formatting changed');
    return details.length ? { details } : undefined;
  });

  const lines = (steps: Schema['scripts'][number]['steps']) => steps.map((s) => (s.enabled ? '' : '// ') + (s.line ?? stepLine(s.name, s.params, s.text)));
  const scripts = section(sa.scripts, sb.scripts, byId, (x, y) => {
    const bodyChanged = scriptText(x.steps) !== scriptText(y.steps);
    const stepSettingsChanged = !bodyChanged && JSON.stringify(x.steps) !== JSON.stringify(y.steps);
    const details = [
      ...(bodyChanged ? [`${x.steps.length} → ${y.steps.length} steps`] : []),
      ...(stepSettingsChanged ? ['script step settings changed'] : []),
      ...(!!x.fullAccess !== !!y.fullAccess ? ['run with full access changed'] : []),
      ...(JSON.stringify(x.limits) !== JSON.stringify(y.limits) ? ['execution limits changed'] : []),
    ];
    return details.length ? { details, ...(bodyChanged ? { diff: lineDiff(lines(x.steps), lines(y.steps), opts.scriptDiffLines ?? 40) } : {}) } : undefined;
  });

  const valueLists = section(sa.valueLists, sb.valueLists, byId, (x, y) => {
    const d = setDiff('values', new Set(x.values ?? []), new Set(y.values ?? []));
    if (JSON.stringify(x.values) !== JSON.stringify(y.values) && !d.length) d.push('value order changed');
    if (JSON.stringify(x.field) !== JSON.stringify(y.field)) d.push('field source or display settings changed');
    if (JSON.stringify(x.external) !== JSON.stringify(y.external)) d.push('external source changed');
    return d.length ? { details: d } : undefined;
  });
  const customFunctions = section(sa.customFunctions, sb.customFunctions, byId, (x, y) => {
    const details = shapeDiff(
      { parameters: x.parameters.join(' ; '), formula: exact(x.formula), language: x.language ?? 'calculation' },
      { parameters: y.parameters.join(' ; '), formula: exact(y.formula), language: y.language ?? 'calculation' },
    );
    return details && { details };
  });
  const accountItems = (store: Store) => store.accounts().map((account, i) => ({
    ...account,
    id: store.schema.accounts.find((x) => lower(x.name) === lower(account.name))?.id ?? -i - 1,
    passwordVerifier: store.schema.accounts.find((x) => lower(x.name) === lower(account.name))?.passwordVerifier,
  }));
  const aAccounts = accountItems(a);
  const bAccounts = accountItems(b);
  const accounts = section(aAccounts, bAccounts, byId && [...aAccounts, ...bAccounts].every((x) => x.id > 0), (x, y) => {
    const details = shapeDiff(
      Object.fromEntries(Object.entries(x).filter(([key]) => !['id', 'name'].includes(key)).map(([key, value]) => [key, String(value)])),
      Object.fromEntries(Object.entries(y).filter(([key]) => !['id', 'name'].includes(key)).map(([key, value]) => [key, String(value)])),
    );
    return details && { details: details.map((detail) => detail.startsWith('passwordVerifier') ? 'password verifier changed' : detail) };
  });
  const privilegeItems = (store: Store) => store.privilegeSets().map((set, i) => ({ ...set, id: set.id ?? -i - 1 }));
  const aPrivilegeSets = privilegeItems(a);
  const bPrivilegeSets = privilegeItems(b);
  const privilegeSets = section(aPrivilegeSets, bPrivilegeSets, byId && [...aPrivilegeSets, ...bPrivilegeSets].every((x) => x.id > 0), (x, y) => {
    const withoutIdentity = (set: typeof x) => Object.fromEntries(Object.entries(set).filter(([key]) => key !== 'id' && key !== 'name'));
    return JSON.stringify(withoutIdentity(x)) !== JSON.stringify(withoutIdentity(y)) ? { details: ['permissions or set options changed'] } : undefined;
  });
  const settings: Section = { added: [], removed: [], renamed: [], changed: [] };
  for (const key of ['layoutOrder', 'scriptOrder', 'dataSources', 'containerDirectories', 'themes', 'fonts', 'customMenus', 'customMenuSets', 'defaultMenuSetId', 'fileOptions', 'pageSetup', 'retiredIds'] as const) {
    if (JSON.stringify(sa[key]) !== JSON.stringify(sb[key])) settings.changed.push({ name: key, details: ['settings changed'] });
  }
  if (opts.security !== false && JSON.stringify(sa.extendedPrivileges) !== JSON.stringify(sb.extendedPrivileges)) {
    settings.changed.push({ name: 'extendedPrivileges', details: ['settings changed'] });
  }

  const records: Comparison['records'] = [];
  for (const [ta, tb] of pair(sa.tables, sb.tables, byId).both) {
    const from = count(a, ta.name);
    const to = count(b, tb.name);
    if (from !== to) records.push({ table: tb.name, from, to });
  }

  const sections = {
    tables, fields, tableOccurrences, relationships, layouts, scripts, valueLists, customFunctions, settings,
    ...(opts.security === false ? {} : { accounts, privilegeSets }),
  };
  const parts: string[] = [];
  for (const [k, s] of Object.entries(sections)) {
    const bits = [s.added.length && `${s.added.length} added`, s.removed.length && `${s.removed.length} removed`,
      s.renamed.length && `${s.renamed.length} renamed`, s.changed.length && `${s.changed.length} changed`].filter(Boolean);
    if (bits.length) parts.push(`${k}: ${bits.join(', ')}`);
  }
  if (records.length) parts.push(`record counts changed in ${records.length} tables`);
  const summary = parts.length ? parts.join('; ') + '.' : 'No differences in design or record counts.';
  return { from: a.name, to: b.name, matchedBy: byId ? 'id' : 'name', summary, ...sections, records };
}

/** The comparison without empty lists, for reading. */
export function compactComparison(c: Comparison): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (Array.isArray(v)) {
      if (v.length) out[k] = v;
    } else if (v && typeof v === 'object') {
      const s = Object.fromEntries(Object.entries(v).filter(([, x]) => (x as unknown[]).length));
      if (Object.keys(s).length) out[k] = s;
    } else out[k] = v;
  }
  return out;
}
