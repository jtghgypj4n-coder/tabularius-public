// A census of what a file's layouts hold and what of it Tabularius can't draw or work out, per kind of
// object: fields whose table or field is gone, pictures and icons missing from the image library,
// popover buttons with no popover, charts whose setup wasn't read, layout formulas (hide, tooltips,
// conditional formatting, chart data, calculated text...) that don't check, merge fields that name
// nothing, and layouts on a table occurrence that no longer exists. Counts only: no field values, no
// formulas, no names of things in the file (function names aside, which are FileMaker's or a plug-in's),
// so it can run on files whose contents mustn't be printed.

import type { LayoutDesign, LayoutObject } from '../../fmp12/src/index.ts';
import { checkStoreFormula } from './check.ts';
import { layoutPerformance, SLOW, storeStats } from './layout-perf.ts';
import type { Store } from './store.ts';

export interface KindCensus {
  /** Objects of this kind. */
  count: number;
  /** What's wrong with how many of them. */
  issues: Record<string, number>;
}

export interface FormulaCensus {
  count: number;
  /** Formulas that don't check, by why. */
  failing: Record<string, number>;
}

export interface LayoutCensus {
  layouts: number;
  objects: Record<string, KindCensus>;
  parts: Record<string, KindCensus>;
  /** Layout formulas by where they are (hide, tooltip, condition, chart, calculated text, ...). */
  formulas: Record<string, FormulaCensus>;
  /** Functions formulas call that aren't FileMaker's or the file's (plug-ins, newer FileMaker), with how many formulas call each. */
  unknownFunctions: Record<string, number>;
  /** Whole layouts: can't open, no design read. */
  layoutIssues: Record<string, number>;
  /** Layouts using each print feature (sub-summaries, sliding, page numbers, ...), for print and PDF checks. */
  printing: Record<string, number>;
  /**
   * Check's speed findings (layout-perf.ts) estimated at SLOW record reads or
   * more per draw: layouts, objects by kind, the costliest layout (its slow
   * objects added up, as in `slowest`) and the costliest single object.
   */
  slow: { layouts: number; objects: Record<string, number>; worst: number; worstObject?: number; slowest?: SlowLayout[] };
  /** Layouts with something wrong or missing, or slow to draw: by layout id (not position), with the design name only when asked for. */
  byLayout?: LayoutCount[];
}

/** A slow layout: its id, its slow objects' estimates added up, and how many slow objects. */
export interface SlowLayout { layout: number; name?: string; cost: number; objects?: number }

/** One layout's counts: things wrong or missing (objects, parts, formulas that don't check, the layout itself) and slow objects. */
export interface LayoutCount { layout: number; name?: string; issues: number; slow: number; cost: number }

const add = (bag: Record<string, number>, key: string, n = 1) => { bag[key] = (bag[key] ?? 0) + n; };

/** Why a formula doesn't check, in words that carry nothing from the formula itself. */
function why(message: string): { reason: string; fn?: string } {
  const fn = /The function "([^"]+)" cannot be found/.exec(message);
  if (fn) return { reason: 'calls a function Tabularius lacks', fn: fn[1] };
  if (/deleted|cannot be found/.test(message)) return { reason: 'names a field or table that is gone' };
  if (/parameters/i.test(message)) return { reason: 'wrong number of parameters' };
  return { reason: 'does not parse' };
}

/**
 * `steps`: the script steps buttons can run here (scripts' SERVER_STEPS and SCREEN_STEPS); left out, buttons' steps aren't counted.
 * `names`: put layout names in `slowest` and `byLayout` (the file's own words, so off by default).
 */
