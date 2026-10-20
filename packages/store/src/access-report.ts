// A structured, ground-truth account of what a privilege set may do, and a
// no-op diff of a proposed set against an existing one. Built for the
// "ask about access" AI/MCP tools: the model answers plain-English questions
// and proposes new sets, but every answer is grounded in these facts (the
// exact rule, verbatim) and every proposal is shown as a diff for a human to
// approve — nothing here changes the file.

import type { Schema } from '../../fmp12/src/index.ts';
import { ownPrivilegeEntry } from './privileges.ts';
import type { FieldLevel, FieldMask, Level, PrivilegeDefinition, Privileges, Rule, TablePrivileges } from './privileges.ts';

/** A view/edit/delete rule, said plainly: yes, no, or a per-record calculation (quoted verbatim). */
export interface RuleFact {
  allowed: boolean | 'limited';
  /** The calculation evaluated per record, when `allowed` is "limited". */
  rule?: string;
}

export interface TableAccess {
  table: string;
  /** true when this table has no entry of its own and falls under the set's default. */
  default?: boolean;
  view: RuleFact;
  edit: RuleFact;
  create: boolean;
  delete: RuleFact;
  /** Fields the set can't modify or can't see, when some are restricted. */
  fields?: { field: string; access: Exclude<FieldLevel, 'modifiable'>; /** What a masked field shows. */ mask?: FieldMask }[];
}

export interface AccessReport {
  privilegeSet: string;
  fullAccess: boolean;
  extendedPrivileges: string[];
  menuCommands: 'all' | 'editing' | 'minimum';
  /** The default record rule for any table without its own entry. */
  defaultRecords: TableAccess;
  /** One entry per base table: its own rule, or the default marked `default: true`. */
  tables: TableAccess[];
  layouts: { default: Level; exceptions: { layout: string; access: Level; records: Level }[] };
  scripts: { default: Level; exceptions: { script: string; access: Level }[] };
  valueLists: { default: Level; exceptions: { valueList: string; access: Level }[] };
}

const fact = (r: Rule): RuleFact =>
  r === true ? { allowed: true } : r === false ? { allowed: false } : { allowed: 'limited', rule: r };

function tableAccess(p: Privileges, table: string, fields: string[], isDefault: boolean): TableAccess {
  const t: TablePrivileges = p.table(table);
  const restricted = fields
    .map((field) => ({ field, access: p.fieldAccess(table, field), mask: p.mask(table, field) }))
    .filter((f): f is { field: string; access: Exclude<FieldLevel, 'modifiable'>; mask: FieldMask | undefined } => f.access !== 'modifiable')
    .map(({ mask, ...f }) => (mask ? { ...f, mask } : f));
  return {
    table, ...(isDefault ? { default: true } : {}),
    view: fact(t.view), edit: fact(t.edit), create: t.create, delete: fact(t.delete),
    ...(restricted.length ? { fields: restricted } : {}),
  };
}

/** Everything a privilege set may do in a file, as facts the model can cite. */
export function accessReport(p: Privileges, schema: Schema): AccessReport {
  const def = p.set;
  const defaultRule: TablePrivileges = p.full ? { view: true, edit: true, create: true, delete: true } : def.records;
  const extendedPrivileges = [...def.extendedPrivileges];
  if (p.has('fmmcp') && !extendedPrivileges.some((e) => e.toLowerCase() === 'fmmcp')) extendedPrivileges.push('fmmcp');
  return {
    privilegeSet: p.name,
    fullAccess: p.full,
    extendedPrivileges,
    menuCommands: p.menuCommands,
    defaultRecords: {
      table: '(every other table)',
      view: fact(defaultRule.view), edit: fact(defaultRule.edit), create: defaultRule.create, delete: fact(defaultRule.delete),
    },
    tables: schema.tables.map((t) =>
      tableAccess(p, t.name, t.fields.map((f) => f.name), !p.full && !ownPrivilegeEntry(def.tables, t.name))),
    layouts: {
      default: p.full ? 'modifiable' : def.layouts,
      exceptions: p.full ? [] : schema.layouts
        .map((l) => ({ layout: l.name, access: p.layout(l.name) }))
        .filter((l) => l.access.layout !== (def.layouts === 'none' ? 'none' : def.layouts) || l.access.records !== (def.layouts === 'none' ? 'none' : 'modifiable'))
        .map((l) => ({ layout: l.layout, access: l.access.layout, records: l.access.records })),
    },
    scripts: {
      default: p.full ? 'modifiable' : def.scripts,
      exceptions: p.full ? [] : schema.scripts
        .map((s) => ({ script: s.name, access: p.script(s.name) }))
        .filter((s) => s.access !== def.scripts),
    },
    valueLists: {
      default: p.full ? 'modifiable' : def.valueLists,
      exceptions: p.full ? [] : schema.valueLists
        .map((v) => ({ valueList: v.name, access: p.valueList(v.name) }))
        .filter((v) => v.access !== def.valueLists),
    },
  };
}

