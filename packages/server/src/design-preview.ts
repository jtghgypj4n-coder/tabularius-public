// What a batch of design changes will do, in words a person can check before applying it, and the
// changes that take it back afterwards. Used for the assistant's proposals ("make me a simple CRM")
// and by design mode's change endpoint, which returns the undo with what it applied.

import { checkTokens, draftArranged, draftLayout, phoneFingerprint, fixLayout, lintLayout, relatedOccurrences, restyleLayout, tokenTheme, type ArrangedObject, type ArrangedSpec, type DesignOp, type LintIssue, type Store } from '../../store/src/index.ts';
import type { Field, LayoutDesign, OrderedItem, Schema, TableOccurrence, Theme } from '../../fmp12/src/index.ts';

/** One entry of the Layouts or Scripts list: an item, a folder of entries, or a separator. */
type OrderSpec = Extract<DesignOp, { op: 'setOrder' }>['order'][number];

export interface DesignPreview {
  /** One line per thing added, changed or deleted, in the order a person would check them. */
  lines: string[];
  /** Layouts the changes make or change, as they would be (for a picture), with Check's findings on them. */
  layouts?: PreviewLayout[];
}

export interface PreviewLayout {
  id: number;
  name: string;
  design: LayoutDesign;
  /** The layout as it is now, when the changes change one that exists. */
  before?: LayoutDesign;
  issues: LintIssue[];
}

/** More than this many layouts, or designs this big, are described in words only. */
const MAX_LAYOUTS = 4;
const MAX_DESIGN = 300_000;

/** The changes as they would apply to this file, described. Throws (like checkDesign) when they would not apply. */
export function previewDesign(store: Store, changes: DesignOp[]): DesignPreview {
  const { schema, designs } = store.checkDesign(changes);
  const lines = describeDiff(store.schema, schema);
  const was = new Map(store.designs().layouts.map((d) => [d.id, d]));
  const layouts: PreviewLayout[] = [];
  for (const d of designs.layouts) {
    const before = was.get(d.id);
    if (before && JSON.stringify(before) === JSON.stringify(d)) continue;
    if (layouts.length === MAX_LAYOUTS || JSON.stringify(d).length > MAX_DESIGN) return { lines };
    layouts.push({ id: d.id, name: d.name, design: d, ...(before ? { before } : {}), issues: lintLayout(d, schema, store.privilegeSets()) });
  }
  return { lines, ...(layouts.length ? { layouts } : {}) };
}

const byId = <T extends { id: number }>(list: T[] | undefined) => new Map((list ?? []).map((x) => [x.id, x]));

