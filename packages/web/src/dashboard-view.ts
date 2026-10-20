// A dashboard's widgets on the page: charts, summary tables and big numbers, with the find and grouping each
// uses in words, and an editor for them. Used by the dashboards page and the assistant panel (a dashboard it
// proposes is shown the same way, with a Save button).

import { h } from './design/dom.ts';
import { renderChart } from './chart.ts';

export type WidgetKind = 'chart' | 'table' | 'number';
export type ChartType = 'column' | 'bar' | 'line' | 'pie';
export type Measure = 'count' | 'sum' | 'average' | 'min' | 'max' | 'distinct';
export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface Widget {
  title: string;
  kind: WidgetKind;
  chart?: ChartType;
  layout: string;
  query?: Record<string, string | number | boolean>[];
  groupBy?: string[];
  by?: Period;
  measure?: { field: string; fn: Measure };
  top?: { field: string; n: number };
  limit?: number;
}

export interface WidgetData {
  title: string;
  kind: WidgetKind;
  chart?: ChartType;
  layout: string;
  find: string[];
  grouping: string;
  foundCount?: number;
  value?: number | string | null;
  categories?: string[];
  series?: { name: string; values: (number | null)[] }[];
  xTitle?: string;
  yTitle?: string;
  columns?: string[];
  rows?: (string | number | null)[][];
  top?: { field: string; values: string[] };
  groupCount?: number;
  error?: string;
}

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export const formatValue = (v: unknown) => (typeof v === 'number' ? NUMBER.format(v) : v === null || v === undefined ? '–' : String(v));

/** One widget's numbers, as a card. */
export function renderWidget(d: WidgetData, size: { width: number; height: number } = { width: 460, height: 260 }): HTMLElement {
  const card = h('figure', { class: `dash-widget dash-kind-${d.kind}` }, h('figcaption', { class: 'dash-title' }, d.title));
  const body = h('div', { class: 'dash-body' });
  if (d.error) body.append(h('p', { class: 'dash-error' }, d.error));
  else if (d.kind === 'number') {
    body.append(h('div', { class: 'dash-number' }, formatValue(d.value)), h('div', { class: 'dash-note' }, `${formatValue(d.foundCount)} record${d.foundCount === 1 ? '' : 's'}`));
  } else if (d.kind === 'table') {
    const table = h('table', { class: 'dash-table' },
      h('thead', {}, h('tr', {}, ...(d.columns ?? []).map((c) => h('th', {}, c)))),
      h('tbody', {}, ...(d.rows ?? []).map((r) => h('tr', {}, ...r.map((v) => h('td', { class: typeof v === 'number' ? 'num' : '' }, formatValue(v)))))));
    body.append(d.rows?.length ? h('div', { class: 'dash-scroll' }, table) : h('p', { class: 'dash-note' }, 'No records match'));
  } else if (!d.categories?.length) {
    body.append(h('p', { class: 'dash-note' }, 'No records match'));
  } else {
    try {
      body.append(renderChart({ type: d.chart ?? 'column', source: 'found-set', title: '', xTitle: d.xTitle ?? '', yTitle: d.yTitle ?? '', series: (d.series ?? []).map(() => ({ data: '' })) },
        { xTitle: d.xTitle, yTitle: d.yTitle, categories: d.categories, series: d.series ?? [] }, size.width, size.height));
    } catch {
      body.append(h('p', { class: 'dash-error' }, 'Couldn\'t draw this chart'));
    }
  }
  card.append(body);
  const notes = [
    `${d.layout}${d.foundCount !== undefined && d.kind !== 'number' ? ` · ${formatValue(d.foundCount)} records` : ''}${d.groupCount ? ` · ${d.categories?.length ?? d.rows?.length} of ${d.groupCount} groups` : ''}`,
    ...d.find, d.grouping,
    ...(d.top ? [`Top ${d.top.values.length} ${d.top.field}: ${d.top.values.join(', ')}`] : []),
  ];
  card.append(h('details', { class: 'dash-how' }, h('summary', {}, 'How this is worked out'), ...notes.map((n) => h('div', {}, n))));
  return card;
}

const PERIODS: Period[] = ['day', 'week', 'month', 'quarter', 'year'];
const MEASURES: Measure[] = ['count', 'sum', 'average', 'min', 'max', 'distinct'];