// ─── "View as": the same facts, said in plain English, with a reason for every
// denial — so a person (or the admin console) can see exactly what an account
// or a privilege set can open and change, and why it can't do the rest.

/** What each outside surface (an extended privilege) is, in plain words. */
const SURFACE_LABELS: Record<string, string> = {
  fmrest: 'the Data API', fmodata: 'OData', fmxdbc: 'ODBC/JDBC and SQL', fmxml: 'XML publishing',
  fmphp: 'PHP publishing', fmwebdirect: 'WebDirect', fmapp: 'FileMaker-style app sign-in', fmmcp: 'AI tools (MCP)',
};

/** One allowed/denied verdict with a plain reason (and the record rule, when the answer is "it depends"). */
export interface AccessFact {
  allowed: boolean | 'limited';
  why: string;
  /** The per-record calculation, when `allowed` is "limited". */
  rule?: string;
}

export interface FieldFact {
  field: string;
  access: Exclude<FieldLevel, 'modifiable'>;
  why: string;
}

export interface TableExplanation {
  table: string;
  default?: boolean;
  view: AccessFact;
  edit: AccessFact;
  create: AccessFact;
  delete: AccessFact;
  /** Fields it can see but not change, or can't see at all. */
  fields: FieldFact[];
}

export interface SurfaceFact {
  surface: string;
  label: string;
  allowed: boolean;
  why: string;
}

export interface AccessExplanation {
  /** Who this is about, said plainly (e.g. `account "bob" (privilege set "Sales")`). */
  target: string;
  privilegeSet: string;
  fullAccess: boolean;
  /** A one-line summary of the whole picture. */
  summary: string;
  /** The ways in from outside the web client, each allowed or not. */
  surfaces: SurfaceFact[];
  defaultRecords: TableExplanation;
  tables: TableExplanation[];
  layouts: { default: Level; exceptions: { layout: string; canOpen: boolean; canEditRecords: boolean; why: string }[] };
  scripts: { default: Level; exceptions: { script: string; access: Level; why: string }[] };
}

/** Turn one record rule into an allowed/denied fact with a plain reason. */
function recordFact(verb: string, table: string, f: RuleFact): AccessFact {
  if (f.allowed === true) return { allowed: true, why: `can ${verb} every record in ${table}` };
  if (f.allowed === false) return { allowed: false, why: `can't ${verb} any record in ${table}` };
  return { allowed: 'limited', rule: f.rule, why: `can ${verb} only records where this rule is true: ${f.rule}` };
}

/** "create" has no per-record rule — it's a plain yes/no. */
function createFact(table: string, allowed: boolean): AccessFact {
  return { allowed, why: allowed ? `can create records in ${table}` : `can't create records in ${table}` };
}

/** A mask said plainly. */
export function maskWords(mask: FieldMask | undefined): string {
  return mask?.kind === 'placeholder' ? `shows ${mask.text ? `"${mask.text}"` : 'a row of dots'} instead of the value` : 'shows only the last 4 characters';
}

function fieldWhy(table: string, access: Exclude<FieldLevel, 'modifiable'>, tableViewable: boolean, mask?: FieldMask): string {
  if (access === 'viewOnly') return 'can see this field but not change it';
  if (access === 'masked') {
    return `sees only a masked version of this field (${maskWords(mask)}); can't change, search, sort, total or export it`;
  }
  // "none" happens two ways: the whole table is hidden, or the table is
  // viewable but this one field is set to no access. Say which.
  return tableViewable
    ? "can't see this field (it's hidden for this set, though the table is viewable)"
    : `can't see this field (the set can't view records in ${table})`;
}

/**
 * Everything an account or privilege set can do in a file, said in plain
 * English with a reason for every denial. Pure: built entirely from an
 * AccessReport, it reads nothing and changes nothing.
 */