function fieldText(f: Field): string {
  const bits: string[] = [f.kind === 'calculation' ? `calculation, ${f.type} result` : f.kind === 'summary' ? 'summary' : f.type];
  const o = f.options;
  if (o?.global) bits.push('global');
  if (o?.autoEnter?.serial) bits.push('serial number');
  if (o?.autoEnter?.value) bits.push(`auto-enter ${o.autoEnter.value.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
  if (o?.autoEnter?.calculation && f.kind !== 'calculation') bits.push('auto-enter calculation');
  if (o?.autoEnter?.data !== undefined) bits.push(`auto-enter "${o.autoEnter.data}"`);
  if (o?.repetitions && o.repetitions > 1) bits.push(`${o.repetitions} repetitions`);
  return `${f.name} (${bits.join(', ')})`;
}

const list = (items: string[], max = 12) => (items.length > max ? `${items.slice(0, max).join(', ')}, and ${items.length - max} more` : items.join(', '));

/** Before and after, compared by id: tables and fields, occurrences, relationships, value lists, layouts, scripts, custom functions. */
export function describeDiff(before: Schema, after: Schema): string[] {
  const out: string[] = [];
  const tablesBefore = byId(before.tables);
  const tablesAfter = byId(after.tables);
  const newTables = new Set<number>();
  for (const t of after.tables) {
    const old = tablesBefore.get(t.id);
    if (!old) {
      newTables.add(t.id);
      out.push(`New table ${t.name}${t.fields.length ? `: ${list(t.fields.map(fieldText))}` : ' (no fields yet)'}`);
      continue;
    }
    if (old.name !== t.name) out.push(`Rename table ${old.name} to ${t.name}`);
    const fieldsBefore = byId(old.fields);
    for (const f of t.fields) {
      const was = fieldsBefore.get(f.id);
      if (!was) out.push(`New field ${t.name}::${fieldText(f)}`);
      else {
        if (was.name !== f.name) out.push(`Rename field ${t.name}::${was.name} to ${f.name}`);
        if (was.type !== f.type || was.kind !== f.kind || was.calculation !== f.calculation || JSON.stringify(was.options) !== JSON.stringify(f.options)) {
          out.push(`Change field ${t.name}::${fieldText(f)}`);
        }
      }
    }
    const kept = new Set(t.fields.map((f) => f.id));
    for (const f of old.fields) if (!kept.has(f.id)) out.push(`Delete field ${t.name}::${f.name} (its data is kept and can be restored)`);
  }
  for (const t of before.tables) if (!tablesAfter.has(t.id)) out.push(`Delete table ${t.name} (its records are kept and can be restored)`);

  const tableName = (id: number | undefined) => (id === undefined ? '?' : tablesAfter.get(id)?.name ?? tablesBefore.get(id)?.name ?? '?');
  const tosBefore = byId(before.tableOccurrences);
  const tosAfter = byId(after.tableOccurrences);
  for (const to of after.tableOccurrences) {
    const old = tosBefore.get(to.id);
    // A new table's own occurrence (named after it) goes without saying.
    if (!old && !(to.baseTableId !== undefined && newTables.has(to.baseTableId) && to.name.startsWith(tableName(to.baseTableId)))) {
      out.push(`New table occurrence ${to.name}${to.dataSourceId ? '' : ` of ${tableName(to.baseTableId)}`}`);
    } else if (old && old.name !== to.name) out.push(`Rename table occurrence ${old.name} to ${to.name}`);
  }
  for (const to of before.tableOccurrences) if (!tosAfter.has(to.id)) out.push(`Delete table occurrence ${to.name}`);

  const toName = (id: number) => tosAfter.get(id)?.name ?? tosBefore.get(id)?.name ?? `occurrence ${id}`;
  const fieldName = (toId: number, fieldId: number) => {
    const base = tosAfter.get(toId)?.baseTableId ?? tosBefore.get(toId)?.baseTableId;
    const t = base === undefined ? undefined : tablesAfter.get(base) ?? tablesBefore.get(base);
    return t?.fields.find((f) => f.id === fieldId)?.name ?? `field ${fieldId}`;
  };
  const relText = (r: Schema['relationships'][number]) => {
    const l = toName(r.leftTableOccurrenceId);
    const rt = toName(r.rightTableOccurrenceId);
    const preds = r.predicates.map((p) => `${l}::${fieldName(r.leftTableOccurrenceId, p.leftFieldId)} ${p.operator} ${rt}::${fieldName(r.rightTableOccurrenceId, p.rightFieldId)}`).join(' and ');
    const opts = [
      r.rightCreate ? `create ${rt} records from ${l}` : '', r.leftCreate ? `create ${l} records from ${rt}` : '',
      r.rightDelete ? `delete ${rt} records with their ${l} record` : '', r.leftDelete ? `delete ${l} records with their ${rt} record` : '',
    ].filter(Boolean);
    return `${preds || `${l} × ${rt}`}${opts.length ? ` (${opts.join('; ')})` : ''}`;
  };
  const relsBefore = byId(before.relationships);
  const relsAfter = byId(after.relationships);
  for (const r of after.relationships) {
    const old = relsBefore.get(r.id);
    if (!old) out.push(`New relationship ${relText(r)}`);
    else if (relText(old) !== relText(r)) out.push(`Change relationship ${relText(old)} to ${relText(r)}`);
  }
  for (const r of before.relationships) if (!relsAfter.has(r.id)) out.push(`Delete relationship ${relText(r)}`);

  catalog(out, 'value list', before.valueLists, after.valueLists, (v) => v.values?.length ? `: ${list(v.values, 10)}` : v.field ? `: values from ${toName(v.field.occurrenceId)}::${fieldName(v.field.occurrenceId, v.field.fieldId)}` : '',
    (a, b) => JSON.stringify([a.values, a.field]) !== JSON.stringify([b.values, b.field]));
  catalog(out, 'layout', before.layouts, after.layouts, (l) => (l.tableOccurrenceId !== undefined ? ` showing records from ${toName(l.tableOccurrenceId)}` : ''),
    (a, b) => a.tableOccurrenceId !== b.tableOccurrenceId);
  catalog(out, 'script', before.scripts, after.scripts, (s) => ` (${s.steps.length} step${s.steps.length === 1 ? '' : 's'})`,
    (a, b) => JSON.stringify(a.steps) !== JSON.stringify(b.steps));
  // A changed script's steps, as a diff: "- " steps that go, "+ " steps that come, under its "Change script" line.
  const scriptsBefore = byId(before.scripts);
  for (const s of after.scripts ?? []) {
    const was = scriptsBefore.get(s.id);
    if (!was || JSON.stringify(was.steps) === JSON.stringify(s.steps)) continue;
    const at = out.findIndex((l) => l.startsWith(`Change script ${s.name} (`));
    if (at >= 0) out.splice(at + 1, 0, ...stepDiff(was.steps.map(stepText), s.steps.map(stepText)));
  }
  catalog(out, 'custom function', before.customFunctions, after.customFunctions, (c) => ` (${c.parameters.join('; ')})`,
    (a, b) => a.formula !== b.formula || a.parameters.join() !== b.parameters.join());
  return out;
}

const stepText = (st: { line?: string; name: string; enabled: boolean }) => `${st.enabled ? '' : '// '}${(st.line ?? st.name).replace(/\s+/g, ' ')}`;

/** The steps that changed between two versions of a script, with a step of context either side, at most 40 lines. */
export function stepDiff(a: string[], b: string[], max = 40): string[] {
  // Longest common subsequence, then walk it.
  const n = a.length;
  const m = b.length;
  if (n * m > 250_000) return [`  (${n} steps before, ${m} after: too long to compare step by step)`];
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops: { k: ' ' | '-' | '+'; line: string; n: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ k: ' ', line: a[i], n: j + 1 }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] > L[i + 1][j])) { ops.push({ k: '+', line: b[j], n: j + 1 }); j++; }
    else { ops.push({ k: '-', line: a[i], n: i + 1 }); i++; }
  }
  // Changed steps, and unchanged ones next to a change.
  const changed = (x: number) => ops[x] !== undefined && ops[x].k !== ' ';
  const keep = ops.map((_, x) => changed(x) || changed(x - 1) || changed(x + 1));
  const lines: string[] = [];
  let gap = false;
  ops.forEach((o, x) => {
    if (!keep[x]) {
      gap = true;
      return;
    }
    if (gap && lines.length) lines.push('  …');
    gap = false;
    lines.push(`${o.k === ' ' ? ' ' : o.k} ${o.k === '-' ? '' : `${o.n}. `}${o.line.slice(0, 200)}`);
  });
  return lines.length > max ? [...lines.slice(0, max), `  … and ${lines.length - max} more lines`] : lines;
}

function catalog<T extends { id: number; name: string }>(out: string[], what: string, before: T[] | undefined, after: T[] | undefined, detail: (x: T) => string, changed: (a: T, b: T) => boolean): void {
  const was = byId(before);
  const now = byId(after);
  for (const x of after ?? []) {
    const old = was.get(x.id);
    if (!old) out.push(`New ${what} ${x.name}${detail(x)}`);
    else {
      if (old.name !== x.name) out.push(`Rename ${what} ${old.name} to ${x.name}`);
      if (changed(old, x)) out.push(`Change ${what} ${x.name}${detail(x)}`);
    }
  }
  for (const x of before ?? []) if (!now.has(x.id)) out.push(`Delete ${what} ${x.name}`);
}

/**
 * The changes that take applied changes back, newest first: what they created is deleted (a deleted table's
 * or field's data goes to the deleted items, where it can still be restored). Undefined when a change can't be
 * taken back this way (a rename, an edit, a delete): Design history and the deleted items have those.
 */
/**
 * The layouts changes will redesign, as they are now (by id), so undoChanges can put them back:
 * updateLayout's design, and the layout a component is made from.
 */
export function layoutsBefore(store: Store, changes: DesignOp[]): Map<number, LayoutDesign> {
  const out = new Map<number, LayoutDesign>();
  for (const op of changes) {
    const ref = op.op === 'updateLayout' && op.design ? op.layout : op.op === 'createComponent' ? op.layout : undefined;
    const design = ref === undefined ? undefined : store.design(ref);
    if (design && !out.has(design.id)) out.set(design.id, JSON.parse(JSON.stringify(design)) as LayoutDesign);
  }
  // Phone layouts made from those are rebuilt along with them (an updateLayout of their own in what's applied).
  for (const d of store.designs().layouts) {
    if (d.phone && out.has(d.phone.of) && !out.has(d.id)) out.set(d.id, JSON.parse(JSON.stringify(d)) as LayoutDesign);
  }
  return out;
}

/** The Layouts or Scripts list as it is now, as the tree setOrder takes (folders, separators and items by id). */
export function orderTree(order: OrderedItem[], items: { id: number }[]): OrderSpec[] {
  const root: OrderSpec[] = [];
  const stack: { depth: number; children: OrderSpec[] }[] = [{ depth: -1, children: root }];
  const seen = new Set<number>();
  for (const o of order) {
    if (o.kind === 'folder-end') continue;
    while (stack.length > 1 && stack[stack.length - 1].depth >= o.depth) stack.pop();
    const into = stack[stack.length - 1].children;
    if (o.kind === 'folder') {
      const f: OrderSpec = { folder: o.name, id: o.id, children: [] };
      into.push(f);
      stack.push({ depth: o.depth, children: f.children });
    } else if (o.kind === 'separator') into.push({ separator: true, id: o.id });
    else if (items.some((i) => i.id === o.id) && !seen.has(o.id)) { seen.add(o.id); into.push({ item: o.id }); }
  }
  for (const i of items) if (!seen.has(i.id)) root.push({ item: i.id });
  return root;
}

/** The lists changes will reorder (setOrder), as they are now, so undoChanges can put them back. */
export function ordersBefore(store: Store, changes: DesignOp[]): Partial<Record<'layouts' | 'scripts', OrderSpec[]>> {
  const out: Partial<Record<'layouts' | 'scripts', OrderSpec[]>> = {};
  for (const op of changes) {
    if (op.op !== 'setOrder' || out[op.list]) continue;
    out[op.list] = op.list === 'layouts' ? orderTree(store.schema.layoutOrder, store.schema.layouts) : orderTree(store.schema.scriptOrder, store.schema.scripts);
  }
  return out;
}

export function undoChanges(applied: DesignOp[], before?: Map<number, LayoutDesign>, orders?: Partial<Record<'layouts' | 'scripts', OrderSpec[]>>): DesignOp[] | undefined {
  const undo: DesignOp[] = [];
  for (const op of [...applied].reverse()) {
    const id = (op as { id?: number }).id;
    switch (op.op) {
      case 'createTable':
        if (op.layoutId !== undefined) undo.push({ op: 'deleteLayout', layout: op.layoutId });
        undo.push({ op: 'deleteTable', table: id! });
        break;
      case 'createField': undo.push({ op: 'deleteField', table: op.table, field: id! }); break;
      case 'createOccurrence': undo.push({ op: 'deleteOccurrence', occurrence: id! }); break;
      case 'createRelationship': undo.push({ op: 'deleteRelationship', relationship: id! }); break;
      case 'createValueList': undo.push({ op: 'deleteValueList', valueList: id! }); break;
      case 'createCustomFunction': undo.push({ op: 'deleteCustomFunction', customFunction: id! }); break;
      case 'createLayout': undo.push({ op: 'deleteLayout', layout: id! }); break;
      case 'createComponent': undo.push({ op: 'deleteComponent', component: id! }); break;
      case 'createScript': undo.push({ op: 'deleteScript', script: id! }); break;
      case 'createTheme': undo.push({ op: 'deleteTheme', theme: id! }); break;
      // A list put in order again: back to the order it had, before what the change made is deleted.
      case 'setOrder': {
        const was = orders?.[op.list];
        if (!was) return undefined;
        undo.push({ op: 'setOrder', list: op.list, order: was });
        continue;
      }
      case 'updateLayout': {
        // A redesign (not a rename or a new table occurrence) of a layout whose design was kept beforehand.
        const was = typeof op.layout === 'number' ? before?.get(op.layout) : undefined;
        if (!was || op.name !== undefined || op.occurrence !== undefined || op.includeInMenu !== undefined) return undefined;
        const { id: _id, name: _name, tableOccurrenceId: _to, ...design } = was;
        // A setting the change added that the layout didn't have (a theme, say) is taken away again.
        const cleared = Object.fromEntries(Object.keys(op.design ?? {}).filter((k) => !(k in was)).map((k) => [k, null]));
        undo.push({ op: 'updateLayout', layout: op.layout, design: { ...cleared, ...design } } as DesignOp);
        continue;
      }
      default: return undefined;
    }
    if (op.op !== 'createTable' && id === undefined) return undefined;
  }
  return undo;
}

/**
 * The updateLayout change that restyles a layout (store/restyle.ts): like another layout, onto a theme
 * (by name or id), and/or with local formatting dropped. Layouts by name or id.
 */
export function restyleChange(store: Store, req: { layout?: unknown; like?: unknown; theme?: unknown; consistent?: unknown }): { change: DesignOp; notes: string[]; layout: string } {
  const ref = (x: unknown) => (typeof x === 'number' || typeof x === 'string' ? x : undefined);
  const target = ref(req.layout) !== undefined ? store.design(ref(req.layout)!) : undefined;
  if (!target) throw new Error(`No layout "${String(req.layout)}"`);
  const like = req.like === undefined ? undefined : ref(req.like) !== undefined ? store.design(ref(req.like)!) : undefined;
  if (req.like !== undefined && !like) throw new Error(`No layout "${String(req.like)}" to take the look from`);
  const themes = store.designs().themes;
  const theme = req.theme === undefined ? undefined
    : themes.find((t) => t.id === req.theme || (typeof req.theme === 'string' && t.name.toLowerCase() === req.theme.toLowerCase()));
  if (req.theme !== undefined && !theme) throw new Error(`No theme "${String(req.theme)}"; themes: ${themes.map((t) => t.name).join(', ')}`);
  if (!like && !theme && req.consistent !== true) throw new Error('Say which layout to look like, which theme to use, or consistent: true');
  const { design, notes } = restyleLayout(store.designs(), target, { like, themeId: theme?.id, consistent: req.consistent === true });
  return { change: { op: 'updateLayout', layout: target.id, design } as DesignOp, notes, layout: target.name };
}

export interface FileRestyle {
  /** The changes: a new theme (from tokens), then an updateLayout per layout that changes. */
  changes: DesignOp[];
  /** Each layout that changes: before and after, and what changed. */
  layouts: { id: number; name: string; before: LayoutDesign; after: LayoutDesign; notes: string[]; changed: number; /** What Check finds (errors and warnings), before and after. */ issues?: { before: number; after: number } }[];
  /** Layouts left as they were, and why. */
  unchanged: { id: number; name: string; why: string }[];
  theme: string;
  /** The theme in full as it will be saved (a new one from tokens isn't in the file yet), to draw the after pictures. */
  themeContent?: Theme;
}

/**
 * Every layout in the file on one theme (not in FileMaker, which restyles a layout at a time): an existing theme,
 * or a new one made from design tokens (store/token-theme.ts; the product's own by default). `layouts` limits it to
 * those; `consistent` also drops local formatting. Phone layouts that follow their desktop layout follow it here too.
 */
const phoneFollowing = (d: LayoutDesign) => !!d.phone && phoneFingerprint(d) === d.phone.synced;

export function restyleFileChange(store: Store, req: { theme?: unknown; tokens?: unknown; name?: unknown; consistent?: unknown; layouts?: unknown }): FileRestyle {
  const designs = store.designs();
  const changes: DesignOp[] = [];
  let themeId: number;
  let themeName: string;
  if (req.tokens !== undefined) {
    if (!req.tokens || typeof req.tokens !== 'object' || Array.isArray(req.tokens)) throw new Error('tokens is an object: {accent, accentText, text, muted, background, panel, line, font, size, radius}');
    const tokens = checkTokens(req.tokens as Record<string, unknown>);
    const taken = new Set(designs.themes.map((t) => t.name.toLowerCase()));
    let name = typeof req.name === 'string' && req.name.trim() ? req.name.trim() : 'House';
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${typeof req.name === 'string' && req.name.trim() ? req.name.trim() : 'House'} ${i}`;
    // The theme's id is pinned now, so each layout can switch to it; applying gives it the same id.
    const checked = store.checkDesign([{ op: 'createTheme', name, content: tokenTheme(tokens) } as DesignOp]);
    changes.push(...checked.applied);
    const made = checked.designs.themes.find((t) => t.name === name)!;
    themeId = made.id;
    themeName = name;
  } else {
    const theme = designs.themes.find((t) => t.id === req.theme || (typeof req.theme === 'string' && t.name.toLowerCase() === req.theme.toLowerCase()));
    if (!theme) throw new Error(`No theme "${String(req.theme)}"; themes: ${designs.themes.map((t) => t.name).join(', ') || 'none'}. Or send tokens for a new one.`);
    themeId = theme.id;
    themeName = theme.name;
  }
  const after = changes.length ? store.checkDesign(changes).designs : designs;
  const wanted = Array.isArray(req.layouts) ? new Set(req.layouts.filter((x): x is number => Number.isInteger(x))) : undefined;
  // A phone layout that follows its desktop layout is rebuilt from it when that changes; it only takes the theme here
  // (restyling its objects too would count as editing it by hand, and it would stop following).
  const follows = (d: (typeof designs.layouts)[number]) => !!d.phone && phoneFollowing(d) && designs.layouts.some((x) => x.id === d.phone!.of);
  const out: FileRestyle = { changes, layouts: [], unchanged: [], theme: themeName };
  const phones: DesignOp[] = [];
  for (const d of designs.layouts) {
    if (follows(d)) {
      const desktop = designs.layouts.find((x) => x.id === d.phone!.of)!;
      if (wanted && !wanted.has(desktop.id)) continue;
      if (d.themeId !== themeId) phones.push({ op: 'updateLayout', layout: d.id, design: { themeId } } as DesignOp);
      out.unchanged.push({ id: d.id, name: d.name, why: `follows ${desktop.name}, so it is restyled with it` });
      continue;
    }
    if (wanted && !wanted.has(d.id)) continue;
    const r = restyleLayout(after, d, { themeId, consistent: req.consistent === true });
    if (JSON.stringify({ ...d, ...r.design }) === JSON.stringify(d)) {
      out.unchanged.push({ id: d.id, name: d.name, why: `already on ${themeName}` });
      continue;
    }
    changes.push({ op: 'updateLayout', layout: d.id, design: r.design } as DesignOp);
    out.layouts.push({ id: d.id, name: d.name, before: d, after: { ...d, ...r.design }, notes: r.notes, changed: r.changed.length });
  }
  changes.push(...phones);
  if (!out.layouts.length && !phones.length) throw new Error(`Every layout is already on ${themeName}`);
  // After as it will be saved (phone layouts rebuilt and all), with what Check finds on it.
  const final = store.checkDesign(changes);
  const privileges = store.privilegeSets();
  out.themeContent = final.designs.themes.find((t) => t.id === themeId);
  for (const l of out.layouts) {
    l.after = final.designs.layouts.find((x) => x.id === l.id) ?? l.after;
    const count = (d: LayoutDesign, schema: typeof final.schema) => lintLayout(d, schema, privileges).filter((i) => i.severity !== 'info').length;
    l.issues = { before: count(l.before, store.schema), after: count(l.after, final.schema) };
  }
  return out;
}

export interface LayoutRequest {
  name?: unknown;
  occurrence?: unknown;
  view?: unknown;
  fields?: unknown;
  totals?: unknown;
  like?: unknown;
  find?: unknown;
  omit?: unknown;
  sort?: unknown;
  /** Form only: [{occurrence, fields, rows?, totals?: [column names]}], portals of related records (line items) with column totals under them. */
  portals?: unknown;
  /** Laid out as a picture shows it: {width, parts: [{kind, height}], objects: [{kind, part, left, top, width, height, field?, text?, portal?}]}. */
  arrangement?: unknown;
  /** List only, a report: fields to group by, outermost first; a date field as {field, by: "month" | "quarter" | "year"}. */
  groups?: unknown;
  /** The groups' totals only, no row per record. */
  summaryOnly?: unknown;
  /** A chart of the found set: {type: "column" | "bar" | "line" | "area" | "pie", value: a number or summary field, by?: a group (default the first), title?}. */
  chart?: unknown;
}

const ARRANGED_KINDS = ['field', 'label', 'title', 'button', 'portal', 'rectangle', 'line'];
const ARRANGED_PARTS = ['header', 'body', 'trailing-grand-summary', 'footer'];
/** Most objects a picture's arrangement may have. */
const MAX_ARRANGED = 300;
/** Most columns a picture's portal may have. */
const MAX_COLUMNS = 20;

/** A picture's arrangement checked against the file: real fields of the layout's occurrence or related ones, related portals. */
function arrangement(store: Store, schema: Schema, to: TableOccurrence, raw: unknown): { width: number; parts: ArrangedSpec['parts']; objects: ArrangedObject[] } {
  const a = raw as { width?: unknown; parts?: unknown; objects?: unknown };
  if (!a || typeof a !== 'object' || !Array.isArray(a.parts) || !Array.isArray(a.objects)) throw new Error('arrangement is {width, parts: [{kind, height}], objects: [...]}');
  if (a.objects.length > MAX_ARRANGED) throw new Error(`An arrangement has at most ${MAX_ARRANGED} objects`);
  const num = (v: unknown, what: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} must be a number of points`);
    return v;
  };
  const lower = (x: unknown) => String(x).toLowerCase();
  const reachable = relatedOccurrences(schema, to.id);
  const occurrenceOf = (name: string) => schema.tableOccurrences.find((t) => lower(t.name) === lower(name));
  const tableOf = (t: TableOccurrence) => (t.dataSourceId ? undefined : schema.tables.find((x) => x.id === t.baseTableId));
  const related = () => schema.tableOccurrences.filter((t) => t.id !== to.id && reachable.has(t.id) && tableOf(t)).map((t) => t.name).join(', ') || 'none';
  const fieldRef = (n: unknown): { occurrence: number; field: number } => {
    if (typeof n !== 'string' || !n.trim()) throw new Error('A field object names its field ("Field", or "Occurrence::Field" for a related one)');
    const at = n.indexOf('::');
    const occ = at < 0 ? to : occurrenceOf(n.slice(0, at).trim());
    if (!occ || !tableOf(occ)) throw new Error(`No table occurrence "${n.slice(0, at)}" of a table in this file`);
    if (occ.id !== to.id && !reachable.has(occ.id)) throw new Error(`${occ.name} isn't related to ${to.name}, so ${n} would show nothing; related occurrences: ${related()}`);
    const t = tableOf(occ)!;
    const f = t.fields.find((x) => lower(x.name) === lower(at < 0 ? n.trim() : n.slice(at + 2).trim()));
    if (!f) throw new Error(`${occ.name} has no field "${n}"; its fields: ${t.fields.map((x) => x.name).join(', ')}`);
    return { occurrence: occ.id, field: f.id };
  };
  const parts = (a.parts as { kind?: unknown; height?: unknown }[]).map((p, i) => {
    if (!ARRANGED_PARTS.includes(String(p?.kind))) throw new Error(`Part ${i}'s kind is one of ${ARRANGED_PARTS.join(', ')}`);
    return { kind: p.kind as ArrangedSpec['parts'][number]['kind'], height: num(p.height, `Part ${i}'s height`) };
  });
  const objects = (a.objects as Record<string, unknown>[]).map((o, i): ArrangedObject => {
    const kind = String(o?.kind);
    if (!ARRANGED_KINDS.includes(kind)) throw new Error(`Object ${i}'s kind is one of ${ARRANGED_KINDS.join(', ')}`);
    const part = num(o.part, `Object ${i}'s part`);
    if (!Number.isInteger(part) || part < 0 || part >= parts.length) throw new Error(`Object ${i}'s part is an index into parts (0 to ${parts.length - 1})`);
    const out: ArrangedObject = { kind: kind as ArrangedObject['kind'], part, left: num(o.left, `Object ${i}'s left`), top: num(o.top, `Object ${i}'s top`), width: num(o.width, `Object ${i}'s width`), height: num(o.height, `Object ${i}'s height`) };
    if (kind === 'field') out.field = fieldRef(o.field);
    if (typeof o.text === 'string') out.text = o.text.slice(0, 500);
    if (kind === 'portal') {
      const p = o.portal as { occurrence?: unknown; fields?: unknown; rows?: unknown } | undefined;
      const occ = typeof p?.occurrence === 'string' ? occurrenceOf(p.occurrence) : undefined;
      if (!occ || !tableOf(occ)) throw new Error(`Object ${i} is a portal: give its portal.occurrence, a related occurrence (${related()})`);
      if (occ.id === to.id || !reachable.has(occ.id)) throw new Error(`${occ.name} isn't related to ${to.name}, so a portal of it would show nothing; related occurrences: ${related()}`);
      const names = Array.isArray(p!.fields) ? p!.fields.filter((x): x is string => typeof x === 'string') : [];
      if (!names.length) throw new Error(`The portal of ${occ.name} needs its fields, as columns`);
      if (names.length > MAX_COLUMNS) throw new Error(`A portal has at most ${MAX_COLUMNS} columns`);
      for (const n of names) {
        const prefix = /^(.*)::/.exec(n)?.[1];
        if (prefix !== undefined && lower(prefix) !== lower(occ.name)) throw new Error(`"${n}" isn't a field of ${occ.name}, the portal's occurrence`);
      }
      out.portal = { occurrence: occ.id, fields: names.map((n) => fieldRef(`${occ.name}::${n.replace(/^.*::/, '')}`).field), ...(typeof p!.rows === 'number' ? { rows: p!.rows } : {}) };
    }
    return out;
  });
  return { width: num(a.width, 'The arrangement\'s width'), parts, objects };
}

