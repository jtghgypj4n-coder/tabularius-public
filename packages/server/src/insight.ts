// Understanding a solution, for AI clients: an overview of what it is and how
// it hangs together, where each field, script, layout and function is used,
// full-text search over every name, formula and script line, a data profile
// of a layout's fields (so a plain-English request can become a find), and a
// static check of a drafted calculation.
//
// Everything here reads the schema and layout designs; nothing runs scripts.

import { compile, parse, NameTable, type Node } from '../../calc/src/index.ts';
import { FUNCTIONS } from '../../calc/src/functions.ts';
import { unknownCalcTokens, type UnknownCalcToken } from '../../calc/src/unknown.ts';
import { HIDDEN_VALUE, containsSecret, redactSecrets, secretName, storedSecretValues } from './ai-output.ts';
import { externalFieldNames, PLUGIN_FUNCTIONS, scriptText, stepLine, type Field, type FieldRef as StepFieldRef, type LayoutObject, type StepParams, type Table } from '../../fmp12/src/index.ts';
import { dataSourceFile, q } from '../../store/src/import.ts';
import { checkStoreFormula, lintFormula, type Privileges, type Store } from '../../store/src/index.ts';

// --- references --------------------------------------------------------------

/** What a place in the solution points at. Fields are keyed "Table::Field" (base table). */
export interface Refs {
  fields: Set<string>;
  occurrences: Set<string>;
  tables: Set<string>;
  scripts: Set<string>;
  layouts: Set<string>;
  functions: Set<string>;
  valueLists: Set<string>;
  /** Why a formula here could not be parsed. */
  unparsed?: string;
  /** Reader IDs and structural shapes only; literals and user-defined names are omitted. */
  unknownTokens?: UnknownCalcToken[];
}

export type SiteKind = 'field' | 'script' | 'layout' | 'relationship' | 'customFunction' | 'valueList' | 'menu' | 'fileOptions';

/** One place in the solution: a field definition, a script step, a layout object, ... */
export interface Site {
  kind: SiteKind;
  /** Where, as a person would find it ("Script "New Invoice", line 4"). */
  where: string;
  /** What is there: the step line, the formula, the object. */
  text: string;
  refs: Refs;
  /** A script trigger, custom menu item or File Options entry: how the scripts it names get started ("OnRecordLoad on layout Invoices"). */
  starts?: string;
}

const emptyRefs = (): Refs => ({
  fields: new Set(), occurrences: new Set(), tables: new Set(), scripts: new Set(), layouts: new Set(), functions: new Set(), valueLists: new Set(),
});

const PLUGIN_CALLS = new Set(PLUGIN_FUNCTIONS.map((f) => f.toLowerCase()));
// A script's calculation can occur in both calculations[] and params. Count it once per site.
const unknownFormulas = new WeakMap<Refs, Set<string>>();
const lower = (s: string) => s.toLowerCase();

/** Steps whose effect leaves the machine (mail, network, other apps). Flagged so nobody runs them by accident. */
const OUTBOUND = /^(Send Mail|Send Event|Send DDE Execute|Insert from URL|Open URL|Perform AppleScript|Perform JavaScript in Web Viewer|Send|Execute SQL|Perform Script on Server|Import Records|Export Records|Save Records as PDF|Save Records as Excel|Print|Dial Phone|Send DDE|Open Data File|Write to Data File|Configure .*)/i;

/** A string that reads as a SQL query: its table and field names count as uses. */
const SQL_TEXT = /\bSELECT\b[\s\S]*\bFROM\b|\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i;

/** Lookups over one store's schema, built once. */
class Catalog {
  readonly store: Store;
  /** Table occurrence (lower-case name) -> its base table name (prefixed "file/" when in another file). */
  readonly toTable = new Map<string, string>();
  readonly toName = new Map<number, string>();
  readonly names: NameTable;
  readonly customFunctions: Set<string>;
  private readonly contextNames = new Map<number, NameTable>();

  constructor(store: Store) {
    this.store = store;
    const s = store.schema;
    const occurrences: [string, string[]][] = [];
    for (const to of s.tableOccurrences) {
      this.toName.set(to.id, to.name);
      const t = store.calc.occurrenceTable(to.id);
      if (t) this.toTable.set(lower(to.name), (t.store === store ? '' : `${t.store.name}/`) + t.table.name);
      occurrences.push([to.name, t?.table.fields.map((f) => f.name) ?? []]);
    }
    this.names = new NameTable({ occurrences });
    this.customFunctions = new Set(s.customFunctions.map((c) => lower(c.name)));
  }

  /** Name table for formulas evaluated from a table occurrence (unqualified names are its fields). */
  contextFor(toId: number | undefined): NameTable {
    if (toId === undefined) return this.names;
    let n = this.contextNames.get(toId);
    if (!n) {
      const own = this.store.calc.occurrenceTable(toId)?.table.fields.map((f) => f.name) ?? [];
      const occurrences: [string, string[]][] = this.store.schema.tableOccurrences.map((to) =>
        [to.name, this.store.calc.occurrenceTable(to.id)?.table.fields.map((f) => f.name) ?? []]);
      n = new NameTable({ fields: own, occurrences });
      this.contextNames.set(toId, n);
    }
    return n;
  }

  /** Names fields of other files' tables, which the reader leaves as ⟨field:TO.field⟩, when that file is hosted. */
  ext(text: string): string {
    return externalFieldNames(text, (toId, fieldId) => {
      const field = this.store.calc.occurrenceTable(toId)?.table.fields.find((f) => f.id === fieldId);
      return field ? `${this.toName.get(toId)}::${field.name}` : undefined;
    });
  }

  tableHasField(table: string | undefined, field: string): boolean {
    return !!table && !!this.store.schema.tables.find((t) => t.name === table)?.fields.some((f) => lower(f.name) === lower(field));
  }

  fieldKey(occurrence: string, field: string): string | undefined {
    const table = this.toTable.get(lower(occurrence));
    return table ? `${table}::${field}` : undefined;
  }

  defaultOccurrence(table: Table): number | undefined {
    return this.store.schema.tableOccurrences.find((t) => !t.dataSourceId && t.baseTableId === table.id)?.id;
  }

  /** Adds what a formula reads: fields (through their occurrences) and functions it calls. */
  formula(formula: string | undefined, refs: Refs, contextToId?: number, locals?: string[]): void {
    if (!formula) return;
    formula = this.ext(formula);
    let node: Node | undefined;
    try {
      node = parse(formula, this.contextFor(contextToId), locals);
    } catch (e) {
      refs.unparsed ??= (e as Error).message;
      // Not parseable (yet): fall back to "TO::Field" text matches.
      for (const [to, table] of this.toTable) {
        const at = lower(formula).indexOf(`${to}::`);
        if (at < 0) continue;
        refs.occurrences.add(to);
        const rest = formula.slice(at + to.length + 2);
        const field = this.names.fieldsOf(to)?.list.find((f) => lower(rest).startsWith(f.lower));
        if (field) refs.fields.add(`${table}::${field.name}`);
      }
      return;
    }
    const ctxTable = contextToId !== undefined ? this.toTable.get(lower(this.toName.get(contextToId) ?? '')) : undefined;
    let seen = unknownFormulas.get(refs);
    if (!seen) unknownFormulas.set(refs, seen = new Set());
    if (!seen.has(formula)) {
      seen.add(formula);
      const unknown = unknownCalcTokens(node);
      if (unknown.length) (refs.unknownTokens ??= []).push(...unknown);
    }
    walk(node, (n) => {
      if (n.k === 'field') {
        if (n.occurrence) {
          refs.occurrences.add(lower(n.occurrence));
          const key = this.fieldKey(n.occurrence, n.name);
          if (key) refs.fields.add(key);
        } else if (ctxTable) refs.fields.add(`${ctxTable}::${n.name}`);
      } else if (n.k === 'call') {
        refs.functions.add(lower(n.name));
        if (lower(n.name) === 'executesql' && n.args[0]) this.sqlRefs(n.args[0], refs);
      } else if (n.k === 'str' && SQL_TEXT.test(n.value)) {
        // Query text kept in a variable first (Set Variable [ $sql ; "SELECT ... FROM Invoices" ]).
        this.sqlText(n.value, refs);
      } else if (n.k === 'var' && PLUGIN_CALLS.has(lower(n.name)) && !this.tableHasField(ctxTable, n.name)) {
        // A plug-in function without parameters is written without parentheses (EmailVersion).
        refs.functions.add(lower(n.name));
      }
    });
  }

  /**
   * Table occurrences and fields named in ExecuteSQL's query text (the string literals in its first argument):
   * occurrences after FROM and JOIN, and their fields named anywhere in the query. Renaming one breaks the query.
   */
  private sqlRefs(arg: Node, refs: Refs): void {
    const parts: string[] = [];
    walk(arg, (n) => {
      if (n.k === 'str') parts.push(n.value);
    });
    this.sqlText(parts.join(' '), refs);
  }