export function layoutCensus(store: Store, opts: { steps?: ReadonlySet<number>; names?: boolean } = {}): LayoutCensus {
  const out: LayoutCensus = { layouts: 0, objects: {}, parts: {}, formulas: {}, unknownFunctions: {}, layoutIssues: {}, printing: {}, slow: { layouts: 0, objects: {}, worst: 0 } };
  const stats = storeStats(store);
  const images = new Set(store.images().map((i) => i.id));
  const schema = store.schema;
  const themes = new Map(store.designs().themes.map((t) => [t.id, new Set(t.styles.map((x) => x.name))]));
  const kind = (k: string) => (out.objects[k] ??= { count: 0, issues: {} });
  // Things found wrong on the layout being counted.
  let here = 0;
  const issue = (o: LayoutObject | string, what: string) => {
    here++;
    add(kind(typeof o === 'string' ? o : o.kind).issues, what);
  };
  const fieldOf = (toId: number | undefined, fieldId: number | undefined, name?: string) => {
    const t = toId === undefined ? undefined : store.calc.occurrenceTable(toId);
    if (!t) return { table: false, field: false };
    return { table: true, field: t.table.fields.some((f) => f.id === fieldId || (fieldId === undefined && f.name === name)) };
  };
  const formula = (where: string, text: string | undefined, toId: number | undefined) => {
    if (!text?.trim()) return;
    const f = (out.formulas[where] ??= { count: 0, failing: {} });
    f.count++;
    // Markers the reader leaves for what it couldn't decode.
    if (/⟨fn:[0-9a-f]+⟩|⟨field:/i.test(text)) {
      here++;
      add(f.failing, 'holds a function or field the reader could not name');
      return;
    }
    // FileMaker shows the same: a plug-in or custom function the file no longer has.
    if (text.includes('<Function Missing>')) {
      here++;
      add(f.failing, 'calls a function the file itself has lost (<Function Missing>)');
      return;
    }
    const r = checkStoreFormula(store, text, { occurrence: toId });
    if (r.ok) return;
    here++;
    const w = why(r.message);
    add(f.failing, w.reason);
    if (w.fn) add(out.unknownFunctions, w.fn);
  };

  const named = (l: { id: number; name: string }) => (opts.names ? { name: l.name } : {});
  const count = (l: { id: number; name: string }, slow: number, cost: number) => {
    if (here || slow) (out.byLayout ??= []).push({ layout: l.id, ...named(l), issues: here, slow, cost });
  };
  for (const l of schema.layouts) {
    out.layouts++;
    here = 0;
    const d: LayoutDesign | undefined = store.design(l.id);
    if (!d) {
      add(out.layoutIssues, 'no design read');
      here++;
      count(l, 0, 0);
      continue;
    }
    const toId = d.tableOccurrenceId ?? l.tableOccurrenceId;
    if (toId === undefined || !schema.tableOccurrences.some((t) => t.id === toId)) {
      add(out.layoutIssues, 'its table occurrence is gone (FileMaker shows <Table Missing>; Tabularius can\'t open it)');
      here++;
    }
    for (const p of d.parts) {
      const pc = (out.parts[p.kind] ??= { count: 0, issues: {} });
      pc.count++;
      const bad = (what: string) => {
        here++;
        add(pc.issues, what);
      };
      if (p.kind === 'unknown') bad(`part type ${p.kindId}`);
      if (p.kind.startsWith('sub-summary') && !p.breakField) bad('no "when sorted by" field read');
      if (p.breakField && !fieldOf(p.breakField.tableOccurrenceId, p.breakField.fieldId, p.breakField.field).field) bad('"when sorted by" field is gone');
    }
    const popovers = new Set<number>();
    const uses = new Set<string>();
    const find = (objs: LayoutObject[]) => {
      for (const o of objs) {
        if (o.kind === 'popover') popovers.add(o.id);
        if (o.sliding) uses.add('sliding objects');
        if (o.hideWhenPrinting) uses.add('objects hidden when printing');
        if (o.text && /\{\{(PageNumber|1015)\}\}/i.test(o.text)) uses.add('page numbers ({{PageNumber}})');
        if (o.children) find(o.children);
      }
    };
    find(d.objects);
    if (d.parts.some((p) => p.kind.startsWith('sub-summary'))) uses.add('sub-summary parts');
    if (d.parts.some((p) => p.kind.endsWith('grand-summary'))) uses.add('grand summary parts');
    if (d.parts.some((p) => p.kind === 'title-header' || p.kind === 'title-footer')) uses.add('title header or footer');
    if (d.parts.some((p) => p.options?.pageBreakBefore || p.options?.pageBreakEvery)) uses.add('part page breaks');
    if (d.parts.some((p) => p.options?.restartPageNumbers)) uses.add('page numbers that start again');
    for (const u of uses) add(out.printing, u);
    const slow = layoutPerformance(d, schema, stats).filter((i) => (i.cost ?? 0) >= SLOW);
    const cost = Math.round(slow.reduce((n, i) => n + (i.cost ?? 0), 0));
    if (slow.length) {
      out.slow.layouts++;
      // By layout id (not position: ids run past the number of layouts), for matching against what the server measured.
      (out.slow.slowest ??= []).push({ layout: l.id, ...named(l), cost, objects: slow.length });
      out.slow.worst = Math.max(out.slow.worst, cost);
    }
    for (const i of slow) {
      add(out.slow.objects, i.kind);
      out.slow.worstObject = Math.max(out.slow.worstObject ?? 0, Math.round(i.cost ?? 0));
    }
    const walk = (objs: LayoutObject[], context: number | undefined) => {
      for (const o of objs) {
        kind(o.kind).count++;
        if (o.kind === 'unknown') issue(o, `object type ${o.type}`);
        if (o.field) {
          const f = fieldOf(o.field.tableOccurrenceId, o.field.fieldId, o.field.field);
          if (!f.table) issue(o, 'its table occurrence is gone (<Table Missing>)');
          else if (!f.field) issue(o, 'its field is gone (<Field Missing>)');
          if (o.field.valueListId !== undefined && !schema.valueLists.some((v) => v.id === o.field!.valueListId)) issue(o, 'its value list is gone');
          if (['popup', 'dropdown', 'checkbox', 'radio'].includes(o.field.display) && o.field.valueListId === undefined) issue(o, `shown as ${o.field.display} with no value list`);
        }
        if (o.kind === 'graphic' && (o.imageId === undefined || !images.has(o.imageId))) issue(o, o.imageId === undefined ? 'no picture read' : 'its picture is not in the image library');
        if (o.icon && !images.has(o.icon.imageId)) issue(o, 'its icon is not in the image library');
        if (o.kind === 'popover-button' && !(o.target !== undefined && popovers.has(o.target))) issue(o, 'no popover');
        if ((o.kind === 'tab-control' || o.kind === 'slide-control') && !o.children?.some((c) => c.kind === 'tab-panel' || c.kind === 'slide-panel')) issue(o, 'no panels');
        if (o.kind === 'chart' && !o.chart) issue(o, 'chart setup not read');
        if (o.kind === 'web-viewer' && !o.webUrl) issue(o, 'no address (blank until a script sets one)');
        if (o.kind === 'portal' && o.portal && !schema.tableOccurrences.some((t) => t.id === o.portal!.tableOccurrenceId)) issue(o, 'its table occurrence is gone');
        // A single-step button (not Perform Script, which runs whatever the script does).
        if (o.action && opts.steps && o.action.stepId !== 1 && !opts.steps.has(o.action.stepId)) issue(o, 'runs a script step Tabularius lacks');
        const styles = d.themeId === undefined ? undefined : themes.get(d.themeId);
        if (o.style.name && styles && !styles.has(o.style.name)) issue(o, 'its named style is not in the theme');
        // Merge fields: <<TO::Field>>, <<Field>> (the layout's table), <<$$variable>>, <<ƒ:formula>>.
        for (const m of (o.text ?? '').matchAll(/<<(ƒ:[\s\S]*?|[^<>]+)>>/g)) {
          const name = m[1];
          if (name.startsWith('ƒ:')) {
            formula('calculated text', name.slice(2), context);
            continue;
          }
          if (/^\$/.test(name)) continue;
          if (name.startsWith('⟨field:')) {
            issue('text', 'merge field the reader could not name');
            continue;
          }
          const at = name.indexOf('::');
          const to = at < 0 ? schema.tableOccurrences.find((t) => t.id === context) : schema.tableOccurrences.find((t) => t.name === name.slice(0, at));
          const field = at < 0 ? name : name.slice(at + 2);
          if (!to || !fieldOf(to.id, undefined, field.replace(/\[\d+\]$/, '')).field) issue('text', 'merge field names nothing');
        }
        formula('hide', o.hide?.formula, context);
        formula('tooltip', o.tooltip, context);
        formula('placeholder', o.placeholder, context);
        formula('button bar label', o.label, context);
        formula('active segment', o.activeSegmentFormula, context);
        formula('web viewer address', o.webUrl, context);
        for (const c of o.conditions ?? []) formula('conditional formatting', c.formula, context);
        if (o.portal?.filter) formula('portal filter', o.portal.filter, o.portal.tableOccurrenceId);
        if (o.chart) {
          const c = o.chart;
          const chartTo = c.source === 'related' ? schema.tableOccurrences.find((t) => t.name === c.occurrence)?.id ?? context : context;
          for (const t of [c.title, c.xTitle, c.yTitle, c.categories, c.yMin, c.yMax]) formula('chart', t, chartTo);
          for (const s of c.series) for (const t of [s.data, s.name, s.x, s.sizes]) formula('chart', t, chartTo);
        }
        for (const t of o.triggers ?? []) formula('script trigger parameter', t.parameter, context);
        formula('button script parameter', o.action?.parameter, context);
        if (o.children) walk(o.children, o.portal ? o.portal.tableOccurrenceId : context);
      }
    };
    walk(d.objects, toId);
    count(l, slow.length, cost);
  }
  return out;
}

