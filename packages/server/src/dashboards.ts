// Dashboards: charts, summary tables and single numbers, each a find on a layout broken down by fields, saved
// with the file and worked out again whenever they're looked at, so they stay live. Asked for in plain English
// ("revenue by month for my top 10 customers this year") and built by the assistant, or put together by hand.
// The find and grouping each widget uses are kept as data, shown in words and editable. Relative dates ("this
// year", "last 30 days") stay relative: they are turned into a date range each time the dashboard is worked out.
//
//   GET    /tabularius/dashboards/v1/databases/{db}             the file's dashboards
//   POST   /tabularius/dashboards/v1/databases/{db}             {name, description?, widgets}: saves a new one
//                                                             (?preview=1 works it out without saving)
//   GET    /tabularius/dashboards/v1/databases/{db}/{id}        one, with each widget's numbers
//   PUT    /tabularius/dashboards/v1/databases/{db}/{id}        {name?, description?, widgets?}: changes it
//   DELETE /tabularius/dashboards/v1/databases/{db}/{id}
//
// Same session tokens as the Data API. Numbers are worked out as the signed-in account: records it can't view
// are left out, and a field it can't see is an error on that widget. Anyone signed in may make dashboards;
// changing or deleting one is for the account that made it, or [Full Access].

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StoreError, type FindRequest, type Privileges, type Store } from '../../store/src/index.ts';
import { ApiError, badPathError, readJson, sessionPrivileges, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import { summarizeRecords, type Measure, type Period } from './summarize.ts';

export type WidgetKind = 'chart' | 'table' | 'number';
export type ChartType = 'column' | 'bar' | 'line' | 'pie';

export interface Widget {
  title: string;
  kind: WidgetKind;
  /** For a chart. */
  chart?: ChartType;
  layout: string;
  /** Find requests, as find_records takes them; none for all records. Date criteria may be relative ("this year"). */
  query?: FindRequest[];
  /** Fields to break the records down by: for a chart, the categories and then (optionally) one series per value. */
  groupBy?: string[];
  /** Date and timestamp fields in groupBy grouped by this period. */
  by?: Period;
  /** What each group shows; a count of records when there's none. */
  measure?: { field: string; fn: Measure };
  /** Only the records whose value of this field is one of the n largest by the measure (or by count): "top 10 customers". */
  top?: { field: string; n: number };
  /** Groups to show (default 12 for a chart, 50 for a table). */
  limit?: number;
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  widgets: Widget[];
  account?: string;
  created: string;
  updated: string;
}

/** A widget worked out: its numbers, and the find it used in words. */
export interface WidgetData {
  title: string;
  kind: WidgetKind;
  chart?: ChartType;
  layout: string;
  /** The widget's find in words, one line per request ("Date this year (2026-01-01...2026-12-31)"). */
  find: string[];
  /** How the records are broken down and measured, in words. */
  grouping: string;
  foundCount?: number;
  /** For a number widget. */
  value?: number | string | null;
  /** For a chart: categories along the bottom (or the slices), with one series, or one per value of the second groupBy field. */
  categories?: string[];
  series?: { name: string; values: (number | null)[] }[];
  xTitle?: string;
  yTitle?: string;
  /** For a table. */
  columns?: string[];
  rows?: (string | number | null)[][];
  /** The top values the widget is limited to. */
  top?: { field: string; values: string[] };
  /** More groups than are shown. */
  groupCount?: number;
  /** Why it couldn't be worked out (a field that's gone, a layout renamed). */
  error?: string;
}

const KINDS = new Set<WidgetKind>(['chart', 'table', 'number']);
const CHARTS = new Set<ChartType>(['column', 'bar', 'line', 'pie']);
const PERIODS = new Set<Period>(['day', 'week', 'month', 'quarter', 'year']);
const MEASURES = new Set<Measure>(['count', 'sum', 'average', 'min', 'max', 'distinct']);
const MAX_WIDGETS = 24;

export class DashboardError extends Error {}

/** A widget as sent (by a person or the model), checked and trimmed to what a widget holds. */
export function cleanWidget(input: unknown): Widget {
  if (!input || typeof input !== 'object') throw new DashboardError('Each widget should be an object');
  const w = input as Record<string, unknown>;
  const kind = (KINDS.has(w.kind as WidgetKind) ? w.kind : 'chart') as WidgetKind;
  const layout = typeof w.layout === 'string' ? w.layout.trim() : '';
  if (!layout) throw new DashboardError('Each widget needs the layout its records come from');
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);
  const groupBy = strings(w.groupBy).slice(0, 3);
  if (kind === 'chart' && !groupBy.length) throw new DashboardError(`The chart "${String(w.title ?? '')}" needs a field to group by`);
  if (kind === 'chart' && groupBy.length > 2) throw new DashboardError('A chart groups by at most 2 fields (categories, then one series per value)');
  const m = w.measure && typeof w.measure === 'object' ? w.measure as Record<string, unknown> : undefined;
  const measure = m && typeof m.field === 'string' && m.field.trim() && MEASURES.has(m.fn as Measure) ? { field: m.field.trim(), fn: m.fn as Measure } : undefined;
  const t = w.top && typeof w.top === 'object' ? w.top as Record<string, unknown> : undefined;
  const top = t && typeof t.field === 'string' && t.field.trim() ? { field: t.field.trim(), n: Math.min(Math.max(Math.trunc(Number(t.n)) || 10, 1), 50) } : undefined;
  const query = (Array.isArray(w.query) ? w.query : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).length > 0)
    .slice(0, 20)
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, k === 'omit' ? v === true || v === 'true' : v])) as FindRequest);
  const limit = Number.isInteger(w.limit) ? Math.min(Math.max(w.limit as number, 1), 200) : undefined;
  return {
    title: (typeof w.title === 'string' && w.title.trim() ? w.title.trim() : measure ? `${measure.fn} of ${measure.field}` : 'Records').slice(0, 200),
    kind, ...(kind === 'chart' ? { chart: (CHARTS.has(w.chart as ChartType) ? w.chart : 'column') as ChartType } : {}),
    layout, ...(query.length ? { query } : {}), ...(groupBy.length ? { groupBy } : {}),
    ...(PERIODS.has(w.by as Period) ? { by: w.by as Period } : {}), ...(measure ? { measure } : {}), ...(top ? { top } : {}), ...(limit ? { limit } : {}),
  };
}