  private sqlText(sql: string, refs: Refs): void {
    if (!sql.trim()) return;
    const tables = new Set<string>();
    for (const m of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:"([^"]+)"|([\p{L}_][\p{L}\p{N}_]*))/giu)) {
      const to = lower(m[1] ?? m[2]);
      if (this.names.fieldsOf(to)) tables.add(to);
    }
    if (!tables.size) return;
    const words = new Set([...sql.matchAll(/"([^"]+)"|([\p{L}_][\p{L}\p{N}_]*)/gu)].map((m) => lower(m[1] ?? m[2])));
    for (const to of tables) {
      refs.occurrences.add(to);
      for (const f of this.names.fieldsOf(to)?.list ?? []) {
        if (words.has(f.lower)) {
          const key = this.fieldKey(to, f.name);
          if (key) refs.fields.add(key);
        }
      }
    }
  }

  fieldRef(r: StepFieldRef | { tableOccurrence?: string; field?: string } | undefined, refs: Refs): void {
    if (!r) return;
    const to = typeof r.tableOccurrence === 'string' ? r.tableOccurrence : r.tableOccurrence?.name;
    const field = typeof r.field === 'string' ? r.field : r.field?.name;
    if (!to) return;
    refs.occurrences.add(lower(to));
    const key = field ? this.fieldKey(to, field) : undefined;
    if (key) refs.fields.add(key);
  }
}

function walk(n: Node, fn: (n: Node) => void): void {
  fn(n);
  switch (n.k) {
    case 'field': case 'var': if (n.rep) walk(n.rep, fn); break;
    case 'call': n.args.forEach((a) => walk(a, fn)); break;
    case 'let': n.binds.forEach(([, b, rep]) => { walk(b, fn); if (rep) walk(rep, fn); }); walk(n.body, fn); break;
    case 'unary': walk(n.a, fn); break;
    case 'bin': walk(n.a, fn); walk(n.b, fn); break;
  }
}

const quoted = (s: string) => `"${s}"`;

/** Formulas a step holds, with the step's other references. */
function stepRefs(cat: Catalog, p: StepParams | undefined, calculations: string[] | undefined, refs: Refs): void {
  for (const f of calculations ?? []) cat.formula(f, refs);
  if (!p) return;
  for (const f of [p.calculation, p.value, p.repetition, p.repetitionCalculation, p.fieldName, p.layoutCalculation, p.scriptCalculation, p.parameter, p.title, p.message]) {
    cat.formula(f, refs);
  }
  for (const f of Object.values(p.slots ?? {})) cat.formula(f, refs);
  cat.fieldRef(p.field, refs);
  cat.fieldRef(p.ai?.sourceField, refs);
  for (const r of p.requests ?? []) for (const c of r.criteria) cat.fieldRef(c.field, refs);
  for (const s of p.sort ?? []) cat.fieldRef(s.field, refs);
  if (p.script && !p.script.file) refs.scripts.add(lower(p.script.name));
  if (p.layout) refs.layouts.add(lower(p.layout.name));
  if (p.tableOccurrence) refs.occurrences.add(lower(p.tableOccurrence.name));
}

function layoutObjectSites(cat: Catalog, layout: string, toId: number | undefined, objects: LayoutObject[], out: Site[]): void {
  for (const o of objects) {
    const refs = emptyRefs();
    const parts: string[] = [];
    if (o.field) {
      cat.fieldRef(o.field, refs);
      // A field of a file that isn't hosted has no name here, only its id in that file.
      parts.push(`field ${o.field.tableOccurrence ?? `occurrence ${o.field.tableOccurrenceId}`}::${o.field.field ?? `⟨field ${o.field.fieldId} of a file not hosted here⟩`}`);
      if (o.field.valueList) {
        refs.valueLists.add(lower(o.field.valueList));
        parts.push(`value list ${quoted(o.field.valueList)}`);
      }
    }
    if (o.portal?.tableOccurrence) {
      refs.occurrences.add(lower(o.portal.tableOccurrence));
      parts.push(`portal of ${o.portal.tableOccurrence}`);
    }
    if (o.action) {
      if (o.action.file) {
        parts.push(`button: Perform Script in ${o.action.file.name}`);
      } else if (o.action.script) {
        refs.scripts.add(lower(o.action.script));
        parts.push(`button: Perform Script ${quoted(o.action.script)}`);
      } else if (o.action.layout) {
        refs.layouts.add(lower(o.action.layout));
        parts.push(`button: Go to Layout ${quoted(o.action.layout)}`);
      } else parts.push(`button: ${o.action.step}`);
      if (o.action.parameter) {
        cat.formula(o.action.parameter, refs, toId);
        parts.push(`parameter ${o.action.parameter}`);
      }
    }
    if (o.text) {
      // Merge fields: <<TO::Field>>
      for (const m of o.text.matchAll(/<<([^<>]+?)::([^<>]+?)>>/g)) cat.fieldRef({ tableOccurrence: m[1], field: m[2] }, refs);
      if (o.kind === 'text' || o.kind === 'button' || o.kind === 'tab-panel') parts.push(`${o.kind} ${quoted(o.text.replace(/\s+/g, ' ').slice(0, 120))}`);
    }
    for (const [label, f] of [['hide when', o.hide?.formula], ['placeholder', o.placeholder], ['tooltip', o.tooltip], ['web viewer address', o.webUrl]] as const) {
      if (!f) continue;
      cat.formula(f, refs, toId);
      parts.push(`${label}: ${f}`);
    }
    for (const c of o.conditions ?? []) {
      cat.formula(c.formula, refs, toId);
      parts.push(`conditional format: ${c.formula}`);
    }
    if (parts.length) {
      out.push({ kind: 'layout', where: `Layout ${quoted(layout)}${o.name ? `, object ${quoted(o.name)}` : ''}`, text: parts.join('; '), refs });
    }
    if (o.webUrl) {
      // Pages in a web viewer call scripts with FileMaker.PerformScript: from the address formula, or the fields it shows.
      const scripts = webViewerScripts(cat, o.webUrl, refs);
      if (scripts.length) {
        const sref = emptyRefs();
        for (const sc of scripts) sref.scripts.add(lower(sc));
        out.push({ kind: 'layout', where: `Layout ${quoted(layout)}, ${o.name ? `object ${quoted(o.name)}` : 'web viewer'}, its page`, text: scripts.map((sc) => `FileMaker.PerformScript ( ${quoted(sc)} )`).join('; '), refs: sref, starts: `the web viewer on layout ${layout}` });
      }
    }
    for (const t of o.triggers ?? []) out.push(triggerSite(cat, `Layout ${quoted(layout)}, ${o.name ? `object ${quoted(o.name)}` : `${o.kind} object`}`, t, toId, `${t.event} on an object of layout ${layout}`));
    if (o.children?.length) layoutObjectSites(cat, layout, toId, o.children, out);
  }
}