const thousands = (n: number) => Math.round(n).toLocaleString('en-US');
const layoutName = (x: { layout: number; name?: string }) => `layout id ${x.layout}${x.name !== undefined ? ` "${x.name}"` : ''}`;

/** The census as lines of text, worst first; counts only. */
export function censusText(c: LayoutCensus, title: string): string {
  const lines: string[] = [];
  const objects = Object.values(c.objects).reduce((n, k) => n + k.count, 0);
  lines.push(`${title}: ${c.layouts} layouts, ${objects} objects`);
  for (const [k, n] of Object.entries(c.layoutIssues)) lines.push(`  ${n} layout${n === 1 ? '' : 's'}: ${k}`);
  const rows = Object.entries(c.objects).sort((a, b) => b[1].count - a[1].count);
  for (const [k, v] of rows) {
    const bad = Object.entries(v.issues).sort((a, b) => b[1] - a[1]);
    lines.push(`  ${k}: ${v.count}${bad.length ? '' : ', nothing found wrong'}`);
    for (const [what, n] of bad) lines.push(`    ${n} ${what}`);
  }
  const parts = Object.entries(c.parts).sort((a, b) => b[1].count - a[1].count);
  if (parts.length) lines.push(`  parts: ${parts.map(([k, v]) => `${v.count} ${k}`).join(', ')}`);
  for (const [k, v] of parts) for (const [what, n] of Object.entries(v.issues)) lines.push(`    ${n} ${k}: ${what}`);
  const formulas = Object.entries(c.formulas).sort((a, b) => b[1].count - a[1].count);
  if (formulas.length) lines.push('  layout formulas:');
  for (const [k, v] of formulas) {
    const failing = Object.values(v.failing).reduce((n, x) => n + x, 0);
    lines.push(`    ${k}: ${v.count}${failing ? `, ${failing} don't check (${Object.entries(v.failing).map(([w, n]) => `${n} ${w}`).join('; ')})` : ''}`);
  }
  const printing = Object.entries(c.printing ?? {}).sort((a, b) => b[1] - a[1]);
  if (printing.length) lines.push(`  printing: ${printing.map(([k, n]) => `${n} with ${k}`).join(', ')}`);
  if (c.slow?.layouts) {
    lines.push(`  slow to draw: ${c.slow.layouts} layout${c.slow.layouts === 1 ? '' : 's'} with objects estimated at ${thousands(SLOW)}+ record reads each draw (${Object.entries(c.slow.objects).map(([k, n]) => `${n} ${k}`).join(', ')})`);
    lines.push(`    costliest layout about ${thousands(c.slow.worst)} reads per draw (its slow objects added up)${c.slow.worstObject ? `; costliest single object about ${thousands(c.slow.worstObject)}` : ''}`);
  }
  const slowest = [...c.slow?.slowest ?? []].sort((a, b) => b.cost - a.cost).slice(0, 15);
  if (slowest.length) {
    lines.push(`    slowest ${slowest.length} (layout ids, not positions):`);
    for (const x of slowest) lines.push(`      ${layoutName(x)}: about ${thousands(x.cost)} reads, ${x.objects ?? '?'} slow object${x.objects === 1 ? '' : 's'}`);
  }
  const wrong = [...c.byLayout ?? []].filter((x) => x.issues).sort((a, b) => b.issues - a.issues || a.layout - b.layout);
  if (wrong.length) {
    lines.push(`  layouts with something wrong or missing: ${wrong.length}`);
    for (const x of wrong.slice(0, 25)) lines.push(`    ${layoutName(x)}: ${x.issues}${x.slow ? `, and ${x.slow} slow object${x.slow === 1 ? '' : 's'}` : ''}`);
    if (wrong.length > 25) lines.push(`    and ${wrong.length - 25} more (all in --json)`);
  }
  const fns = Object.entries(c.unknownFunctions).sort((a, b) => b[1] - a[1]);
  if (fns.length) lines.push(`  functions Tabularius lacks: ${fns.map(([f, n]) => `${f} (${n})`).join(', ')}`);
  return lines.join('\n');
}

/** Adds one file's census into a running total. */
export function addCensus(total: LayoutCensus, c: LayoutCensus): LayoutCensus {
  total.layouts += c.layouts;
  for (const [k, v] of Object.entries(c.objects)) {
    const t = (total.objects[k] ??= { count: 0, issues: {} });
    t.count += v.count;
    for (const [w, n] of Object.entries(v.issues)) add(t.issues, w, n);
  }
  for (const [k, v] of Object.entries(c.parts)) {
    const t = (total.parts[k] ??= { count: 0, issues: {} });
    t.count += v.count;
    for (const [w, n] of Object.entries(v.issues)) add(t.issues, w, n);
  }
  for (const [k, v] of Object.entries(c.formulas)) {
    const t = (total.formulas[k] ??= { count: 0, failing: {} });
    t.count += v.count;
    for (const [w, n] of Object.entries(v.failing)) add(t.failing, w, n);
  }
  for (const [k, n] of Object.entries(c.unknownFunctions)) add(total.unknownFunctions, k, n);
  for (const [k, n] of Object.entries(c.layoutIssues)) add(total.layoutIssues, k, n);
  for (const [k, n] of Object.entries(c.printing)) add((total.printing ??= {}), k, n);
  total.slow ??= { layouts: 0, objects: {}, worst: 0 };
  total.slow.layouts += c.slow.layouts;
  for (const [k, n] of Object.entries(c.slow.objects)) add(total.slow.objects, k, n);
  total.slow.worst = Math.max(total.slow.worst, c.slow.worst);
  if (c.slow.worstObject) total.slow.worstObject = Math.max(total.slow.worstObject ?? 0, c.slow.worstObject);
  return total;
}