export function explainAccess(report: AccessReport, opts: { account?: string; privilegeSet?: string } = {}): AccessExplanation {
  // `report.privilegeSet` is the internal Privileges name (e.g. an account name,
  // or "[view as …]"); the caller passes the clean set name to display.
  const setName = opts.privilegeSet ?? report.privilegeSet;
  const table = (t: TableAccess): TableExplanation => ({
    table: t.table,
    ...(t.default ? { default: true } : {}),
    view: recordFact('see', t.table, t.view),
    edit: recordFact('edit', t.table, t.edit),
    create: createFact(t.table, t.create),
    delete: recordFact('delete', t.table, t.delete),
    fields: (t.fields ?? []).map((f) => ({ field: f.field, access: f.access, why: fieldWhy(t.table, f.access, t.view.allowed !== false, f.mask) })),
  });

  const surfaces: SurfaceFact[] = Object.entries(SURFACE_LABELS).map(([surface, label]) => {
    // Match case-insensitively, as Privileges.has() does: an imported file can
    // carry a non-canonical keyword (e.g. "Fmrest") that is still enforced.
    const allowed = report.extendedPrivileges.some((e) => e.toLowerCase() === surface);
    return { surface, label, allowed, why: allowed ? `can sign in through ${label}` : `can't use ${label} (needs the ${surface} extended privilege)` };
  });

  const layoutExceptions = report.layouts.exceptions.map((l) => {
    const canOpen = l.access !== 'none';
    const canEditRecords = canOpen && l.records === 'modifiable';
    const why = !canOpen
      ? "can't open this layout"
      : canEditRecords ? 'can open this layout and edit its records' : 'can open this layout but only view its records';
    return { layout: l.layout, canOpen, canEditRecords, why };
  });

  const scriptExceptions = report.scripts.exceptions.map((s) => ({
    script: s.script, access: s.access,
    why: s.access === 'none' ? "can't run this script" : s.access === 'viewOnly' ? 'can run this script' : 'can run and edit this script',
  }));

  const target = opts.account
    ? `account "${opts.account}"${setName ? ` (privilege set "${setName}")` : ' (no privilege set, so no access)'}`
    : `privilege set "${setName}"`;
  const openableTables = report.tables.filter((t) => t.view.allowed !== false).length;
  const summary = report.fullAccess
    ? `${target} has full access to data and design in this file, and can sign in through ${surfaces.filter((s) => s.allowed).map((s) => s.label).join(', ') || 'no outside surface'}.`
    : `${target} can see records in ${openableTables} of ${report.tables.length} tables, and sign in through ${surfaces.filter((s) => s.allowed).map((s) => s.label).join(', ') || 'no outside surface'}.`;

  return {
    target,
    privilegeSet: setName,
    fullAccess: report.fullAccess,
    summary,
    surfaces,
    defaultRecords: table(report.defaultRecords),
    tables: report.tables.map(table),
    layouts: { default: report.layouts.default, exceptions: layoutExceptions },
    scripts: { default: report.scripts.default, exceptions: scriptExceptions },
  };
}

/** One human-readable line of how a proposed set differs from the base. */
export interface SetChange {
  area: 'aiVisible' | 'records' | 'table' | 'layouts' | 'scripts' | 'valueLists' | 'extendedPrivileges' | 'menuCommands' | 'options' | 'name' | 'comment';
  detail: string;
}

const ruleWord = (r: Rule): string => (r === true ? 'yes' : r === false ? 'no' : `limited (${r})`);
const tableWord = (t: TablePrivileges): string =>
  `view ${ruleWord(t.view)}, edit ${ruleWord(t.edit)}, create ${t.create ? 'yes' : 'no'}, delete ${ruleWord(t.delete)}`;

/**
 * A plain-English diff of a proposed privilege set against an existing one (or
 * against no access, when there is no base). Pure: it changes nothing, so the
 * caller can show it for approval before applying it with applySecurity.
 */