const PERIODS: Record<string, { label: string; type: 'text' | 'number'; formula: (f: string) => string }> = {
  month: { label: 'Month', type: 'text', formula: (f) => `Year ( ${f} ) & "-" & Right ( "0" & Month ( ${f} ) ; 2 )` },
  quarter: { label: 'Quarter', type: 'text', formula: (f) => `Year ( ${f} ) & " Q" & Ceiling ( Month ( ${f} ) / 3 )` },
  year: { label: 'Year', type: 'number', formula: (f) => `Year ( ${f} )` },
};

/**
 * The changes that make a new layout drafted to match the file (store/layout-draft.ts): its theme, styles and
 * components. Totals of number fields add the summary fields they need ("Total Amount"); a find (and sort) adds
 * a "Show <layout>" script that goes there and finds those records. Names are matched ignoring case.
 */
const RULE_NAMES: Partial<Record<LintIssue['rule'], string>> = {
  misaligned: 'lined up edges', overlap: 'moved objects off each other', outside: 'moved objects inside the layout', 'tab-order': 'tab order',
  unlabeled: 'labels', 'small-target': 'tap sizes', 'slow-sort': 'automatic indexing', 'color-only': 'bold for colour-only formatting',
};

export function draftLayoutChange(store: Store, req: LayoutRequest): { changes: DesignOp[]; notes: string[]; layout: string } {
  const name = typeof req.name === 'string' ? req.name.trim() : '';
  if (!name) throw new Error('Give the layout a name');
  const schema = store.schema;
  const lower = (x: unknown) => String(x).toLowerCase();
  const to = schema.tableOccurrences.find((t) => t.id === req.occurrence || lower(t.name) === lower(req.occurrence));
  const table = to && !to.dataSourceId ? schema.tables.find((t) => t.id === to.baseTableId) : undefined;
  if (!to || !table) throw new Error(`No table occurrence "${String(req.occurrence)}" of a table in this file; occurrences: ${schema.tableOccurrences.filter((t) => !t.dataSourceId).map((t) => t.name).join(', ')}`);
  const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
  const fieldOf = (n: string): Field => {
    const f = table.fields.find((x) => lower(x.name) === lower(n.replace(/^.*::/, '')));
    if (!f) throw new Error(`${table.name} has no field "${n}"; its fields: ${table.fields.map((x) => x.name).join(', ')}`);
    return f;
  };
  const view = req.view === 'form' ? 'form' : 'list';
  const like = req.like === undefined ? undefined : typeof req.like === 'string' || typeof req.like === 'number' ? store.design(req.like) : undefined;
  if (req.like !== undefined && !like) throw new Error(`No layout "${String(req.like)}" to take the look from`);

  // Totals: summary fields as they are; a number field's existing total, else a new summary field for it.
  const changes: DesignOp[] = [];
  const totalNames: string[] = [];
  const names = new Set(table.fields.map((f) => lower(f.name)));
  // A picture's arrangement replaces fields, totals and portals: nothing is made for them.
  const arranged = req.arrangement !== undefined;
  const totalOf = (n: string): string => {
    const f = fieldOf(n);
    if (f.kind === 'summary') return f.name;
    if (f.type !== 'number') throw new Error(`Only number fields can be totalled; ${f.name} is ${f.type}`);
    const existing = table.fields.find((x) => x.kind === 'summary' && x.summary?.type === 'total' && x.summary.fieldId === f.id);
    if (existing) return existing.name;
    const made = changes.find((c) => (c as { summary?: { field?: number } }).summary?.field === f.id) as { name: string } | undefined;
    if (made) return made.name;
    let total = `Total ${f.name}`;
    for (let i = 2; names.has(lower(total)); i++) total = `Total ${f.name} ${i}`;
    names.add(lower(total));
    changes.push({ op: 'createField', table: table.id, name: total, kind: 'summary', type: 'number', summary: { type: 'total', field: f.id } } as DesignOp);
    return total;
  };
  for (const n of arranged ? [] : list(req.totals)) if (!totalNames.includes(totalOf(n))) totalNames.push(totalOf(n));
  // A report's groups: fields as they are, a date by month, quarter or year through a calculation (made once, or the file's own).
  if (req.groups !== undefined && !Array.isArray(req.groups)) throw new Error('groups is a list: field names, or {field, by: "month" | "quarter" | "year"} for a date');
  const groupNames: string[] = [];
  for (const g of (req.groups ?? []) as unknown[]) {
    const spec = typeof g === 'string' ? { field: g } : g && typeof g === 'object' ? g as { field?: unknown; by?: unknown } : {};
    const f = fieldOf(String(spec.field ?? ''));
    if (spec.by === undefined) { groupNames.push(f.name); continue; }
    const period = PERIODS[String(spec.by)];
    if (!period) throw new Error(`Group dates by month, quarter or year, not "${String(spec.by)}"`);
    if (f.type !== 'date' && f.type !== 'timestamp') throw new Error(`Only a date or timestamp can be grouped by ${String(spec.by)}; ${f.name} is ${f.type}`);
    const formula = period.formula(f.name);
    const key = formula.replace(/\s+/g, '').toLowerCase();
    const existing = table.fields.find((x) => x.kind === 'calculation' && x.calculation?.replace(/\s+/g, '').toLowerCase() === key)
      ?? changes.map((c) => c as { name: string; calculation?: string }).find((c) => c.calculation?.replace(/\s+/g, '').toLowerCase() === key);
    if (existing) { groupNames.push(existing.name); continue; }
    let name = `${f.name} ${period.label}`;
    for (let i = 2; names.has(lower(name)); i++) name = `${f.name} ${period.label} ${i}`;
    names.add(lower(name));
    changes.push({ op: 'createField', table: table.id, name, kind: 'calculation', type: period.type, calculation: formula } as DesignOp);
    groupNames.push(name);
  }
  if (view !== 'list' && (groupNames.length || req.chart !== undefined || req.summaryOnly === true)) throw new Error('Groups, summary-only reports and charts go on a list layout');
  if (req.summaryOnly === true && !groupNames.length) throw new Error('A summary-only report needs groups');
  // The chart: one point per value of a group, sized by a total (shown in the report too).
  let chart: { type: 'column' | 'bar' | 'line' | 'area' | 'pie'; by: string; value: string; title?: string } | undefined;
  if (req.chart !== undefined) {
    const c = (req.chart && typeof req.chart === 'object' ? req.chart : {}) as { type?: unknown; value?: unknown; by?: unknown; title?: unknown };
    const type = String(c.type ?? 'column');
    if (!['column', 'bar', 'line', 'area', 'pie'].includes(type)) throw new Error('A chart is a column, bar, line, area or pie chart');
    if (!groupNames.length) throw new Error('A chart needs groups: it shows one point per group');
    const by = c.by === undefined ? groupNames[0] : groupNames.find((g) => lower(g) === lower(c.by) || lower(g).startsWith(lower(c.by) + ' '));
    if (!by) throw new Error(`A chart's "by" is one of the groups: ${groupNames.join(', ')}`);
    const value = totalOf(String(c.value ?? ''));
    if (!totalNames.includes(value)) totalNames.push(value);
    chart = { type: type as 'column', by, value, ...(typeof c.title === 'string' && c.title.trim() ? { title: c.title.trim() } : {}) };
  }
  // Portals: related occurrences only; a column total is a calculation on this table summing it ("Total Amount" = Sum ( Items::Amount )).
  const portals: { to: typeof to; fields: Field[]; rows?: number; totals: { name: string; under: Field }[] }[] = [];
  const reachable = relatedOccurrences(schema, to.id);
  if (req.portals !== undefined && !Array.isArray(req.portals)) throw new Error('portals is a list: [{occurrence, fields, rows, totals}]');
  // A calculation is worked out from its context: the layout's occurrence, which the portal's is related to (the table's first occurrence may not be).
  const defaultTo = schema.tableOccurrences.find((t) => !t.dataSourceId && t.baseTableId === table.id)?.id;
  const sums = new Map<string, string>();
  for (const raw of (arranged ? [] : req.portals ?? []) as Record<string, unknown>[]) {
    const rto = schema.tableOccurrences.find((t) => t.id === raw?.occurrence || lower(t.name) === lower(raw?.occurrence));
    const rtable = rto && !rto.dataSourceId ? schema.tables.find((t) => t.id === rto.baseTableId) : undefined;
    if (!rto || !rtable) throw new Error(`No table occurrence "${String(raw?.occurrence)}" of a table in this file for the portal`);
    if (rto.id === to.id || !reachable.has(rto.id)) throw new Error(`${rto.name} isn't related to ${to.name}, so a portal of it would show nothing; related occurrences: ${schema.tableOccurrences.filter((t) => t.id !== to.id && reachable.has(t.id)).map((t) => t.name).join(', ') || 'none'}`);
    const rField = (n: string) => {
      const prefix = /^(.*)::/.exec(n)?.[1];
      if (prefix !== undefined && lower(prefix) !== lower(rto.name)) throw new Error(`"${n}" isn't a field of ${rto.name}, the portal's occurrence`);
      const f = rtable.fields.find((x) => lower(x.name) === lower(n.replace(/^.*::/, '')));
      if (!f) throw new Error(`${rtable.name} has no field "${n}"; its fields: ${rtable.fields.map((x) => x.name).join(', ')}`);
      return f;
    };
    const cols = list(raw.fields).map(rField);
    const fields = cols.length ? cols : rtable.fields.filter((f) => f.type !== 'container' && !f.options?.global && f.kind !== 'summary').slice(0, 5);
    const totals = [...new Set(list(raw.totals).map(rField))].map((under) => {
      if (under.type !== 'number') throw new Error(`Only number fields can be totalled; ${under.name} is ${under.type}`);
      // A total goes under its column, so the column is shown.
      if (!fields.includes(under)) fields.push(under);
      const formula = `Sum ( ${rto.name}::${under.name} )`;
      const key = formula.replace(/\s+/g, '').toLowerCase();
      const made = sums.get(key);
      if (made) return { name: made, under };
      const existing = table.fields.find((x) => x.kind === 'calculation' && x.calculation?.replace(/\s+/g, '').toLowerCase() === key && (x.calculationContextId ?? defaultTo) === to.id);
      if (existing) return { name: existing.name, under };
      let total = `Total ${under.name}`;
      for (let i = 2; names.has(lower(total)); i++) total = `Total ${under.name} ${i}`;
      names.add(lower(total));
      sums.set(key, total);
      changes.push({ op: 'createField', table: table.id, name: total, kind: 'calculation', type: 'number', calculation: formula, options: { unstored: true }, ...(to.id !== defaultTo ? { calculationContext: to.id } : {}) } as DesignOp);
      return { name: total, under };
    });
    portals.push({ to: rto, fields, rows: typeof raw.rows === 'number' ? raw.rows : undefined, totals });
  }

  // The new summary fields get their ids now, so the layout can show them; applying gives them the same ids.
  let drafted = schema;
  if (changes.length) {
    const checked = store.checkDesign(changes);
    drafted = checked.schema;
    changes.splice(0, changes.length, ...checked.applied);
  }
  const draftTable = drafted.tables.find((t) => t.id === table.id)!;
  const idOf = (n: string) => draftTable.fields.find((f) => lower(f.name) === lower(n.replace(/^.*::/, '')))!.id;
  const fields = list(req.fields).map((n) => fieldOf(n).id);
  const portalSpecs = portals.map((p) => ({ occurrence: p.to!.id, fields: p.fields.map((f) => f.id), ...(p.rows !== undefined ? { rows: p.rows } : {}), totals: p.totals.map((t) => ({ field: idOf(t.name), under: t.under.id })) }));
  // From a picture: where it shows things; otherwise laid out the file's way.
  const drafted0 = arranged
    ? draftArranged(drafted, store.designs(), { title: name, occurrence: to.id, view, ...(like ? { like } : {}), ...arrangement(store, drafted, to, req.arrangement) })
    : draftLayout(drafted, store.designs(), {
      title: name, occurrence: to.id, view, fields, totals: totalNames.map(idOf), ...(like ? { like } : {}), ...(portalSpecs.length ? { portals: portalSpecs } : {}),
      ...(groupNames.length ? { groups: groupNames.map(idOf) } : {}), ...(req.summaryOnly === true ? { summaryOnly: true } : {}),
      ...(chart ? { chart: { type: chart.type, category: idOf(chart.by), value: idOf(chart.value), ...(chart.title ? { title: chart.title } : {}) } } : {}),
    });
  const notes = drafted0.notes;
  const newFields = changes.map((c) => c as { op: string; name: string; kind?: string });
  if (newFields.length) notes.push(`New field${newFields.length > 1 ? 's' : ''}: ${newFields.map((c) => `${c.name} (${c.kind === 'summary' ? 'summary' : 'calculation'})`).join(', ')}.`);
  if (newFields.length && groupNames.length) notes.push('New calculations are worked out for every record when applied, which takes a moment on a big table.');
  // Check's mechanical fixes on the draft, so it's shown already tidy.
  const whole = { id: 0, name, tableOccurrenceId: to.id, style: {}, parts: [], objects: [], ...drafted0.design } as LayoutDesign;
  const fix = fixLayout(whole, drafted, store.privilegeSets());
  const design = fix.fixed.length ? { ...drafted0.design, objects: fix.design.objects, parts: fix.design.parts, ...(fix.design.tabOrder ? { tabOrder: fix.design.tabOrder } : {}) } : drafted0.design;
  // Check may move an object off another to below the last part: that part grows to hold it.
  const lastPart = [...(design.parts ?? [])].sort((a, b) => a.top - b.top).at(-1);
  const lowest = Math.max(0, ...(design.objects ?? []).map((o) => o.bounds.bottom));
  if (lastPart && lowest > lastPart.top + lastPart.height) design.parts = design.parts!.map((p) => (p === lastPart ? { ...p, height: lowest - p.top + 4 } : p));
  changes.push(...fix.changes, { op: 'createLayout', name, occurrence: to.id, design } as DesignOp);
  if (fix.fixed.length) notes.push(`Check fixed ${fix.fixed.length === 1 ? 'one thing' : `${fix.fixed.length} things`} on the draft: ${[...new Set(fix.fixed.map((i) => RULE_NAMES[i.rule] ?? i.rule))].join(', ')}.`);

  // A find: a script that goes to the layout and finds those records (and sorts them).
  const find = req.find && typeof req.find === 'object' ? Object.entries(req.find as Record<string, unknown>).filter(([, v]) => typeof v === 'string' || typeof v === 'number') : [];
  // A report sorts by its groups first, or they don't show.
  const sort = [...groupNames.map((n) => ({ name: n })), ...list(req.sort).map(fieldOf).filter((f) => !groupNames.some((g) => lower(g) === lower(f.name)))];
  if (find.length || sort.length) {
    const quote = (v: unknown) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const steps = [`Go to Layout [ ${quote(name)} ]`];
    if (find.length) {
      steps.push('Enter Find Mode [ Pause: Off ]');
      for (const [k, v] of find) steps.push(`Set Field [ ${to.name}::${fieldOf(k).name} ; ${quote(v)} ]`);
      if (req.omit === true) steps.push('Omit Record');
      steps.push('Set Error Capture [ On ]', 'Perform Find [ ]', 'Set Error Capture [ Off ]');
    }
    if (sort.length) steps.push(`Sort Records [ Restore; ${sort.map((f) => `${to.name}::${f.name}; ascending`).join('; ')} ; With dialog: Off ]`);
    let script = `Show ${name}`;
    for (let i = 2; store.schema.scripts.some((s) => lower(s.name) === lower(script)); i++) script = `Show ${name} ${i}`;
    changes.push({ op: 'createScript', name: script, text: steps.join('\n') } as DesignOp);
    notes.push(`A "${script}" script goes to the layout and ${find.length ? `finds the records where ${find.map(([k, v]) => `${fieldOf(k).name} is ${req.omit === true ? 'not ' : ''}${v}`).join(' and ')}` : 'shows every record'}${sort.length ? `, sorted by ${sort.map((f) => f.name).join(', ')}` : ''}. ${find.length ? 'A layout doesn\'t keep a find, so run it (or make a button for it) to see just those.' : 'Run it (or make a button for it) to see them in that order.'}`);
  }
  return { changes, notes, layout: name };
}