function input(value: string, label: string, onInput: (v: string) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const el = h('input', { type: 'text', 'aria-label': label, ...attrs }) as HTMLInputElement;
  el.value = value;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

function choose(options: [string, string][], value: string, label: string, onChange: (v: string) => void): HTMLSelectElement {
  const el = h('select', { 'aria-label': label }) as HTMLSelectElement;
  for (const [v, l] of options) el.append(h('option', { value: v }, l));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

const row = (label: string, ...kids: HTMLElement[]) => h('label', { class: 'dash-edit-row' }, h('span', {}, label), ...kids);

/**
 * An editor for a widget's find and grouping. It changes the widget in place and calls onChange, so the
 * caller can work it out again (preview) and save it.
 */
export function widgetEditor(w: Widget, onChange: () => void): HTMLElement {
  const box = h('div', { class: 'dash-edit' });
  const draw = () => {
    box.replaceChildren(
      row('Title', input(w.title, 'Title', (v) => (w.title = v, onChange()))),
      row('Show as', choose([['chart', 'Chart'], ['table', 'Table'], ['number', 'Number']], w.kind, 'Show as', (v) => {
        w.kind = v as WidgetKind;
        if (w.kind === 'chart') w.chart ??= 'column';
        else delete w.chart;
        onChange();
        draw();
      }), ...(w.kind === 'chart' ? [choose([['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie']], w.chart ?? 'column', 'Chart type', (v) => (w.chart = v as ChartType, onChange()))] : [])),
      row('Layout', input(w.layout, 'Layout', (v) => (w.layout = v, onChange()))),
    );
    // The find: one box per criterion, as in Find mode; relative dates ("this year") stay relative.
    const query = (w.query ??= []);
    const finds = h('div', { class: 'dash-requests' });
    query.forEach((r, i) => {
      const omit = r.omit === true || r.omit === 'true';
      const req = h('div', { class: `ai-request${omit ? ' ai-request-omit' : ''}` });
      const remove = h('button', { type: 'button', class: 'quiet', title: 'Remove this request', 'aria-label': `Remove request ${i + 1}` }, '×');
      remove.addEventListener('click', () => (query.splice(i, 1), onChange(), draw()));
      req.append(h('div', { class: 'ai-note' }, `${omit ? 'Omit' : 'Find'} (request ${i + 1})`, remove));
      for (const k of Object.keys(r)) {
        if (k === 'omit') continue;
        req.append(h('label', { class: 'ai-criterion' }, h('span', {}, k), input(String(r[k]), `${k} criteria`, (v) => (r[k] = v, onChange()))));
      }
      const add = h('div', { class: 'dash-add' });
      const name = input('', 'Field to add', () => {}, { placeholder: 'Add field…' });
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && name.value.trim()) {
          r[name.value.trim()] = '';
          onChange();
          draw();
        }
      });
      add.append(name);
      req.append(add);
      finds.append(req);
    });
    const more = h('button', { type: 'button', class: 'quiet' }, '+ Find request');
    more.addEventListener('click', () => (query.push({}), draw()));
    box.append(h('div', { class: 'dash-edit-row' }, h('span', {}, 'Find'), h('div', {}, query.length ? finds : h('span', { class: 'ai-note' }, 'All records'), more)));
    if (w.kind !== 'number') {
      box.append(row(w.kind === 'chart' ? 'Group by (categories, series)' : 'Group by', input((w.groupBy ?? []).join(', '), 'Group by', (v) => {
        w.groupBy = v.split(',').map((x) => x.trim()).filter(Boolean);
        onChange();
      }), choose([['', 'each value'], ...PERIODS.map((p) => [p, `per ${p}`] as [string, string])], w.by ?? '', 'Dates grouped', (v) => {
        if (v) w.by = v as Period;
        else delete w.by;
        onChange();
      })));
    }
    box.append(row('Measure', choose([['', 'count of records'], ...MEASURES.map((m) => [m, m] as [string, string])], w.measure?.fn ?? '', 'Measure', (v) => {
      if (v) w.measure = { field: w.measure?.field ?? '', fn: v as Measure };
      else delete w.measure;
      onChange();
      draw();
    }), ...(w.measure ? [input(w.measure.field, 'Measure field', (v) => (w.measure!.field = v, onChange()), { placeholder: 'Field' })] : [])));
    const topN = input(w.top ? String(w.top.n) : '', 'Top how many', (v) => {
      const n = Math.trunc(Number(v));
      if (n > 0 && w.top) w.top.n = n;
      onChange();
    }, { placeholder: 'n', inputmode: 'numeric', size: '3' });
    box.append(row('Only the top', topN, input(w.top?.field ?? '', 'Top field', (v) => {
      if (v.trim()) w.top = { field: v.trim(), n: w.top?.n ?? (Math.trunc(Number(topN.value)) || 10) };
      else delete w.top;
      onChange();
    }, { placeholder: 'field (Customer)' })));
  };
  draw();
  return box;
}

/** A widget as saved: empty criteria and requests left out. */
export function tidyWidget(w: Widget): Widget {
  const query = (w.query ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== ''))).filter((r) => Object.keys(r).some((k) => k !== 'omit'));
  const out: Widget = { ...w, query };
  if (!query.length) delete out.query;
  if (!out.groupBy?.length) delete out.groupBy;
  return out;
}