export function diffPrivilegeSet(proposed: PrivilegeDefinition, base?: PrivilegeDefinition): SetChange[] {
  const empty: PrivilegeDefinition = { name: proposed.name, records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] };
  const from = base ?? empty;
  const out: SetChange[] = [];
  if (base && base.name !== proposed.name) out.push({ area: 'name', detail: `rename "${base.name}" to "${proposed.name}"` });
  if ((from.comment ?? '') !== (proposed.comment ?? '')) out.push({ area: 'comment', detail: `comment: "${proposed.comment ?? ''}"` });
  if (tableWord(from.records) !== tableWord(proposed.records)) out.push({ area: 'records', detail: `default record access → ${tableWord(proposed.records)}` });
  // Field access for tables with no rule of their own, including their fallback.
  const dfa = from.records.fields ?? {}, dfb = proposed.records.fields ?? {};
  for (const f of [...new Set([...Object.keys(dfa), ...Object.keys(dfb)])].sort()) {
    const la = ownPrivilegeEntry(dfa, f) ?? (from.records.fieldsDefault === 'none' ? 'none' : 'modifiable');
    const lb = ownPrivilegeEntry(dfb, f) ?? (proposed.records.fieldsDefault === 'none' ? 'none' : 'modifiable');
    const ma = la === 'masked' ? maskWords(ownPrivilegeEntry(from.records.masks, f)) : '', mb = lb === 'masked' ? maskWords(ownPrivilegeEntry(proposed.records.masks, f)) : '';
    if (la !== lb || ma !== mb) out.push({ area: 'records', detail: `default field "${f}" → ${lb}${mb ? ` (${mb})` : ''}` });
  }
  if ((from.records.fieldsDefault === 'none') !== (proposed.records.fieldsDefault === 'none')) out.push({ area: 'records', detail: `default fields not listed → ${proposed.records.fieldsDefault === 'none' ? 'no access' : 'modifiable'}` });
  const tables = new Set([...Object.keys(from.tables ?? {}), ...Object.keys(proposed.tables ?? {})]);
  for (const t of [...tables].sort()) {
    const a = ownPrivilegeEntry(from.tables, t), b = ownPrivilegeEntry(proposed.tables, t);
    if (!b) { out.push({ area: 'table', detail: `${t}: remove custom access (falls back to the default)` }); continue; }
    if (!a || tableWord(a) !== tableWord(b)) out.push({ area: 'table', detail: `${t} → ${tableWord(b)}` });
    // Field-level overrides within the table (a field not listed is modifiable).
    const fa = a?.fields ?? {}, fb = b.fields ?? {};
    for (const f of [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()) {
      const la = ownPrivilegeEntry(fa, f) ?? (a?.fieldsDefault === 'none' ? 'none' : 'modifiable'), lb = ownPrivilegeEntry(fb, f) ?? (b.fieldsDefault === 'none' ? 'none' : 'modifiable');
      // A mask that changes (last 4 to a placeholder, or another text) is a change even when the level is not.
      const ma = la === 'masked' ? maskWords(ownPrivilegeEntry(a?.masks, f)) : '', mb = lb === 'masked' ? maskWords(ownPrivilegeEntry(b.masks, f)) : '';
      if (la !== lb || ma !== mb) out.push({ area: 'table', detail: `${t}.${f} field → ${lb}${mb ? ` (${mb})` : ''}` });
    }
    if ((a?.fieldsDefault === 'none') !== (b.fieldsDefault === 'none')) out.push({ area: 'table', detail: `${t}: fields not listed → ${b.fieldsDefault === 'none' ? 'no access' : 'modifiable'}` });
  }
  for (const [area, a, b] of [['layouts', from.layouts, proposed.layouts], ['scripts', from.scripts, proposed.scripts], ['valueLists', from.valueLists, proposed.valueLists]] as const) {
    if (a !== b) out.push({ area, detail: `default ${area} access → ${b}` });
  }
  // Per-object exceptions, compared by EFFECTIVE level: an object with no entry
  // of its own follows the set's default level (as Privileges.script/valueList
  // resolve it), so an override pinned to the default is not a difference.
  for (const [area, kind, aMap, aDef, bMap, bDef] of [
    ['scripts', 'script', from.scriptAccess, from.scripts, proposed.scriptAccess, proposed.scripts],
    ['valueLists', 'value list', from.valueListAccess, from.valueLists, proposed.valueListAccess, proposed.valueLists],
  ] as const) {
    for (const name of [...new Set([...Object.keys(aMap ?? {}), ...Object.keys(bMap ?? {})])].sort()) {
      const la = ownPrivilegeEntry(aMap, name) ?? aDef, lb = ownPrivilegeEntry(bMap, name) ?? bDef;
      if (la !== lb) out.push({ area, detail: `${kind} "${name}" → ${lb}` });
    }
  }
  // A layout with no entry follows the default: viewable/editable per `layouts`, or no access when 'none' (as Privileges.layout resolves it).
  const layoutEff = (map: PrivilegeDefinition['layoutAccess'], def: Level, name: string) =>
    ownPrivilegeEntry(map, name) ?? { layout: def === 'none' ? 'none' : def, records: def === 'none' ? 'none' : 'modifiable' };
  for (const name of [...new Set([...Object.keys(from.layoutAccess ?? {}), ...Object.keys(proposed.layoutAccess ?? {})])].sort()) {
    const a = layoutEff(from.layoutAccess, from.layouts, name), b = layoutEff(proposed.layoutAccess, proposed.layouts, name);
    const wa = `layout ${a.layout}, records ${a.records}`, wb = `layout ${b.layout}, records ${b.records}`;
    if (wa !== wb) out.push({ area: 'layouts', detail: `layout "${name}" → ${wb}` });
  }
  if (from.menuCommands !== proposed.menuCommands && !(from.menuCommands === undefined && proposed.menuCommands === 'all')) {
    out.push({ area: 'menuCommands', detail: `available menu commands → ${proposed.menuCommands ?? 'all'}` });
  }
  // The key-10 options: absent means allowed (idle-disconnect: on), so compare effective values.
  for (const [label, k] of [['printing', 'printing'], ['exporting records and Save a Copy', 'exporting'], ['changing own password', 'allowModifyPassword'], ['disconnecting when idle', 'idleDisconnect']] as const) {
    if ((from[k] !== false) !== (proposed[k] !== false)) out.push({ area: 'options', detail: `${label} → ${proposed[k] !== false ? 'allowed' : 'not allowed'}` });
  }
  if (JSON.stringify(from.aiVisible ?? {}) !== JSON.stringify(proposed.aiVisible ?? {})) out.push({ area: 'aiVisible', detail: `AI-visible exceptions → ${JSON.stringify(proposed.aiVisible ?? {})}` });
  const added = proposed.extendedPrivileges.filter((e) => !from.extendedPrivileges.includes(e));
  const removed = from.extendedPrivileges.filter((e) => !proposed.extendedPrivileges.includes(e));
  if (added.length) out.push({ area: 'extendedPrivileges', detail: `grant ${added.join(', ')}` });
  if (removed.length) out.push({ area: 'extendedPrivileges', detail: `revoke ${removed.join(', ')}` });
  return out;
}