export function cleanDashboard(input: Record<string, unknown>, partial = false): Partial<Pick<Dashboard, 'name' | 'description' | 'widgets'>> {
  const out: Partial<Pick<Dashboard, 'name' | 'description' | 'widgets'>> = {};
  if (!partial || input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
    if (!name) throw new DashboardError('Give the dashboard a name');
    out.name = name;
  }
  if (input.description !== undefined) out.description = typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '';
  if (!partial || input.widgets !== undefined) {
    if (!Array.isArray(input.widgets) || !input.widgets.length) throw new DashboardError('A dashboard needs at least one widget');
    if (input.widgets.length > MAX_WIDGETS) throw new DashboardError(`A dashboard holds at most ${MAX_WIDGETS} widgets`);
    out.widgets = input.widgets.map(cleanWidget);
  }
  return out;
}

// --- relative dates -------------------------------------------------------------

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (y: number, m: number, d: number) => new Date(y, m, d);

/**
 * A relative date criterion ("this year", "last month", "last 30 days", "today", "year to date") as the date range
 * it means today, in FileMaker's range form; undefined when it isn't one.
 */
export function relativeDate(text: string, now = new Date()): string | undefined {
  const v = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const y = now.getFullYear();
  const m = now.getMonth();
  const range = (a: Date, b: Date) => `${iso(a)}...${iso(b)}`;
  const today = day(y, m, now.getDate());
  const q = Math.floor(m / 3) * 3;
  const monday = day(y, m, now.getDate() - ((now.getDay() + 6) % 7));
  switch (v) {
    case 'today': return iso(today);
    case 'yesterday': return iso(day(y, m, now.getDate() - 1));
    case 'this week': return range(monday, day(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
    case 'last week': return range(day(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7), day(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1));
    case 'this month': return range(day(y, m, 1), day(y, m + 1, 0));
    case 'last month': return range(day(y, m - 1, 1), day(y, m, 0));
    case 'this quarter': return range(day(y, q, 1), day(y, q + 3, 0));
    case 'last quarter': return range(day(y, q - 3, 1), day(y, q, 0));
    case 'this year': return range(day(y, 0, 1), day(y, 11, 31));
    case 'last year': return range(day(y - 1, 0, 1), day(y - 1, 11, 31));
    case 'year to date': case 'ytd': return range(day(y, 0, 1), today);
    case 'month to date': case 'mtd': return range(day(y, m, 1), today);
  }
  const last = /^(?:last|past) (\d{1,4}) (day|week|month)s?$/.exec(v);
  if (last) {
    const n = Number(last[1]);
    const from = last[2] === 'day' ? day(y, m, now.getDate() - n + 1) : last[2] === 'week' ? day(y, m, now.getDate() - 7 * n + 1) : day(y, m - n, now.getDate() + 1);
    return range(from, today);
  }
  return undefined;
}

/** The requests with relative date criteria on date and timestamp fields made into today's ranges. */
function resolveDates(store: Store, layout: string, query: FindRequest[], now: Date): { query: FindRequest[]; notes: Map<string, string> } {
  const info = store.layout(layout);
  const dated = new Set(info.fields.filter((f) => f.type === 'date' || f.type === 'timestamp').map((f) => f.name.toLowerCase()));
  const notes = new Map<string, string>();
  const out = query.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    if (typeof v !== 'string' || !dated.has(k.toLowerCase())) return [k, v];
    const range = relativeDate(v, now);
    if (!range) return [k, v];
    notes.set(v.trim().toLowerCase(), range);
    return [k, range];
  })) as FindRequest);
  return { query: out, notes };
}