const PERFORM_SCRIPT = /FileMaker\.PerformScript(?:WithOption)?\s*\(\s*(["'])((?:(?!\1).)+)\1/g;

/** Scripts a web viewer's page calls: in its address formula's text, and in the stored values of the fields it reads (first rows). */
function webViewerScripts(cat: Catalog, url: string, refs: Refs): string[] {
  const texts = [url];
  for (const key of refs.fields) {
    const [table, field] = key.split('::');
    if (!table || !field || table.includes('/')) continue;
    if (!cat.store.schema.tables.some((t) => t.name === table && t.fields.some((f) => f.name === field))) continue;
    try {
      for (const r of cat.store.query(`SELECT ${q(field)} AS v FROM ${q(table)} WHERE ${q(field)} LIKE '%FileMaker.PerformScript%' LIMIT 20`, 20)) {
        if (typeof r.v === 'string') texts.push(r.v);
      }
    } catch {
      // A field without a column (an unstored calculation): only the formula's text counts.
    }
  }
  const names = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(PERFORM_SCRIPT)) names.add(m[2]);
  return [...names].filter((n) => cat.store.schema.scripts.some((sc) => sc.name === n));
}

/** A script trigger (layout, object or File Options): the script it performs and its parameter. */
function triggerSite(cat: Catalog, where: string, t: { event: string; scriptId: number; script?: string; parameter?: string }, toId: number | undefined, starts: string): Site {
  const refs = emptyRefs();
  const name = t.script ?? cat.store.schema.scripts.find((x) => x.id === t.scriptId)?.name;
  if (name) refs.scripts.add(lower(name));
  if (t.parameter) cat.formula(t.parameter, refs, toId);
  return { kind: 'layout', where: `${where}, trigger ${t.event}`, text: `Perform Script ${name ? quoted(name) : `(missing script ${t.scriptId})`}${t.parameter ? `; parameter ${t.parameter}` : ''}`, refs, starts };
}

function fieldSites(cat: Catalog, table: Table, out: Site[]): void {
  const s = cat.store.schema;
  for (const f of table.fields) {
    const where = `Field ${table.name}::${f.name}`;
    const ctx = f.calculationContextId ?? cat.defaultOccurrence(table);
    if (f.calculation !== undefined) {
      const refs = emptyRefs();
      cat.formula(f.calculation, refs, ctx);
      out.push({ kind: 'field', where: `${where} (${f.kind === 'calculation' ? 'calculation' : 'auto-enter'})`, text: f.calculation, refs });
    }
    const v = f.options?.validation;
    if (v?.calculation) {
      const refs = emptyRefs();
      cat.formula(v.calculation, refs, ctx);
      out.push({ kind: 'field', where: `${where} (validation)`, text: v.calculation, refs });
    }
    if (v?.valueList !== undefined) {
      const vl = s.valueLists.find((x) => x.id === v.valueList);
      if (vl) {
        const refs = emptyRefs();
        refs.valueLists.add(lower(vl.name));
        out.push({ kind: 'field', where: `${where} (validation)`, text: `member of value list ${quoted(vl.name)}`, refs });
      }
    }
    if (f.summary?.field) {
      const refs = emptyRefs();
      refs.fields.add(`${table.name}::${f.summary.field}`);
      out.push({ kind: 'field', where: `${where} (summary)`, text: `${f.summary.type} of ${f.summary.field}`, refs });
    }
  }
}

export interface Index {
  sites: Site[];
  /** Script name (lower) -> the scripts it performs, and who performs it. */
  calls: Map<string, Set<string>>;
  callers: Map<string, Set<string>>;
  /** Script name (lower) -> layouts whose buttons run it. */
  buttons: Map<string, Set<string>>;
  /** Script name (lower) -> the script triggers, custom menu items and File Options that start it. */
  starters: Map<string, Set<string>>;
  /** Script name (lower) -> how it reaches outside the solution: steps, and plug-in functions it calls. */
  outbound: Map<string, Set<string>>;
  catalog: Catalog;
}

const indexes = new WeakMap<Store, { schema: Store['schema']; index: Index }>();

/** Every reference in the solution, computed once per store and again after its design changes (a new schema). */
export function solutionIndex(store: Store): Index {
  const cached = indexes.get(store);
  if (cached && cached.schema === store.schema) return cached.index;
  const cat = new Catalog(store);
  const s = store.schema;
  const sites: Site[] = [];
  for (const t of s.tables) fieldSites(cat, t, sites);

  for (const r of s.relationships) {
    const refs = emptyRefs();
    const left = r.leftTableOccurrence ?? cat.toName.get(r.leftTableOccurrenceId) ?? '?';
    const right = r.rightTableOccurrence ?? cat.toName.get(r.rightTableOccurrenceId) ?? '?';
    refs.occurrences.add(lower(left));
    refs.occurrences.add(lower(right));
    // Fields of tables in other files are named through the hosted file, when it is here.
    const fieldName = (toId: number, id: number, known?: string) =>
      known ?? store.calc.occurrenceTable(toId)?.table.fields.find((f) => f.id === id)?.name;
    const preds = r.predicates.map((p) => {
      const lf = fieldName(r.leftTableOccurrenceId, p.leftFieldId, p.leftField);
      const rf = fieldName(r.rightTableOccurrenceId, p.rightFieldId, p.rightField);
      cat.fieldRef({ tableOccurrence: left, field: lf }, refs);
      cat.fieldRef({ tableOccurrence: right, field: rf }, refs);
      return `${left}::${lf ?? `⟨field ${p.leftFieldId}⟩`} ${p.operator} ${right}::${rf ?? `⟨field ${p.rightFieldId}⟩`}`;
    });
    sites.push({ kind: 'relationship', where: `Relationship ${left} → ${right}`, text: preds.join(' AND ') || `${left} × ${right}`, refs });
  }

  const calls = new Map<string, Set<string>>();
  const callers = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  for (const script of s.scripts) {
    const from = lower(script.name);
    script.steps.forEach((step, i) => {
      const refs = emptyRefs();
      stepRefs(cat, step.params, step.calculations, refs);
      const line = step.line ?? stepLine(step.name, step.params, step.text);
      sites.push({ kind: 'script', where: `Script ${quoted(script.name)}, line ${i + 1}`, text: (step.enabled ? '' : '// ') + line, refs });
      if (step.enabled) {
        const reasons = [...(OUTBOUND.test(step.name) ? [step.name] : []),
          ...[...refs.functions].filter((f) => !FUNCTIONS.has(f) && !cat.customFunctions.has(f)).map((f) => `plug-in function ${f}`)];
        if (reasons.length) {
          if (!outbound.has(from)) outbound.set(from, new Set());
          for (const r of reasons) outbound.get(from)!.add(r);
        }
      }
      for (const to of refs.scripts) {
        if (!calls.has(from)) calls.set(from, new Set());
        calls.get(from)!.add(to);
        if (!callers.has(to)) callers.set(to, new Set());
        callers.get(to)!.add(script.name);
      }
    });
  }

  const buttons = new Map<string, Set<string>>();
  const starters = new Map<string, Set<string>>();
  const startSite = (site: Site) => {
    sites.push(site);
    for (const sc of site.refs.scripts) {
      if (!starters.has(sc)) starters.set(sc, new Set());
      starters.get(sc)!.add(site.starts!);
    }
  };
  const fo = s.fileOptions;
  if (fo) {
    for (const [key, event] of [['onFirstWindowOpen', 'OnFirstWindowOpen'], ['onLastWindowClose', 'OnLastWindowClose'], ['onWindowOpen', 'OnWindowOpen'], ['onWindowClose', 'OnWindowClose']] as const) {
      const t = fo[key];
      if (t) startSite({ ...triggerSite(cat, 'File Options', { event, ...t }, undefined, `File Options ${event}`), kind: 'fileOptions' });
    }
    const open = fo.openLayout ?? s.layouts.find((l) => l.id === fo.openLayoutId)?.name;
    if (open) {
      const refs = emptyRefs();
      refs.layouts.add(lower(open));
      sites.push({ kind: 'fileOptions', where: 'File Options', text: `opens on layout ${quoted(open)}`, refs });
    }
  }
  for (const menu of s.customMenus ?? []) {
    for (const item of menu.items ?? []) {
      const name = item.script ?? (item.scriptId !== undefined ? s.scripts.find((x) => x.id === item.scriptId)?.name : undefined);
      if (!name && !item.installWhen && !item.title) continue;
      const refs = emptyRefs();
      if (name) refs.scripts.add(lower(name));
      for (const f of [item.parameter, item.installWhen, item.title]) if (f) cat.formula(f, refs, undefined);
      const label = item.command ?? (item.kind === 'submenu' ? `submenu ${item.submenu ?? ''}` : 'item');
      const text = [name ? `Perform Script ${quoted(name)}` : '', item.parameter ? `parameter ${item.parameter}` : '', item.title ? `title ${item.title}` : '', item.installWhen ? `install when ${item.installWhen}` : ''].filter(Boolean).join('; ');
      const site: Site = { kind: 'menu', where: `Custom menu ${quoted(menu.name)}, ${label}`, text, refs, ...(name ? { starts: `custom menu ${menu.name}` } : {}) };
      if (name) startSite(site);
      else sites.push(site);
    }
  }
  for (const design of store.designs().layouts) {
    const layoutSites: Site[] = [];
    const to = design.tableOccurrenceId !== undefined ? cat.toName.get(design.tableOccurrenceId) : undefined;
    if (to) {
      // The layout shows records of its table occurrence: renaming or deleting it breaks the layout.
      const refs = emptyRefs();
      refs.occurrences.add(lower(to));
      const table = cat.toTable.get(lower(to));
      if (table) refs.tables.add(lower(table));
      layoutSites.push({ kind: 'layout', where: `Layout ${quoted(design.name)}`, text: `shows records from ${to}`, refs });
    }
    for (const t of design.triggers ?? []) layoutSites.push(triggerSite(cat, `Layout ${quoted(design.name)}`, t, design.tableOccurrenceId, `${t.event} on layout ${design.name}`));
    layoutObjectSites(cat, design.name, design.tableOccurrenceId, design.objects, layoutSites);
    for (const site of layoutSites) {
      for (const sc of site.refs.scripts) {
        const map = site.starts ? starters : buttons;
        if (!map.has(sc)) map.set(sc, new Set());
        map.get(sc)!.add(site.starts ?? design.name);
      }
    }
    sites.push(...layoutSites);
  }

  for (const cf of s.customFunctions) {
    const refs = emptyRefs();
    // A JavaScript function's body isn't a calculation: it refers to nothing in the file.
    if (cf.language !== 'javascript') cat.formula(cf.formula, refs, undefined, cf.parameters.map((p) => p.trim()));
    sites.push({ kind: 'customFunction', where: `Custom function ${cf.name} ( ${cf.parameters.join(' ; ')} )${cf.language === 'javascript' ? ' [JavaScript]' : ''}`, text: cf.formula ?? '', refs });
  }
  for (const vl of s.valueLists) {
    if (!vl.values?.length) continue;
    sites.push({ kind: 'valueList', where: `Value list ${quoted(vl.name)}`, text: vl.values.join(', '), refs: emptyRefs() });
  }

  // Secrets written into scripts and formulas (passwords, API keys) never reach a model or a document.
  for (const site of sites) site.text = redactSecrets(cat.ext(site.text));
  const index: Index = { sites, calls, callers, buttons, starters, outbound, catalog: cat };
  indexes.set(store, { schema: store.schema, index });
  return index;
}

// --- where used --------------------------------------------------------------

export type TargetKind = 'field' | 'table' | 'tableOccurrence' | 'script' | 'layout' | 'customFunction' | 'valueList';

export interface Target {
  kind: TargetKind;
  name: string;
}

/** What a name could mean: "Invoices::Total" is a field; a bare name may be several things. */
export function resolveTargets(store: Store, name: string, kind?: TargetKind): Target[] {
  const s = store.schema;
  const n = lower(name.trim());
  const cat = solutionIndex(store).catalog;
  const out: Target[] = [];
  const want = (k: TargetKind) => !kind || kind === k;
  const field = /^(.+?)::(.+)$/.exec(name.trim());
  if (field && want('field')) {
    const [, left, right] = field;
    const table = cat.toTable.get(lower(left)) ?? s.tables.find((t) => lower(t.name) === lower(left))?.name;
    if (table) {
      const t = s.tables.find((x) => x.name === table);
      const f = t?.fields.find((x) => lower(x.name) === lower(right));
      out.push({ kind: 'field', name: `${table}::${f?.name ?? right}` });
    }
    return out;
  }
  if (want('script')) for (const x of s.scripts) if (lower(x.name) === n) out.push({ kind: 'script', name: x.name });
  if (want('layout')) for (const x of s.layouts) if (lower(x.name) === n) out.push({ kind: 'layout', name: x.name });
  if (want('table')) for (const x of s.tables) if (lower(x.name) === n) out.push({ kind: 'table', name: x.name });
  if (want('tableOccurrence')) for (const x of s.tableOccurrences) if (lower(x.name) === n) out.push({ kind: 'tableOccurrence', name: x.name });
  if (want('customFunction')) for (const x of s.customFunctions) if (lower(x.name) === n) out.push({ kind: 'customFunction', name: x.name });
  if (want('valueList')) for (const x of s.valueLists) if (lower(x.name) === n) out.push({ kind: 'valueList', name: x.name });
  if (want('field')) {
    for (const t of s.tables) for (const f of t.fields) if (lower(f.name) === n) out.push({ kind: 'field', name: `${t.name}::${f.name}` });
  }
  // Unique by kind + name (a script and a layout may share a name).
  return out.filter((t, i) => out.findIndex((x) => x.kind === t.kind && x.name === t.name) === i);
}

function matches(site: Site, t: Target, store: Store): boolean {
  const n = lower(t.name);
  switch (t.kind) {
    case 'field': return [...site.refs.fields].some((f) => lower(f) === n);
    case 'script': return site.refs.scripts.has(n);
    case 'layout': return site.refs.layouts.has(n);
    case 'tableOccurrence': return site.refs.occurrences.has(n);
    case 'customFunction': return site.refs.functions.has(n);
    case 'valueList': return site.refs.valueLists.has(n);
    case 'table': {
      const cat = solutionIndex(store).catalog;
      return [...site.refs.occurrences].some((o) => lower(cat.toTable.get(o) ?? '') === n) ||
        [...site.refs.fields].some((f) => lower(f).startsWith(`${n}::`));
    }
  }
}

export interface Usage {
  kind: SiteKind;
  where: string;
  text: string;
}

/** Every place that uses a field, script, layout, table, occurrence, custom function or value list. */
export function whereUsed(store: Store, name: string, kind?: TargetKind, limit = 200): { target: Target; count: number; usages: Usage[] }[] {
  const index = solutionIndex(store);
  const targets = resolveTargets(store, name, kind);
  return targets.map((target) => {
    const hits = index.sites.filter((site) => matches(site, target, store) && !isDefinition(site, target));
    const needles = [target.name, target.name.replace(/^.*::/, '')];
    return { target, count: hits.length, usages: hits.slice(0, limit).map(({ kind, where, text }) => ({ kind, where, text: clipAround(text, needles, 300) })) };
  });
}

/** What one script depends on and what depends on it: the script's own dependency map (FileMaker has none). */
export interface ScriptDependencies {
  script: string;
  /** What its steps use, each with the lines that use it. `byName`: a line names it in text, which a rename doesn't reach. */
  uses: { kind: 'field' | 'layout' | 'script' | 'valueList' | 'customFunction'; name: string; lines: number[]; byName?: boolean }[];
  /** What starts it: the scripts that perform it, buttons, script triggers, custom menus and File Options. */
  startedBy: { how: 'script' | 'button' | 'trigger'; name: string }[];
  /** How it reaches outside the solution (mail, network, other apps, plug-in functions). */
  outbound: string[];
}

/** Text that names fields as strings: GetField ( "T::F" ), ExecuteSQL queries, Evaluate, "by name" steps. */
const NAMES_IN_TEXT = /\b(ExecuteSQL|GetField|GetFieldName|Evaluate)\b|\bBy Name\b|\bSELECT\b[\s\S]*\bFROM\b/i;

export function scriptDependencies(store: Store, scriptId: number): ScriptDependencies | undefined {
  const s = store.schema;
  const script = s.scripts.find((x) => x.id === scriptId);
  if (!script) return undefined;
  const index = solutionIndex(store);
  const prefix = `Script ${quoted(script.name)}, line `;
  const proper = (items: { name: string }[]) => new Map(items.map((x) => [lower(x.name), x.name]));
  const names = {
    script: proper(s.scripts), layout: proper(s.layouts), valueList: proper(s.valueLists ?? []), customFunction: proper(s.customFunctions ?? []),
  };
  const uses = new Map<string, ScriptDependencies['uses'][number]>();
  const use = (kind: ScriptDependencies['uses'][number]['kind'], name: string, line: number, byName = false) => {
    const key = `${kind}\u0000${lower(name)}`;
    const u = uses.get(key) ?? { kind, name, lines: [] };
    uses.set(key, u);
    if (!u.lines.includes(line)) u.lines.push(line);
    if (byName) u.byName = true;
  };
  for (const site of index.sites) {
    if (site.kind !== 'script' || !site.where.startsWith(prefix)) continue;
    const line = Number(site.where.slice(prefix.length));
    const inText = NAMES_IN_TEXT.test(site.text);
    for (const f of site.refs.fields) use('field', f, line);
    // "Table::Field" in quotes (GetField, Set Field By Name, Evaluate): not a reference the index follows, and
    // exactly what a rename leaves behind.
    if (inText) {
      for (const [, to, field] of site.text.matchAll(/"([^"\\:]+)::([^"\\]+)"/g)) {
        const table = index.catalog.toTable.get(lower(to));
        const def = table && s.tables.find((t) => t.name === table)?.fields.find((x) => lower(x.name) === lower(field));
        if (def) use('field', `${table}::${def.name}`, line, true);
      }
    }
    for (const l of site.refs.layouts) use('layout', names.layout.get(l) ?? l, line);
    for (const x of site.refs.scripts) use('script', names.script.get(x) ?? x, line);
    for (const v of site.refs.valueLists) use('valueList', names.valueList.get(v) ?? v, line);
    for (const c of site.refs.functions) if (names.customFunction.has(c)) use('customFunction', names.customFunction.get(c)!, line);
  }
  const key = lower(script.name);
  const startedBy: ScriptDependencies['startedBy'] = [
    ...[...index.callers.get(key) ?? []].filter((c) => c !== script.name).map((name) => ({ how: 'script' as const, name })),
    ...[...index.buttons.get(key) ?? []].map((name) => ({ how: 'button' as const, name: `a button on layout ${quoted(names.layout.get(lower(name)) ?? name)}` })),
    ...[...index.starters.get(key) ?? []].map((name) => ({ how: 'trigger' as const, name })),
  ];
  const order = { field: 0, layout: 1, script: 2, valueList: 3, customFunction: 4 };
  return {
    script: script.name,
    uses: [...uses.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)),
    startedBy,
    outbound: [...index.outbound.get(key) ?? []],
  };
}

/** Up to n characters of text around the first place one of the names appears (a long formula's use may be far from its start). */
function clipAround(text: string, names: string[], n: number): string {
  if (text.length <= n) return text;
  const low = text.toLowerCase();
  const at = names.map((x) => low.indexOf(x.toLowerCase())).find((i) => i >= 0) ?? -1;
  if (at < n - 60) return clip(text, n);
  const start = Math.max(0, Math.min(at - 100, text.length - n + 2));
  const body = text.slice(start + 1, start + n - 1);
  return `…${body}${start + n - 1 < text.length ? '…' : ''}`;
}

/** A field's own definition is not a use of it. */
function isDefinition(site: Site, t: Target): boolean {
  return t.kind === 'field' && site.kind === 'field' && site.where.startsWith(`Field ${t.name} (`);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// --- search ------------------------------------------------------------------

export interface SearchHit {
  kind: SiteKind | 'table' | 'tableOccurrence' | 'script' | 'layout' | 'valueList' | 'customFunction' | 'field';
  where: string;
  text?: string;
}

/**
 * Case-insensitive search over names, comments, formulas, script lines and
 * layout text. Every word must appear (in any order) in a hit.
 */
export function searchSolution(store: Store, query: string, limit = 100): { count: number; byKind: Record<string, number>; hits: SearchHit[] } {
  const words = lower(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { count: 0, byKind: {}, hits: [] };
  const has = (...texts: (string | undefined)[]) => {
    const all = lower(texts.filter(Boolean).join(' \u0000 '));
    return words.every((w) => all.includes(w));
  };
  const s = store.schema;
  const hits: SearchHit[] = [];
  for (const t of s.tables) {
    if (has(t.name)) hits.push({ kind: 'table', where: `Table ${t.name}` });
    for (const f of t.fields) {
      if (has(t.name, f.name, f.comment)) {
        hits.push({ kind: 'field', where: `Field ${t.name}::${f.name}`, text: [f.kind === 'normal' ? f.type : `${f.kind} (${f.type})`, f.comment].filter(Boolean).join(' — ') });
      }
    }
  }
  for (const to of s.tableOccurrences) if (has(to.name)) hits.push({ kind: 'tableOccurrence', where: `Table occurrence ${to.name}` });
  for (const l of s.layouts) if (has(l.name)) hits.push({ kind: 'layout', where: `Layout ${quoted(l.name)}` });
  for (const x of s.scripts) if (has(x.name)) hits.push({ kind: 'script', where: `Script ${quoted(x.name)}`, text: `${x.steps.length} steps` });
  for (const v of s.valueLists) if (has(v.name)) hits.push({ kind: 'valueList', where: `Value list ${quoted(v.name)}` });
  for (const c of s.customFunctions) if (has(c.name)) hits.push({ kind: 'customFunction', where: `Custom function ${c.name}` });
  for (const site of solutionIndex(store).sites) {
    if (has(site.text)) hits.push({ kind: site.kind, where: site.where, text: clip(site.text, 300) });
  }
  const byKind: Record<string, number> = {};
  for (const h of hits) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
  return { count: hits.length, byKind, hits: hits.slice(0, limit) };
}

// --- layout profile (plain-English finds) -------------------------------------

export interface FieldProfile {
  /** Name to use in a find request on this layout ("Field" or "TO::Field"). */
  name: string;
  type: string;
  kind: string;
  comment?: string;
  valueList?: string;
  /** Allowed values (the value list's, or the most common ones). */
  values?: string[];
  /** How many of the table's records have a value, and how many distinct values. */
  filled?: number;
  distinct?: number;
  min?: string | number;
  max?: string | number;
  examples?: (string | number)[];
  /** The account sees a stand-in for this field's value: it can't search, sort, total or change it, and no counts or values are given. */
  masked?: true;
}

/**
 * Fields on a layout with what is in them: types, value lists, counts, ranges
 * and common values. Enough for an AI to turn "unpaid invoices from last
 * month over $500" into a find request without guessing at field names.
 */
export function layoutProfile(store: Store, layoutName: string, opts: { sample?: boolean; privileges?: Privileges } = {}): {
  layout: string; table: string; occurrence: string; records: number; fields: FieldProfile[]; portals: { occurrence: string; fields: string[] }[];
} {
  const info = store.layout(layoutName);
  const owner = info.owner;
  const table = owner.schema.tables.find((t) => t.name === info.table)!;
  const design = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
  // With privileges: only fields the account can see, and values only from records it can view.
  const pv = opts.privileges;
  const viewable = new Map<Store, Map<string, number[] | undefined>>();
  const viewableIds = (s: Store, t: string) => {
    if (!pv) return undefined;
    const m = viewable.get(s) ?? new Map<string, number[] | undefined>();
    viewable.set(s, m);
    if (!m.has(t)) m.set(t, s.viewableIds(t, pv));
    return m.get(t);
  };
  const ownIds = viewableIds(owner, table.name);
  const records = ownIds ? ownIds.length : Number(owner.query(`SELECT count(*) AS n FROM ${q(table.name)}`)[0]?.n ?? 0);
  const vlById = new Map(store.schema.valueLists.map((v) => [v.id, v]));
  const vlByName = new Map(store.schema.valueLists.map((v) => [lower(v.name), v]));

  // Fields the layout shows (in layout order), else all fields of its table.
  const shown: { to: string; field: string; valueList?: string }[] = [];
  const portals: { occurrence: string; fields: string[] }[] = [];
  const visit = (objects: LayoutObject[], portal?: { occurrence: string; fields: string[] }) => {
    for (const o of objects) {
      if (o.portal?.tableOccurrence) {
        const p = { occurrence: o.portal.tableOccurrence, fields: [] as string[] };
        portals.push(p);
        if (o.children) visit(o.children, p);
        continue;
      }
      if (o.field?.tableOccurrence && o.field.field) {
        // Portal fields are listed with their portal and profiled like any related field (finds can use them).
        if (portal && lower(o.field.tableOccurrence) === lower(portal.occurrence)) portal.fields.push(`${o.field.tableOccurrence}::${o.field.field}`);
        shown.push({ to: o.field.tableOccurrence, field: o.field.field, valueList: o.field.valueList });
      }
      if (o.children) visit(o.children, portal);
    }
  };
  if (design) visit(design.objects);
  const seen = new Set<string>();
  const list = shown.filter((x) => {
    const k = lower(`${x.to}::${x.field}`);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!list.length) for (const f of table.fields) list.push({ to: info.occurrence, field: f.name });

  const fields: FieldProfile[] = [];
  for (const x of list) {
    const local = lower(x.to) === lower(info.occurrence);
    let rel: { store: Store; table: Table } | undefined;
    if (!local) {
      const to = store.schema.tableOccurrences.find((t) => lower(t.name) === lower(x.to));
      rel = to ? store.calc.occurrenceTable(to.id) : undefined;
    }
    const src = local ? { store: owner, table } : rel;
    const f = src?.table.fields.find((y) => lower(y.name) === lower(x.field));
    if (!src || !f) continue;
    const access = pv ? pv.in(src.store).fieldAccess(src.table.name, f.name) : undefined;
    if (access === 'none') continue;
    const p: FieldProfile = {
      name: local ? f.name : `${x.to}::${f.name}`,
      type: f.type,
      kind: f.kind === 'normal' ? (f.options?.global ? 'global' : 'data') : f.kind === 'calculation' && f.options?.unstored ? 'unstored calculation' : f.kind,
    };
    // A masked field is listed, so a model knows it exists, but nothing is worked out from its values.
    if (access === 'masked') {
      fields.push({ ...p, masked: true });
      continue;
    }
    if (f.comment) p.comment = f.comment;
    const vl = (x.valueList ? vlByName.get(lower(x.valueList)) : undefined) ??
      (f.options?.validation?.valueList !== undefined ? vlById.get(f.options.validation.valueList) : undefined);
    if (vl && (!pv || pv.valueList(vl.name) !== 'none')) {
      p.valueList = vl.name;
      if (vl.values?.length) p.values = vl.values.slice(0, 50);
    }
    if (opts.sample !== false && f.type !== 'container' && !(f.kind === 'calculation' && f.options?.unstored) && f.kind !== 'summary') {
      Object.assign(p, columnProfile(src.store, src.table, f, !p.values, viewableIds(src.store, src.table.name)));
    }
    fields.push(p);
  }
  return { layout: info.name, table: info.table, occurrence: info.occurrence, records, fields, portals };
}

function columnProfile(store: Store, table: Table, f: Field, wantValues: boolean, ids?: number[]): Partial<FieldProfile> {
  const col = q(f.name);
  // Only the given records, when the account can't view them all.
  const from = ids ? `(SELECT * FROM ${q(table.name)} WHERE _fm_record_id IN (SELECT value FROM json_each('${JSON.stringify(ids.map(Number))}')))` : q(table.name);
  try {
    const stats = store.query(
      `SELECT count(${col}) AS filled, count(DISTINCT ${col}) AS distinct_, min(${col}) AS lo, max(${col}) AS hi FROM ${from} WHERE ${col} IS NOT NULL AND ${col} <> ''`,
    )[0] ?? {};
    const out: Partial<FieldProfile> = { filled: Number(stats.filled ?? 0), distinct: Number(stats.distinct_ ?? 0) };
    if (!out.filled) return out;
    if (f.type === 'number') {
      // Text typed into a number field sorts after every number; the range is of the numbers.
      const r = store.query(`SELECT min(${col}) AS lo, max(${col}) AS hi FROM ${from} WHERE typeof(${col}) IN ('integer', 'real')`)[0];
      if (r?.lo !== null && r?.lo !== undefined) {
        out.min = Number(r.lo);
        out.max = Number(r.hi);
      }
    } else if (f.type === 'date' || f.type === 'time' || f.type === 'timestamp') {
      out.min = stats.lo as string;
      out.max = stats.hi as string;
    }
    // Few distinct values: list them (a status, a category). Otherwise a handful of examples. None of a password or key.
    if (secretName(f.name)) return out;
    if (wantValues && out.distinct! <= 25 && f.type === 'text') {
      out.values = store.query(`SELECT ${col} AS v, count(*) AS n FROM ${from} WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col} ORDER BY n DESC`, 25)
        .map((r) => clip(String(r.v), 80));
    } else {
      out.examples = store.query(`SELECT DISTINCT ${col} AS v FROM ${from} WHERE ${col} IS NOT NULL AND ${col} <> '' LIMIT 5`, 5)
        .map((r) => (typeof r.v === 'string' ? clip(r.v, 80) : Number(r.v)));
    }
    return out;
  } catch {
    return {};
  }
}

// --- calculation check ---------------------------------------------------------

export interface CalculationCheck {
  ok: boolean;
  /** FileMaker's error code and message when the formula would be rejected. */
  error?: { code: number; message: string };
  fields: { name: string; found: boolean }[];
  functions: { name: string; kind: 'built-in' | 'custom' | 'unknown' }[];
  /** Plain-language problems: unknown names, wrong argument counts. */
  problems: string[];
  /** What couldn't be checked: fields of files that aren't hosted here. */
  notes?: string[];
  /** Results on a few records, when asked for. */
  results?: { recordId: number; value?: string; type?: string; error?: string }[];
  /** What FileMaker accepts without a word but may surprise (text in arithmetic, dates compared with text, ...). */
  warnings?: string[];
}

/**
 * A formula's results as a model may read them: hidden when the formula names a password, key or token field, when
 * a result is a copy of a secret stored anywhere in the file, and (while the file stores any secret) when the formula
 * can build a field's name as it runs (ExecuteSQL, GetField, Evaluate, a custom function) so no name or copy shows
 * where it reached. Worked out once for the formula, then applied to each result. People see the real result.
 */
export function formulaGuard(store: Store, toId: number | undefined, formula: string, secrets = storedSecretValues(store)): <R extends { value?: string }>(result: R) => R {
  const reads = checkFormula(store, toId, formula).fields.some((f) => f.found && secretName(f.name));
  const custom = store.schema.customFunctions.some((c) => formula.toLowerCase().includes(c.name.toLowerCase()));
  const dynamic = secrets.length > 0 && (custom || /\b(ExecuteSQL|GetField|Evaluate)\b/i.test(formula));
  return (result) => {
    if (result.value === undefined || result.value === '') return result;
    return reads || dynamic || containsSecret(result.value, secrets) ? { ...result, value: HIDDEN_VALUE } : result;
  };
}

/**
 * Checks a drafted formula against a layout's context without changing data:
 * syntax, field names (unqualified ones belong to the layout's table, others
 * need a table occurrence), function names and argument counts. Optionally
 * evaluates it on the first few records of the layout.
 */
export function checkCalculation(store: Store, layoutName: string, formula: string, sampleRecords = 0, privileges?: Privileges): CalculationCheck {
  const info = store.layout(layoutName);
  const toId = store.calc.occurrence(info.occurrence)?.id;
  const check = checkFormula(store, toId, formula, privileges);
  if (check.error) return check;
  const warnings = lintFormula(store, formula, { occurrence: toId, privileges }).filter((w) => w.code !== 'reference').map((w) => w.message);
  if (warnings.length) check.warnings = warnings;
  if (sampleRecords > 0) {
    const ids = store.findIds(info).slice(0, Math.min(sampleRecords, 20));
    const guard = formulaGuard(store, toId, formula);
    check.results = ids.map((recordId) => {
      try {
        return { recordId, ...guard(store.evaluate(info, formula, recordId, privileges ? { account: privileges.account, privileges, typed: true } : {})) };
      } catch (e) {
        return { recordId, error: (e as Error).message };
      }
    });
  }
  return check;
}

/**
 * Static check of a formula evaluated from a table occurrence (unqualified
 * names are its fields; none when the context is unknown). `variables` lists
 * the $ and $$ variables it reads.
 */
export function checkFormula(store: Store, contextToId: number | undefined, formula: string, privileges?: Privileges): CalculationCheck & { variables: string[] } {
  // For an account's own formula, names in another file resolve only as far as the account sees that file: a field it can't
  // see is refused as one that doesn't exist is, before the catalog (which knows every file's fields) offers a "did you mean".
  if (privileges) {
    const seen = checkStoreFormula(store, formula, { occurrence: contextToId }, privileges);
    // Refused when the account's view is what fails (the open check passes), or a name is missing in a formula that names
    // a table of another file: the catalog's suggestions are for the rest, where no other file's field can come up.
    const lower = formula.toLowerCase();
    const other = store.schema.tableOccurrences.some((to) => to.dataSourceId && lower.includes(`${to.name.toLowerCase()}::`));
    if (!seen.ok && ((seen.code === 102 && other) || checkStoreFormula(store, formula, { occurrence: contextToId }).ok)) {
      return { ok: false, error: { code: seen.code, message: seen.message }, fields: [], functions: [], problems: [seen.message], variables: [] };
    }
  }
  const cat = solutionIndex(store).catalog;
  const names = cat.contextFor(contextToId);
  const tableName = contextToId !== undefined ? store.calc.occurrenceTable(contextToId)?.table.name ?? 'the current table' : 'the current table';
  const info = { table: tableName };
  const check: CalculationCheck & { variables: string[] } = { ok: true, fields: [], functions: [], problems: [], variables: [] };
  let node: Node;
  try {
    node = compile(cat.ext(formula), names).node;
  } catch (e) {
    const err = e as Error & { code?: number };
    return { ok: false, error: { code: err.code ?? 1200, message: err.message }, fields: [], functions: [], problems: [err.message], variables: [] };
  }
  const to = contextToId !== undefined ? { id: contextToId } : undefined;
  const bound = new Set<string>();
  const seenFields = new Set<string>();
  const seenFns = new Set<string>();
  const ownFieldNames = (store.calc.occurrenceTable(to?.id ?? -1)?.table.fields ?? []).map((f) => f.name);
  const ownFields = new Set(ownFieldNames.map(lower));
  const cfs = new Map(store.schema.customFunctions.map((c) => [lower(c.name), c]));
  const visit = (n: Node, scope: Set<string>) => {
    switch (n.k) {
      case 'field': {
        const name = n.occurrence ? `${n.occurrence}::${n.name}` : n.name;
        if (!seenFields.has(lower(name))) {
          seenFields.add(lower(name));
          let found: boolean;
          const elsewhere = n.occurrence ? unhostedFileOf(store, n.occurrence) : undefined;
          if (elsewhere) {
            // A table in a file that isn't hosted: its field names can't be checked here, which isn't a mistake.
            found = true;
            const note = `${n.occurrence} is a table of ${elsewhere}, which isn't hosted here: its fields can't be checked or read`;
            if (!check.notes?.includes(note)) (check.notes ??= []).push(note);
          } else if (n.occurrence) {
            const fieldsOf = names.fieldsOf(n.occurrence);
            found = !!fieldsOf?.list.some((f) => f.lower === lower(n.name));
            if (!fieldsOf) check.problems.push(`There is no table occurrence named "${n.occurrence}"${didYouMean(n.occurrence, names.occurrences.list.map((x) => x.name))}`);
            else if (!found) check.problems.push(`"${n.occurrence}" has no field named "${n.name}"${didYouMean(n.name, fieldsOf.list.map((x) => x.name))}`);
          } else {
            found = ownFields.has(lower(n.name));
            if (!found) check.problems.push(`${info.table} has no field named "${n.name}"${didYouMean(n.name, [...ownFieldNames])}`);
          }
          check.fields.push({ name, found });
        }
        if (n.rep) visit(n.rep, scope);
        break;
      }
      case 'var':
        if (n.name.startsWith('$') && !check.variables.includes(n.name)) check.variables.push(n.name);
        // A bare name that is not a field: a Let variable, a function without parameters (JSONString,
        // a custom function), a field of a file that is not hosted (⟨field:..⟩), or a mistake.
        if (!n.name.startsWith('$') && !scope.has(lower(n.name)) && !seenFields.has(lower(n.name)) &&
          FUNCTIONS.get(lower(n.name))?.min !== 0 && cfs.get(lower(n.name))?.parameters.length !== 0 && !n.name.startsWith('⟨')) {
          seenFields.add(lower(n.name));
          check.fields.push({ name: n.name, found: false });
          check.problems.push(`"${n.name}" is not a field of ${info.table}, a Let variable or a function${didYouMean(n.name, [...ownFieldNames])}`);
        }
        if (n.rep) visit(n.rep, scope);
        break;
      case 'call': {
        const key = lower(n.name);
        const builtin = FUNCTIONS.get(key);
        const cf = cfs.get(key);
        if (!seenFns.has(key)) {
          seenFns.add(key);
          check.functions.push({ name: n.name, kind: builtin ? 'built-in' : cf ? 'custom' : 'unknown' });
          if (!builtin && !cf) {
            check.problems.push(`There is no function named "${n.name}" (built-in or custom)${didYouMean(n.name, [...FUNCTION_NAMES, ...store.schema.customFunctions.map((c) => c.name)])}`);
          }
        }
        if (builtin && n.args.length < builtin.min) check.problems.push(`${n.name} needs at least ${builtin.min} parameters, got ${n.args.length}`);
        if (builtin && builtin.max !== undefined && n.args.length > builtin.max) check.problems.push(`${n.name} takes at most ${builtin.max} parameters, got ${n.args.length}`);
        if (!builtin && cf && n.args.length !== cf.parameters.length) check.problems.push(`${cf.name} takes ${cf.parameters.length} parameters, got ${n.args.length}`);
        if (key === 'while' && n.args[0]?.k === 'let') {
          // While's logic and result see the names its initial bindings define.
          const inner = new Set(scope);
          for (const [name] of n.args[0].binds) inner.add(lower(name.replace(/\[.*$/, '')));
          visit(n.args[0], scope);
          n.args.slice(1).forEach((a) => visit(a, inner));
        } else n.args.forEach((a) => visit(a, scope));
        break;
      }
      case 'let': {
        const inner = new Set(scope);
        for (const [name, b] of n.binds) {
          visit(b, inner);
          inner.add(lower(name.replace(/\[.*$/, '')));
        }
        visit(n.body, inner);
        break;
      }
      case 'unary': visit(n.a, scope); break;
      case 'bin': visit(n.a, scope); visit(n.b, scope); break;
    }
  };
  visit(node, bound);
  check.problems = [...new Set(check.problems)];
  check.ok = check.problems.length === 0;
  return check;
}

/** FileMaker's spelling of built-in function names, for suggestions (the function table keys are lower-case). */
const FUNCTION_NAMES = [
  'Abs', 'Average', 'Case', 'Ceiling', 'Char', 'Choose', 'Code', 'Count', 'Date', 'Day', 'DayName', 'DayOfWeek', 'DayOfYear', 'Evaluate',
  'Exact', 'Exp', 'Filter', 'FilterValues', 'Floor', 'GetAsDate', 'GetAsNumber', 'GetAsText', 'GetAsTime', 'GetAsTimestamp', 'GetField',
  'GetNthRecord', 'GetValue', 'Hour', 'If', 'Int', 'IsEmpty', 'IsValid', 'JSONDeleteElement', 'JSONFormatElements', 'JSONGetElement',
  'JSONListKeys', 'JSONListValues', 'JSONSetElement', 'Left', 'LeftValues', 'LeftWords', 'Length', 'Let', 'List', 'Lower', 'Max', 'Middle',
  'MiddleValues', 'MiddleWords', 'Min', 'Minute', 'Mod', 'Month', 'MonthName', 'PatternCount', 'Position', 'Proper', 'Quote', 'Random',
  'Replace', 'Right', 'RightValues', 'RightWords', 'Round', 'Seconds', 'Self', 'SerialIncrement', 'Sign', 'Sqrt', 'Substitute', 'Sum',
  'Time', 'Timestamp', 'Trim', 'TrimAll', 'Truncate', 'Upper', 'ValueCount', 'WeekOfYear', 'While', 'WordCount', 'Year', 'ExecuteSQL',
  'Get', 'GetContainerAttribute', 'Base64Decode', 'Base64Encode', 'Hash', 'CryptDigest', 'UniqueValues', 'SortValues', 'Lookup',
].filter((n) => FUNCTIONS.has(lower(n)));

/** " (did you mean X?)" when one candidate is close enough to be a typo. */
export function didYouMean(name: string, candidates: string[]): string {
  let best: string | undefined;
  let bestD = Infinity;
  const n = lower(name);
  for (const c of candidates) {
    const d = distance(n, lower(c));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && bestD <= Math.max(1, Math.floor(name.length / 4)) ? ` (did you mean "${best}"?)` : '';
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// --- overview --------------------------------------------------------------------

/**
 * A readable map of a solution: what each table holds and how it relates,
 * which layouts show it, how the scripts are organised and call each other,
 * which scripts buttons start, and which ones reach outside (mail, network).
 */
/** The file in outline. `counts: false` leaves out how many records each table has (the design only). */
export function solutionOverview(store: Store, opts: { counts?: boolean } = {}): string {
  const s = store.schema;
  const index = solutionIndex(store);
  const out: string[] = [];
  const counts = (t: Table) => {
    try {
      return Number(store.query(`SELECT count(*) AS n FROM ${q(t.name)}`)[0]?.n ?? 0);
    } catch {
      return 0;
    }
  };
  out.push(`# ${store.name}`);
  out.push(`Created with FileMaker ${s.header.creator}. ${s.tables.length} tables, ${s.tableOccurrences.length} table occurrences, ` +
    `${s.relationships.length} relationships, ${s.layouts.length} layouts, ${s.scripts.length} scripts, ` +
    `${s.valueLists.length} value lists, ${s.customFunctions.length} custom functions, ${s.accounts.length} accounts.`);
  // Other files: their tables (through table occurrences) or their scripts, and whether they are hosted here.
  const files = s.dataSources.filter((d) => d.name).map((d) => {
    const tos = s.tableOccurrences.filter((t) => t.dataSourceId === d.id).length;
    const hosted = dataSourceHosted(store, d.id);
    return `${d.name} (${tos ? `${tos} table occurrence${tos === 1 ? '' : 's'}` : 'no table occurrences; opened or its scripts performed'}${hosted ? '' : '; not hosted here, so its tables, fields and scripts can\'t be read'})`;
  });
  if (files.length) out.push(`Other files it uses: ${files.join(', ')}.`);

  out.push('', '## Tables');
  const layoutsByTable = new Map<string, string[]>();
  for (const l of store.layouts()) {
    if (!l.table) continue;
    const key = (l.file ? `${l.file}/` : '') + l.table;
    if (!layoutsByTable.has(key)) layoutsByTable.set(key, []);
    layoutsByTable.get(key)!.push(l.name);
  }
  for (const t of s.tables) {
    const kinds = { data: 0, calc: 0, summary: 0, global: 0 };
    for (const f of t.fields) {
      if (f.kind === 'calculation') kinds.calc++;
      else if (f.kind === 'summary') kinds.summary++;
      else if (f.options?.global) kinds.global++;
      else kinds.data++;
    }
    const key = t.fields.find((f) => f.options?.autoEnter?.serial || (f.options?.validation?.unique && /id\b|^id|key|serial|uuid/i.test(f.name)))?.name;
    const tos = s.tableOccurrences.filter((o) => !o.dataSourceId && o.baseTableId === t.id).map((o) => o.name);
    const layouts = layoutsByTable.get(t.name) ?? [];
    out.push(`- **${t.name}**: ${opts.counts === false ? '' : `${counts(t)} records; `}${kinds.data} data, ${kinds.calc} calculation, ${kinds.summary} summary, ${kinds.global} global fields` +
      (key ? `; key ${key}` : '') +
      (tos.length > 1 ? `; ${tos.length} occurrences` : '') +
      (layouts.length ? `; layouts: ${list(layouts, 8)}` : ''));
  }

  if (s.relationships.length) {
    out.push('', '## Relationships');
    const rels = index.sites.filter((x) => x.kind === 'relationship');
    for (const r of rels.slice(0, 40)) out.push(`- ${r.text}`);
    if (rels.length > 40) out.push(`- … and ${rels.length - 40} more (see where_used for one table occurrence)`);
  }

  if (s.scripts.length) {
    out.push('', '## Scripts');
    const entry = s.scripts.filter((x) => index.buttons.has(lower(x.name)));
    const started = s.scripts.filter((x) => index.starters.has(lower(x.name)));
    const top = s.scripts.filter((x) => !index.callers.has(lower(x.name)) && !index.buttons.has(lower(x.name)) && !index.starters.has(lower(x.name)) && x.steps.length);
    const outbound = s.scripts.filter((x) => index.outbound.has(lower(x.name)));
    const folders = folderSummary(s.scriptOrder);
    if (folders.length) out.push(`Folders: ${list([...new Set(folders)], 40)}.`);
    if (entry.length) out.push(`Started by buttons: ${list(entry.map((x) => `${x.name} (${list([...index.buttons.get(lower(x.name))!], 3)})`), 20)}.`);
    if (started.length) out.push(`Started by triggers, menus or File Options: ${list(started.map((x) => `${x.name} (${list([...index.starters.get(lower(x.name))!], 3)})`), 20)}.`);
    if (top.length) out.push(`Not called by other scripts, buttons, triggers, custom menus or File Options (run from the Scripts menu, by URL or another file, or unused): ${list(top.map((x) => x.name), 30)}.`);
    const hubs = [...index.callers].filter(([, c]) => c.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 10);
    if (hubs.length) out.push(`Most called: ${hubs.map(([n, c]) => `${s.scripts.find((x) => lower(x.name) === n)?.name ?? n} (${c.size} callers)`).join(', ')}.`);
    if (outbound.length) {
      out.push(`Reach outside the solution (mail, network, files, plug-ins; never run without checking): ` +
        list(outbound.map((x) => `${x.name} [${[...index.outbound.get(lower(x.name))!].join(', ')}]`), 40) + '.');
    }
  }

  if (s.customFunctions.length) {
    out.push('', '## Custom functions');
    for (const c of s.customFunctions.slice(0, 40)) {
      const uses = index.sites.filter((x) => x.refs.functions.has(lower(c.name))).length;
      out.push(`- ${c.name} ( ${c.parameters.join(' ; ')} ): used in ${uses} places`);
    }
  }
  const lists = s.valueLists.filter((v) => v.values?.length);
  if (lists.length) {
    out.push('', '## Value lists');
    for (const v of lists.slice(0, 30)) out.push(`- ${v.name}: ${list(v.values!, 10)}`);
  }
  const privilegeSets = store.privilegeSets(); // the file's own sets, plus any added or changed here (s.privilegeSets alone misses those)
  if (privilegeSets.length) {
    out.push('', '## Security');
    out.push('What each privilege set can do, said plainly (accounts using it, in parentheses):');
    const accounts = store.accounts();
    for (const p of privilegeSets) {
      const byAccount = accounts.filter((a) => a.privilegeSet === p.name).map((a) => a.name);
      const explained = store.accessExplained({ privilegeSet: p.name });
      out.push(`- ${p.name} (${byAccount.length ? list(byAccount, 10) : 'no accounts'}): ${explained.summary}`);
    }
  }
  return out.join('\n');
}

const list = (items: string[], max: number) => (items.length > max ? `${items.slice(0, max).join(', ')}, … (${items.length - max} more)` : items.join(', '));

function folderSummary(order: { name: string; kind: string }[]): string[] {
  return order.filter((o) => o.kind === 'folder' && o.name).map((o) => o.name);
}

/** One table, layout or script in detail, with what uses it. */
const DEFINITION_CHARS = 8000;

/** The file a table occurrence's table is in, when that file isn't hosted here. */
export function unhostedFileOf(store: Store, occurrence: string): string | undefined {
  const o = store.schema.tableOccurrences.find((t) => lower(t.name) === lower(occurrence));
  if (!o?.dataSourceId || dataSourceHosted(store, o.dataSourceId)) return undefined;
  return store.schema.dataSources.find((d) => d.id === o.dataSourceId)?.name ?? 'another file';
}

/** Whether the file a data source (External Data Sources entry) names is hosted alongside this one. */
export function dataSourceHosted(store: Store, id: number | undefined): boolean {
  const d = store.schema.dataSources.find((x) => x.id === id);
  return !!d && !!store.resolveFile(dataSourceFile(d.paths) ?? d.name);
}

/** How a field, custom function, value list or table occurrence is defined, for explain_solution's item view. */
function definition(store: Store, kind: string, name: string): string[] {
  const s = store.schema;
  const body = (text: string) => ['```', redactSecrets(clip(text, DEFINITION_CHARS)), '```'];
  if (kind === 'field') {
    const [table, field] = name.split('::');
    const f = s.tables.find((t) => t.name === table)?.fields.find((x) => x.name === field);
    if (!f) return [];
    const bits = [f.kind === 'normal' ? f.type : `${f.kind}, ${f.type}`];
    if (f.options?.global) bits.push('global');
    if (f.options?.unstored) bits.push('unstored');
    if (f.options?.repetitions && f.options.repetitions > 1) bits.push(`${f.options.repetitions} repetitions`);
    if (f.options?.autoEnter?.serial) bits.push('serial number');
    if (f.options?.autoEnter?.value) bits.push(`auto-enter ${f.options.autoEnter.value}`);
    if (f.options?.validation?.unique) bits.push('unique');
    if (f.options?.validation?.notEmpty) bits.push('required');
    if (f.summary) bits.push(`${f.summary.type} of ${f.summary.field}`);
    const out = [`${bits.join(', ')}.`];
    if (f.comment) out.push(`Comment: ${f.comment}`);
    if (f.calculation !== undefined) out.push(f.kind === 'calculation' ? 'Formula:' : 'Auto-enter calculation:', ...body(f.calculation));
    const v = f.options?.validation;
    if (v?.calculation) out.push('Validated by:', ...body(v.calculation));
    return out;
  }
  if (kind === 'customFunction') {
    const c = s.customFunctions.find((x) => x.name === name);
    return c ? [`${c.name} ( ${c.parameters.join(' ; ')} )`, ...(c.formula !== undefined ? body(c.formula) : [])] : [];
  }
  if (kind === 'valueList') {
    const v = s.valueLists.find((x) => x.name === name);
    if (!v) return [];
    if (v.values?.length) return [`Values: ${list(v.values, 60)}.`];
    if (v.field) {
      const cat = solutionIndex(store).catalog;
      const to = store.calc.occurrenceTable(v.field.occurrenceId);
      const fieldName = (id?: number) => (id === undefined ? undefined : to?.table.fields.find((x) => x.id === id)?.name ?? `field ${id}`);
      const occurrence = cat.toName.get(v.field.occurrenceId) ?? `occurrence ${v.field.occurrenceId}`;
      return [`Values from ${occurrence}::${fieldName(v.field.fieldId)}${v.field.secondFieldId !== undefined ? `, with ${occurrence}::${fieldName(v.field.secondFieldId)}${v.field.showSecondOnly ? ' shown instead' : ''}` : ''}` +
        `${v.field.relatedFromId !== undefined ? `, only those related from ${cat.toName.get(v.field.relatedFromId) ?? v.field.relatedFromId}` : ''}.`];
    }
    if (v.external) return [`Uses a value list of ${s.dataSources.find((d) => d.id === v.external!.dataSourceId)?.name ?? 'another file'}.`];
    return [];
  }
  if (kind === 'tableOccurrence') {
    const o = s.tableOccurrences.find((x) => x.name === name);
    if (!o) return [];
    if (o.dataSourceId) {
      const file = s.dataSources.find((d) => d.id === o.dataSourceId)?.name ?? 'another file';
      return [`An occurrence of a table in ${file}${dataSourceHosted(store, o.dataSourceId) ? '' : ', which is not hosted here, so its fields can\'t be named'}.`];
    }
    return [`An occurrence of table ${s.tables.find((t) => t.id === o.baseTableId)?.name ?? '?'}.`];
  }
  return [];
}

export function explainItem(store: Store, name: string): string {
  const s = store.schema;
  const index = solutionIndex(store);
  const targets = resolveTargets(store, name).filter((t) => t.kind !== 'tableOccurrence' || !resolveTargets(store, name, 'table').length);
  if (!targets.length) throw new Error(`Nothing named "${name}" in ${store.name}. Try search_solution.`);
  const out: string[] = [];
  for (const t of targets) {
    if (t.kind === 'table') {
      const table = s.tables.find((x) => x.name === t.name)!;
      out.push(`# Table ${table.name}`);
      for (const f of table.fields) {
        const bits = [f.kind === 'normal' ? f.type : `${f.kind}, ${f.type}`];
        if (f.options?.global) bits.push('global');
        if (f.options?.autoEnter?.serial) bits.push('serial number');
        if (f.options?.autoEnter?.value) bits.push(`auto-enter ${f.options.autoEnter.value}`);
        if (f.options?.validation?.unique) bits.push('unique');
        if (f.options?.validation?.notEmpty) bits.push('required');
        if (f.summary) bits.push(`${f.summary.type} of ${f.summary.field}`);
        out.push(`- ${f.name} (${bits.join(', ')})${f.calculation ? `: ${clip(f.calculation.replace(/\s+/g, ' '), 200)}` : ''}${f.comment ? ` — ${f.comment}` : ''}`);
      }
      const tos = s.tableOccurrences.filter((o) => !o.dataSourceId && o.baseTableId === table.id).map((o) => lower(o.name));
      const rels = index.sites.filter((x) => x.kind === 'relationship' && tos.some((o) => x.refs.occurrences.has(o)));
      if (rels.length) out.push('', 'Relationships:', ...rels.map((r) => `- ${r.text}`));
      const writers = new Set(index.sites.filter((x) => x.kind === 'script' && /^(Set Field|Insert|Replace Field Contents|New Record|Delete|Import|Truncate)/.test(x.text.replace(/^\/\/ /, '')) &&
        [...x.refs.fields].some((f) => lower(f).startsWith(`${lower(table.name)}::`))).map((x) => /^Script "(.*)", line/.exec(x.where)![1]));
      if (writers.size) out.push('', `Scripts that write to it: ${list([...writers], 30)}`);
    } else if (t.kind === 'layout') {
      const l = store.layouts().find((x) => x.name === t.name);
      out.push(`# Layout ${t.name}`, `Shows records of ${l?.table ?? '(no table)'}${l?.file ? ` in ${l.file}` : ''}.` +
        (l?.file && !store.resolveFile(l.file) ? ` ${l.file} is not hosted here, so its records and field names can't be read.` : ''));
      const objs = index.sites.filter((x) => x.kind === 'layout' && x.where.startsWith(`Layout "${t.name}"`) && !x.text.startsWith('shows records from'));
      for (const o of objs.slice(0, 120)) out.push(`- ${o.where.replace(/^Layout "[^"]*",? ?/, '')}${o.where.includes('object') ? ': ' : ''}${o.text}`);
    } else if (t.kind === 'script') {
      const script = s.scripts.find((x) => x.name === t.name)!;
      out.push(`# Script ${script.name}`);
      const calls = [...(index.calls.get(lower(script.name)) ?? [])];
      const callers = [...(index.callers.get(lower(script.name)) ?? [])];
      const buttons = [...(index.buttons.get(lower(script.name)) ?? [])];
      if (callers.length) out.push(`Called by: ${list(callers, 20)}.`);
      if (buttons.length) out.push(`Run by buttons on: ${list(buttons, 20)}.`);
      const starters = [...(index.starters.get(lower(script.name)) ?? [])];
      if (starters.length) out.push(`Started by: ${list(starters, 20)}.`);
      if (!callers.length && !buttons.length && !starters.length) out.push('Nothing in this file performs it: no script, button, trigger, custom menu, File Options or web viewer page found (it may run from the Scripts menu, a URL or another file).');
      if (calls.length) out.push(`Calls: ${list(calls.map((c) => s.scripts.find((x) => lower(x.name) === c)?.name ?? c), 20)}.`);
      const outbound = [...(index.outbound.get(lower(script.name)) ?? [])];
      if (outbound.length) out.push(`Reaches outside the solution: ${outbound.join(', ')}.`);
      out.push('', '```', redactSecrets(index.catalog.ext(scriptText(script.steps))), '```');
    } else {
      const used = whereUsed(store, t.name, t.kind)[0];
      out.push(`# ${t.kind} ${t.name}`, ...definition(store, t.kind, t.name), '');
      const shown = used.usages.slice(0, 50);
      out.push(used.count ? `Used in ${used.count} place${used.count === 1 ? '' : 's'}${used.count > shown.length ? ` (the first ${shown.length} here; where_used lists them all)` : ''}:` : 'Not used anywhere in this file.',
        ...shown.map((u) => `- ${u.where}: ${u.text}`));
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}