export interface AccountTestLayout {
  layout: string;
  access: Level;
  records: Level;
}

/** A step in a runnable script that reaches for a layout or script the account can't use. */
export interface AccountTestBlocked {
  /** 1-based position among the script's own steps, as "line N" names it elsewhere. */
  line: number;
  step: string;
  target: 'layout' | 'script';
  name: string;
}

export interface AccountTestScript {
  script: string;
  access: Level;
  /** Where it would stop, if it's runnable at all: a Go to Layout or Perform Script step naming
   * something this account can't reach. Doesn't run anything, and doesn't follow into a step's own
   * nested script (that script gets its own entry in `scripts`, checked the same way). */
  blocked: AccountTestBlocked[];
}

export interface AccountTest {
  account: string;
  privilegeSet: string;
  layouts: AccountTestLayout[];
  scripts: AccountTestScript[];
}

/**
 * "Test this account": every layout and script in the file, as this account's
 * privileges would actually meet them — not just the access level, but, for a
 * script the account may run, whether it tries to jump to a layout or another
 * script the account can't reach. Built for the admin console's sandbox and
 * the handover memo. Nothing runs; nothing is written.
 */
export function testAccount(p: Privileges, schema: Schema, account: string): AccountTest {
  const layouts = schema.layouts.map((l) => {
    const { layout, records } = p.layout(l.name);
    return { layout: l.name, access: layout, records };
  });
  const scripts = schema.scripts.map((sc) => {
    const access = p.script(sc.name);
    const blocked: AccountTestBlocked[] = [];
    if (access !== 'none') {
      sc.steps.forEach((step, i) => {
        if (!step.enabled) return;
        if (step.name === 'Go to Layout' && step.params?.layout) {
          const name = step.params.layout.name;
          if (p.layout(name).layout === 'none') blocked.push({ line: i + 1, step: step.name, target: 'layout', name });
        } else if (
          (step.name === 'Perform Script' || step.name === 'Perform Script on Server' || step.name === 'Install OnTimer Script')
          && step.params?.script && !step.params.script.file
        ) {
          const name = step.params.script.name;
          if (p.script(name) === 'none') blocked.push({ line: i + 1, step: step.name, target: 'script', name });
        }
      });
    }
    return { script: sc.name, access, blocked };
  });
  return { account, privilegeSet: p.name, layouts, scripts };
}