// --- working a widget out --------------------------------------------------------

/** A find in words: each request's criteria, relative dates with the range they mean today. */
export function describeFind(query: FindRequest[] | undefined, notes = new Map<string, string>()): string[] {
  if (!query?.length) return ['All records'];
  return query.map((r) => {
    const omit = r.omit === true || r.omit === 'true';
    const parts = Object.entries(r).filter(([k]) => k !== 'omit').map(([k, v]) => {
      const s = String(v);
      const range = notes.get(s.trim().toLowerCase());
      return `${k} ${range ? `${s} (${range})` : s}`;
    });
    return `${omit ? 'Omit' : 'Find'} ${parts.join(', ') || 'all'}`;
  });
}

const measureLabel = (m: Widget['measure']) => (m ? `${m.fn}(${m.field})` : 'Count');

function describeGrouping(w: Widget): string {
  const what = w.measure ? `${w.measure.fn === 'average' ? 'Average' : w.measure.fn === 'distinct' ? 'Distinct count of' : w.measure.fn[0].toUpperCase() + w.measure.fn.slice(1)} ${w.measure.fn === 'count' || w.measure.fn === 'distinct' ? '' : 'of '}${w.measure.field}`.replace('Count ', 'Count of ') : 'Count of records';
  const by = w.groupBy?.length ? ` by ${w.groupBy.map((g, i) => (i === 0 && w.by ? `${g} (per ${w.by})` : g)).join(', then ')}` : '';
  const top = w.top ? `, for the top ${w.top.n} ${w.top.field} values` : '';
  return `${what}${by}${top}`;
}

const text = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : String(v).slice(0, 80));
const num = (v: unknown): number | null => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** A widget's numbers, worked out now as the account. Errors come back on the widget, so one broken widget doesn't hide the rest. */
export function computeWidget(store: Store, w: Widget, privileges?: Privileges, now = new Date(), onRead?: (layout: string, ids: number[]) => void, forModel = false): WidgetData {
  const base: WidgetData = { title: w.title, kind: w.kind, ...(w.chart ? { chart: w.chart } : {}), layout: w.layout, find: describeFind(w.query), grouping: describeGrouping(w) };
  try {
    const { query: resolved, notes } = resolveDates(store, w.layout, w.query ?? [], now);
    base.find = describeFind(w.query, notes);
    const measures = w.measure ? [w.measure] : [];
    let query = resolved;
    if (w.top) {
      // The n largest values of the top field over the widget's find, then the find narrowed to them.
      const topRequest = { layout: w.layout, query: query.length ? query : undefined, groupBy: [w.top.field], measures, limit: w.top.n, order: 'measure' as const };
      const tops = summarizeRecords(store, topRequest, privileges, (ids) => onRead?.(w.layout, ids));
      const key = Object.keys(tops.groups?.[0]?.values ?? {})[0] ?? w.top.field;
      const values = (tops.groups ?? []).map((g) => g.values[key]);
      const shown = forModel ? summarizeRecords(store, topRequest, privileges, undefined, true) : tops;
      base.top = { field: w.top.field, values: (shown.groups ?? []).map((g) => text(g.values[key])) };
      if (!values.length) return { ...base, foundCount: 0, ...empty(w) };
      const finds = query.filter((r) => !(r.omit === true || r.omit === 'true'));
      const omits = query.filter((r) => r.omit === true || r.omit === 'true');
      const each = (v: unknown) => ({ [w.top!.field]: v === null || v === '' ? '=' : `==${String(v)}` });
      query = [...(finds.length ? finds : [{}]).flatMap((r) => values.map((v) => ({ ...r, ...each(v) }) as FindRequest)), ...omits];
    }
    const groupBy = w.groupBy ?? [];
    const chart = w.kind === 'chart';
    const limit = w.limit ?? (chart ? 12 : 50);
    const ordered = chart && (w.chart === 'line' || !!w.by);
    const s = summarizeRecords(store, {
      layout: w.layout, query: query.length ? query : undefined, groupBy: w.kind === 'number' ? [] : groupBy, measures,
      // Charts with series, and line charts and periods (kept in order), need all the groups to arrange them here.
      limit: chart && (groupBy.length > 1 || ordered) ? 500 : limit, ...(w.by ? { by: w.by } : {}), ...(w.measure && !ordered ? { order: 'measure' as const } : {}),
    }, privileges, (ids) => onRead?.(w.layout, ids), forModel);
    const label = measureLabel(w.measure);
    const valueOf = (g: { count: number; measures: Record<string, unknown> }) => (w.measure ? num(Object.values(g.measures)[0]) : g.count);
    if (w.kind === 'number') return { ...base, foundCount: s.foundCount, value: w.measure ? (s.totals[label] as number | string | null) ?? null : s.foundCount };
    const groups = s.groups ?? [];
    const keys = Object.keys(groups[0]?.values ?? {});
    if (w.kind === 'table') {
      return {
        ...base, foundCount: s.foundCount, columns: [...(keys.length ? keys : groupBy), ...(w.measure ? [label, 'Records'] : ['Records'])],
        rows: groups.map((g) => [...keys.map((k) => (g.values[k] === null || g.values[k] === '' ? '(empty)' : g.values[k] as string | number)), ...(w.measure ? [valueOf(g)] : []), g.count]),
        ...(s.groupCount ? { groupCount: s.groupCount } : {}),
      };
    }
    // A chart: categories from the first field; one series, or one per value of the second.
    const [cat, ser] = keys;
    let categories = [...new Set(groups.map((g) => text(g.values[cat])))];
    if (ordered) categories.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let groupCount: number | undefined;
    if (categories.length > limit) {
      groupCount = categories.length;
      if (ordered) categories = categories.slice(-limit);
      else {
        // The largest categories, over all series.
        const totals = new Map<string, number>();
        for (const g of groups) totals.set(text(g.values[cat]), (totals.get(text(g.values[cat])) ?? 0) + (valueOf(g) ?? 0));
        categories = categories.sort((a, b) => totals.get(b)! - totals.get(a)!).slice(0, limit);
      }
    } else if (s.groupCount && groupBy.length === 1) groupCount = s.groupCount;
    const at = new Map(categories.map((c, i) => [c, i]));
    let series: { name: string; values: (number | null)[] }[];
    if (ser === undefined) {
      const values: (number | null)[] = categories.map(() => null);
      for (const g of groups) if (at.has(text(g.values[cat]))) values[at.get(text(g.values[cat]))!] = valueOf(g);
      series = [{ name: label, values }];
    } else {
      const bySeries = new Map<string, (number | null)[]>();
      for (const g of groups) {
        const i = at.get(text(g.values[cat]));
        if (i === undefined) continue;
        const name = text(g.values[ser]);
        if (!bySeries.has(name)) bySeries.set(name, categories.map(() => null));
        bySeries.get(name)![i] = valueOf(g);
      }
      // At most 10 series, the largest; a chart with more can't be read.
      series = [...bySeries].map(([name, values]) => ({ name, values }))
        .sort((a, b) => b.values.reduce<number>((t, v) => t + (v ?? 0), 0) - a.values.reduce<number>((t, v) => t + (v ?? 0), 0)).slice(0, 10);
    }
    return { ...base, foundCount: s.foundCount, xTitle: cat ?? groupBy[0], yTitle: label, categories, series, ...(groupCount && groupCount > categories.length ? { groupCount } : {}) };
  } catch (e) {
    return { ...base, error: e instanceof StoreError || e instanceof Error ? e.message : String(e) };
  }
}

function empty(w: Widget): Partial<WidgetData> {
  if (w.kind === 'number') return { value: w.measure ? null : 0 };
  if (w.kind === 'table') return { columns: [...(w.groupBy ?? []), ...(w.measure ? [measureLabel(w.measure)] : []), 'Records'], rows: [] };
  return { categories: [], series: [{ name: measureLabel(w.measure), values: [] }] };
}

export function computeDashboard(store: Store, widgets: Widget[], privileges?: Privileges, now = new Date(), onRead?: (layout: string, ids: number[]) => void, forModel = false): WidgetData[] {
  return widgets.map((w) => computeWidget(store, w, privileges, now, onRead, forModel));
}

// --- saved dashboards ------------------------------------------------------------

/** The file's dashboards, kept in the file itself so they travel with it (backups, copies, clusters). */
export class Dashboards {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  private table(): boolean {
    try {
      this.store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_dashboards (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
        spec TEXT NOT NULL, account TEXT, created TEXT NOT NULL, updated TEXT NOT NULL)`);
      return true;
    } catch {
      return false; // a read-only copy without the table: no dashboards
    }
  }

  list(): Dashboard[] {
    if (!this.table()) return [];
    const rows = this.store.sql.prepare('SELECT * FROM _fm_dashboards ORDER BY name COLLATE NOCASE').all() as unknown as Row[];
    return rows.map(fromRow);
  }

  get(id: string): Dashboard | undefined {
    if (!this.table()) return undefined;
    const row = this.store.sql.prepare('SELECT * FROM _fm_dashboards WHERE id = ?').get(id) as unknown as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  /** Finds one by id, or by name (not case-sensitive). */
  find(ref: string): Dashboard | undefined {
    return this.get(ref) ?? this.list().find((d) => d.name.toLowerCase() === ref.trim().toLowerCase());
  }

  create(input: Pick<Dashboard, 'name' | 'widgets'> & { description?: string }, account?: string): Dashboard {
    if (!this.table()) throw new DashboardError('This file is read-only');
    if (this.list().some((d) => d.name.toLowerCase() === input.name.toLowerCase())) throw new DashboardError(`There's already a dashboard named "${input.name}"`);
    const now = new Date().toISOString();
    const d: Dashboard = { id: randomBytes(6).toString('hex'), name: input.name, ...(input.description ? { description: input.description } : {}), widgets: input.widgets, ...(account ? { account } : {}), created: now, updated: now };
    this.store.sql.prepare('INSERT INTO _fm_dashboards (id, name, description, spec, account, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(d.id, d.name, d.description ?? null, JSON.stringify(d.widgets), d.account ?? null, d.created, d.updated);
    return d;
  }

  update(id: string, change: Partial<Pick<Dashboard, 'name' | 'description' | 'widgets'>>): Dashboard {
    const d = this.get(id);
    if (!d) throw new DashboardError('No such dashboard');
    if (change.name && change.name.toLowerCase() !== d.name.toLowerCase() && this.list().some((x) => x.name.toLowerCase() === change.name!.toLowerCase())) {
      throw new DashboardError(`There's already a dashboard named "${change.name}"`);
    }
    const next: Dashboard = { ...d, ...change, updated: new Date().toISOString() };
    if (!next.description) delete next.description;
    this.store.sql.prepare('UPDATE _fm_dashboards SET name = ?, description = ?, spec = ?, updated = ? WHERE id = ?')
      .run(next.name, next.description ?? null, JSON.stringify(next.widgets), next.updated, id);
    return next;
  }

  delete(id: string): boolean {
    if (!this.table()) return false;
    return this.store.sql.prepare('DELETE FROM _fm_dashboards WHERE id = ?').run(id).changes > 0;
  }
}

interface Row { id: string; name: string; description: string | null; spec: string; account: string | null; created: string; updated: string }

const fromRow = (r: Row): Dashboard => ({
  id: r.id, name: r.name, ...(r.description ? { description: r.description } : {}), widgets: JSON.parse(r.spec) as Widget[],
  ...(r.account ? { account: r.account } : {}), created: r.created, updated: r.updated,
});

/** Whether an account may change or delete a dashboard: the account that made it, or [Full Access]. */
export const mayChange = (d: Dashboard, account: string | undefined, privileges?: Privileges) =>
  !privileges?.ceiling && (!privileges || privileges.full || (!!account && d.account?.toLowerCase() === account.toLowerCase()));

// --- HTTP ------------------------------------------------------------------------

export class DashboardApi {
  private readonly host: Host;
  private readonly api: DataApi;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/dashboards\/v1\/databases\/([^/]+)(?:\/([0-9a-f]{12}))?$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const db = decodeURIComponent(m[1]);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const privileges = sessionPrivileges(store, session);
      const id = m[2];
      const preview = !id && req.method === 'POST' && url.searchParams.get('preview') === '1';
      // Saved dashboards may feed an account-level scheduled digest. Scoped tokens can only read or preview them.
      if (privileges.ceiling && req.method !== 'GET' && !preview) throw new ApiError(9, 'This API token cannot change saved dashboards', 403);
      const boards = new Dashboards(store);
      const summary = (d: Dashboard) => ({ id: d.id, name: d.name, description: d.description, widgets: d.widgets.length, account: d.account, updated: d.updated, canChange: mayChange(d, session.account, privileges) });
      if (!id && req.method === 'GET') send(200, { dashboards: boards.list().map(summary) });
      else if (!id && req.method === 'POST') {
        const body = cleanDashboard(await readJson(req)) as Pick<Dashboard, 'name' | 'widgets'> & { description?: string };
        if (preview) send(200, { name: body.name, widgets: body.widgets, data: computeDashboard(store, body.widgets, privileges) });
        else {
          const d = boards.create(body, session.account);
          send(201, { dashboard: d, canChange: true, data: computeDashboard(store, d.widgets, privileges) });
        }
      } else {
        const d = id ? boards.get(id) : undefined;
        if (!d) throw new ApiError(401, 'No such dashboard', 404);
        if (req.method === 'GET') send(200, { dashboard: d, canChange: mayChange(d, session.account, privileges), data: computeDashboard(store, d.widgets, privileges) });
        else if (!mayChange(d, session.account, privileges)) throw new ApiError(9, 'Only the account that made this dashboard, or one with [Full Access], can change it', 403);
        else if (req.method === 'PUT') {
          const next = boards.update(d.id, cleanDashboard(await readJson(req), true));
          send(200, { dashboard: next, canChange: true, data: computeDashboard(store, next.widgets, privileges) });
        } else if (req.method === 'DELETE') {
          boards.delete(d.id);
          send(200, { deleted: d.id });
        } else throw new ApiError(3, 'Not supported', 405);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof DashboardError ? new ApiError(960, e.message, 400) : e instanceof StoreError ? new ApiError(e.code, e.message, 400) : new ApiError(-1, 'Unknown error');
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof DashboardError) && !(e instanceof StoreError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}
