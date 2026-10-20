// Modern layout templates: a dashboard page worked out from a table's own fields, so a new modern layout starts as a
// working, good-looking page for any file rather than a blank one. The page is plain HTML, CSS and JavaScript (see
// page-source.ts): it reads through window.tabularius, as the signed-in account, and says where its data comes from when
// opened somewhere without it (FileMaker Pro).

import type { DesignField, DesignTable } from './design/client.ts';

/** What a dashboard is made of, picked from a table's fields. */
export interface DashboardPlan {
  table: string;
  /** A number field to total and average (none: records are only counted). */
  measure?: string;
  /** A text field with few values, to break the records down by (a status, region, category). */
  category?: string;
  /** A date or timestamp field, for records by month. */
  date?: string;
  /** Fields to show for each of the latest records. */
  shown: string[];
  /** The kind of solution the table looks like, which adds the figures people in it ask for (none: a general dashboard). */
  flavour?: Flavour;
  /** Inventory: the number field holding the quantity on hand. */
  stock?: string;
  /** A container field to show the latest pictures from (none: no gallery). */
  picture?: string;
}

export type Flavour = 'crm' | 'inventory' | 'invoicing';

/** The flavours a template can be asked for by name, with how they read in the New layout list. */
export const FLAVOURS: [Flavour | 'general', string][] = [
  ['general', 'Dashboard (from the table\'s fields)'], ['crm', 'CRM dashboard (contacts, leads, deals)'],
  ['inventory', 'Inventory dashboard (stock levels)'], ['invoicing', 'Invoicing dashboard (outstanding and paid)'],
];

const TABLE_FLAVOURS: [Flavour, RegExp][] = [
  ['invoicing', /invoice|bill|receipt|payment|order|quote/i],
  ['inventory', /inventory|stock|product|item|sku|part|material|warehouse/i],
  ['crm', /contact|customer|client|lead|deal|opportunit|prospect|compan|account|people|person/i],
];
const STOCK_NAMES = /(qty|quantity|stock|on.?hand|units|in.?stock)/i;
const LOW_STOCK = 10;

const CATEGORY_NAMES = /^(status|stage|state|region|category|type|kind|priority|country|city|department|group|source|channel|owner|assigned|team)/i;
const MEASURE_NAMES = /(amount|total|price|revenue|cost|value|balance|qty|quantity|sales|hours)/i;
const KEY_NAMES = /(^id$|id$|^pk|^fk|_id$|serial|number$|^no$)/i;

const plain = (f: DesignField) => f.kind === 'normal' && !f.options?.global;

/** The table with the most records (the file's main one), unless a name is given. */
export function pickTable(tables: DesignTable[], name?: string): DesignTable | undefined {
  if (name) return tables.find((t) => t.name === name);
  return [...tables].sort((a, b) => (b.records ?? 0) - (a.records ?? 0))[0];
}

/** The measure, category and date to build a dashboard on, from names and types alone (no records are read). */
export function planDashboard(table: DesignTable, flavour?: Flavour | 'general'): DashboardPlan {
  const fields = table.fields.filter(plain);
  const number = fields.filter((f) => f.type === 'number' && !KEY_NAMES.test(f.name));
  const measure = number.find((f) => MEASURE_NAMES.test(f.name)) ?? number[0];
  const text = fields.filter((f) => f.type === 'text' && !KEY_NAMES.test(f.name));
  const category = text.find((f) => CATEGORY_NAMES.test(f.name));
  const date = fields.find((f) => f.type === 'date' || f.type === 'timestamp');
  const shown = [...text, ...number, ...fields.filter((f) => f.type === 'date')].filter((f, i, all) => all.indexOf(f) === i).slice(0, 3).map((f) => f.name);
  const picture = fields.find((f) => f.type === 'container');
  const plan: DashboardPlan = { table: table.name, ...(measure ? { measure: measure.name } : {}), ...(category ? { category: category.name } : {}), ...(date ? { date: date.name } : {}), shown, ...(picture ? { picture: picture.name } : {}) };
  // A flavour only adds figures its fields can back; one asked for that the table can't back is left out.
  const wanted = flavour === 'general' ? undefined : flavour;
  const stock = number.find((f) => STOCK_NAMES.test(f.name));
  if (wanted === 'inventory' && stock) return { ...plan, flavour: wanted, stock: stock.name };
  if (wanted === 'invoicing' && measure && category) return { ...plan, flavour: wanted };
  if (wanted === 'crm' && date) return { ...plan, flavour: wanted };
  return plan;
}

/** The solution a table looks like, from its name alone (it suggests the template New layout starts on). */
export function flavourOf(table: DesignTable): Flavour | undefined {
  return TABLE_FLAVOURS.find(([, re]) => re.test(table.name))?.[0];
}

/** The periods a dashboard with a date field can be narrowed to, as the words the dashboard API reads (the first is every record). */
const PERIODS: [string, string][] = [['', 'All time'], ['this month', 'This month'], ['last month', 'Last month'], ['last 30 days', 'Last 30 days'], ['this quarter', 'This quarter'], ['year to date', 'Year to date'], ['last year', 'Last year']];

/** A value inside a script tag: JSON with the characters that could end the tag or the script written as escapes. */
const js = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const text = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** The extra tiles a flavour adds, filled in by the page's script. */
function extraCards(plan: DashboardPlan): string {
  const card = (id: string, label: string) => `<section class="card"><h2>${text(label)}</h2><div class="kpi" id="${id}">–</div></section>`;
  if (plan.flavour === 'invoicing') return card('owed', `Outstanding ${plan.measure}`) + card('paid', `Paid ${plan.measure}`);
  if (plan.flavour === 'inventory') return card('low', `Low stock (${LOW_STOCK} or fewer)`) + card('none', 'Out of stock');
  if (plan.flavour === 'crm') return card('fresh', 'New this month');
  return '';
}

/**
 * The dashboard page for a plan: tiles (record count, total and average of the measure), a chart by category, a chart by
 * month, and the latest records. Each part reads on its own, so one the account may not see (a field it has no access
 * to) shows its error and the rest still draw. Animation stops under prefers-reduced-motion.
 */
export function dashboardPage(title: string, layout: string, plan: DashboardPlan): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(title)}</title>
<style>
  :root { --bg: #0b1020; --card: rgba(255,255,255,.07); --line: rgba(255,255,255,.1); --text: #e8ecf8; --muted: #a3abc7; --a: #7c5cff; --b: #22d3ee; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font: 15px/1.5 system-ui, -apple-system, sans-serif; color: var(--text);
    background: radial-gradient(1100px 560px at 8% -12%, #2a1f6b 0, transparent 60%), radial-gradient(900px 480px at 108% 8%, #0e4b5c 0, transparent 55%), var(--bg); }
  header { padding: 28px 28px 4px; }
  h1 { margin: 0; font-size: clamp(24px, 4vw, 32px); letter-spacing: -.02em; }
  h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .muted { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 16px; padding: 20px 28px 28px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px 20px; animation: rise .55s ease both; min-width: 0; }
  .card:nth-child(2) { animation-delay: .07s; } .card:nth-child(3) { animation-delay: .14s; }
  .wide { grid-column: 1 / -1; }
  .kpi { font-size: clamp(30px, 5vw, 40px); font-weight: 700; line-height: 1.2; background: linear-gradient(90deg, var(--a), var(--b)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  svg text { fill: var(--muted); font-size: 11px; }
  .bar { transform-origin: bottom; transform-box: fill-box; animation: grow .8s cubic-bezier(.2,.8,.2,1) both; }
  .line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.2s ease forwards; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: flex; gap: 12px; justify-content: space-between; padding: 8px 12px; border-radius: 10px; background: rgba(255,255,255,.04); cursor: pointer; }
  li:hover, li:focus-visible { outline: 2px solid var(--b); }
  .pics { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
  .pics img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 12px; background: rgba(255,255,255,.06); }
  .donut { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; }
  .donut svg { width: 180px; flex: none; }
  .donut ul { flex: 1; min-width: 160px; }
  .donut li { cursor: default; }
  .donut .sw { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
  header { position: relative; }
  .print-btn { position: absolute; top: 28px; right: 28px; font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  .print-btn:hover, .print-btn:focus-visible { outline: 2px solid var(--b); }
  .trend { min-height: 1.4em; font-size: 13px; color: var(--muted); }
  .trend .up { color: #4ade80; } .trend .down { color: #f87171; }
  .pick button { font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; cursor: pointer; margin-left: 8px; }
  .bar[tabindex], .donut li[tabindex] { cursor: pointer; }
  .bar[tabindex]:focus-visible { outline: 2px solid var(--b); }
  .dim { opacity: .4; }
  .period { display: inline-block; margin-top: 10px; }
  .period select { font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; }
  .err { color: #fca5a5; }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
  @keyframes grow { from { transform: scaleY(0); } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @media print { .trend .up { color: #166534; } .trend .down { color: #991b1b; } body { background: #fff; color: #111; } .card { background: none; border-color: #ccc; animation: none; break-inside: avoid; } .kpi { background: none; color: #111; } .muted, h2, svg text { color: #555; fill: #555; } .print-btn, .period select { display: none; } li { background: none; } }
  @media (prefers-reduced-motion: reduce) { .card, .bar, .line { animation: none; } .line { stroke-dashoffset: 0; } }
  @media (forced-colors: active) { .kpi { background: none; color: CanvasText; } }
</style>
</head>
<body>
<header><h1>${text(title)}</h1><p class="muted" id="where"></p><button id="print" class="print-btn" hidden>Print / Save as PDF</button>${plan.date ? `
  <label class="muted period">Period <select id="period">${PERIODS.map(([v, l]) => `<option value="${text(v)}">${text(l)}</option>`).join('')}</select> <span>by ${text(plan.date)}</span></label>` : ''}${plan.category ? `
  <p class="muted pick" id="picked" hidden></p>` : ''}</header>
<main class="grid">
  <section class="card"><h2>Records</h2><div class="kpi" id="count">–</div>${plan.date ? '<div class="trend" id="count-trend"></div>' : ''}</section>
  ${plan.measure ? `<section class="card"><h2>Total ${text(plan.measure)}</h2><div class="kpi" id="sum">–</div>${plan.date ? '<div class="trend" id="sum-trend"></div>' : ''}</section>
  <section class="card"><h2>Average ${text(plan.measure)}</h2><div class="kpi" id="avg">–</div></section>` : ''}
  ${extraCards(plan)}
  ${plan.category ? `<section class="card wide"><h2>${plan.measure ? text(plan.measure) : 'Records'} by ${text(plan.category)}</h2><div id="by-category"></div></section>
  <section class="card wide"><h2>Share of ${plan.measure ? text(plan.measure) : 'records'} by ${text(plan.category)}</h2><div id="share"></div></section>` : ''}
  ${plan.date ? `<section class="card wide"><h2>${plan.measure ? text(plan.measure) : 'Records'} by month</h2><div id="by-month"></div></section>` : ''}
  ${plan.picture ? `<section class="card wide"><h2>Latest pictures</h2><div class="pics" id="pics"></div></section>` : ''}
  <section class="card wide"><h2>Latest records</h2><ul id="latest"></ul></section>
</main>
<script>
  const PLAN = ${js({ layout, ...plan })};
  const $ = (id) => document.getElementById(id);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (v) => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (Math.round(v * 100) / 100).toLocaleString();
  const fail = (el, e) => { if (el) el.innerHTML = '<span class="err"></span>', el.firstChild.textContent = e.message || String(e); };
  function countUp(el, to) {
    const t0 = performance.now(), ms = calm ? 0 : 900;
    (function step(t) {
      const p = ms ? Math.min(1, (t - t0) / ms) : 1;
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  const measure = PLAN.measure && { field: PLAN.measure, fn: 'sum' };
  let pick = '';
  function choose(k) { pick = pick === k ? '' : k; show(); }
  const LOW_STOCK = ${LOW_STOCK}; // change this to move the line between enough stock and low stock
  // Invoicing: what the status groups say. Paid is any status that reads paid, closed or complete; cancelled ones count for neither.
  function owed(c) {
    const v = (c.series && c.series[0] && c.series[0].values) || [];
    let paid = 0, open = 0;
    c.categories.forEach((k, i) => { const n = Number(v[i]) || 0; if (/paid|closed|complete|settled/i.test(k)) paid += n; else if (!/cancel|void|draft|refund/i.test(k)) open += n; });
    countUp($('owed'), open); countUp($('paid'), paid);
  }
  function barBoxes(v, H) {
    const hi = Math.max(0, ...v.map(Number)), lo = Math.min(0, ...v.map(Number)), span = hi - lo || 1, top = 14, room = H - 36, base = top + room * hi / span;
    return v.map((x) => { const h = Math.abs(room * Number(x) / span); return { y: Number(x) < 0 ? base : base - h, h: h }; });
  }
  function bars(el, c) {
    const v = (c.series && c.series[0] && c.series[0].values) || [];
    if (!v.length) { el.textContent = 'No records yet.'; return; }
    const W = 640, H = 220, bw = W / v.length, box = barBoxes(v, H);
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>' +
      v.map((x, i) => { return '<rect class="bar" style="animation-delay:' + (calm ? 0 : i * .06) + 's" x="' + (i * bw + bw * .18) + '" y="' + box[i].y + '" width="' + bw * .64 + '" height="' + box[i].h + '" rx="6" fill="url(#g)"><title></title></rect>'; }).join('') +
      v.map((x, i) => '<text x="' + (i * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle"></text>').join('') + '</svg>';
    el.querySelectorAll('rect title').forEach((t, i) => (t.textContent = c.categories[i] + ': ' + fmt(Number(v[i]))));
    el.querySelectorAll('text').forEach((t, i) => (t.textContent = String(c.categories[i]).slice(0, Math.max(3, Math.floor(bw / 7)))));
    el.firstChild.setAttribute('aria-label', 'Chart of ' + v.length + ' groups');
    el.querySelectorAll('rect.bar').forEach((r, i) => {
      const k = String(c.categories[i]);
      r.setAttribute('tabindex', '0'); r.setAttribute('role', 'button'); r.setAttribute('aria-label', k + ': show only this group');
      r.classList.toggle('dim', !!pick && pick !== k);
      r.addEventListener('click', () => choose(k));
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(k); } });
    });
  }
  // A donut of each group's share of the total, from the same figures as the bars. Groups past the sixth are folded into Other.
  function donut(el, c) {
    const raw = ((c.series && c.series[0] && c.series[0].values) || []).map((x) => Math.max(0, Number(x) || 0));
    const parts = raw.map((n, i) => [String(c.categories[i]), n]).filter((p) => p[1] > 0).sort((a, b) => b[1] - a[1]);
    const total = parts.reduce((t, p) => t + p[1], 0);
    if (!total) { el.textContent = 'No figures to share out yet.'; return; }
    const top = parts.slice(0, 6), rest = parts.slice(6).reduce((t, p) => t + p[1], 0);
    if (rest) top.push(['Other', rest]);
    const hue = (i) => 'hsl(' + (250 - i * 38) + ' 80% 66%)', R = 40, C = 2 * Math.PI * R;
    let at = 0;
    const arcs = top.map((p, i) => { const len = C * p[1] / total, a = '<circle class="arc" r="' + R + '" cx="50" cy="50" fill="none" stroke="' + hue(i) + '" stroke-width="16" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + -at + '" transform="rotate(-90 50 50)"><title></title></circle>'; at += len; return a; });
    el.className = 'donut';
    el.innerHTML = '<svg viewBox="0 0 100 100" role="img" aria-label="Share by group">' + arcs.join('') + '</svg><ul></ul>';
    el.querySelectorAll('title').forEach((t, i) => (t.textContent = top[i][0] + ': ' + fmt(top[i][1])));
    el.querySelector('ul').replaceChildren(...top.map((p, i) => {
      const li = document.createElement('li'), name = document.createElement('span'), dot = document.createElement('i'), pct = document.createElement('span');
      dot.className = 'sw'; dot.style.background = hue(i); name.append(dot, p[0]); pct.textContent = Math.round(100 * p[1] / total) + '%';
      li.append(name, pct);
      if (p[0] !== 'Other') {
        li.tabIndex = 0; li.setAttribute('role', 'button'); li.classList.toggle('dim', !!pick && pick !== p[0]);
        li.addEventListener('click', () => choose(p[0]));
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(p[0]); } });
      }
      return li;
    }));
  }
  function line(el, c) {
    const v = ((c.series && c.series[0] && c.series[0].values) || []).map(Number);
    if (v.length < 2) { el.textContent = 'Not enough months yet.'; return; }
    const W = 640, H = 200, max = Math.max(1, ...v), pts = v.map((x, i) => [i * (W / (v.length - 1)), H - 24 - (H - 40) * x / max]);
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Line chart by month"><path class="line" pathLength="1" fill="none" stroke="#22d3ee" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M' + pts.map((p) => p.join(',')).join(' L') + '"/><text x="0" y="' + (H - 4) + '"></text><text x="' + W + '" y="' + (H - 4) + '" text-anchor="end"></text></svg>';
    const t = el.querySelectorAll('text'); t[0].textContent = c.categories[0]; t[1].textContent = c.categories[c.categories.length - 1];
  }
  // The period just before the chosen one, as the words or range the dashboard API reads, and what to call it (none for All time).
  function before(p) {
    const t = new Date(), y = t.getFullYear(), m = t.getMonth(), d = t.getDate(), pad = (n) => String(n).padStart(2, '0');
    const iso = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    const span = (a, b) => iso(a) + '...' + iso(b);
    switch (p) {
      case 'this month': return ['last month', 'last month'];
      case 'last month': return [span(new Date(y, m - 2, 1), new Date(y, m - 1, 0)), 'the month before'];
      case 'last 30 days': return [span(new Date(y, m, d - 59), new Date(y, m, d - 30)), 'the 30 days before'];
      case 'this quarter': return ['last quarter', 'last quarter'];
      case 'year to date': return [span(new Date(y - 1, 0, 1), new Date(y - 1, m, d)), 'the same days last year'];
      case 'last year': return [span(new Date(y - 2, 0, 1), new Date(y - 2, 11, 31)), 'the year before'];
    }
    return null;
  }
  // How a figure moved: the arrow and percentage (or why there is none), and which way it went.
  function change(now, then) {
    if (now === then) return { text: 'No change', dir: '' };
    const up = now > then;
    const pct = then ? Math.round(100 * Math.abs(now - then) / Math.abs(then)) : null;
    return { text: (up ? '▲ ' : '▼ ') + (pct === null ? 'up from none' : pct === 0 ? 'under 1%' : pct + '%'), dir: up ? 'up' : 'down' };
  }
  function trend(el, now, then, label) {
    if (!el) return;
    const c = change(now, then), s = document.createElement('span');
    s.className = c.dir; s.textContent = c.text;
    el.replaceChildren(s, ' vs ' + label);
  }
  async function show() {
    if (!window.tabularius) { $('where').textContent = 'Shows live figures from ' + PLAN.table + ' when opened in Tabularius.'; return; }
    $('where').textContent = 'Live from ' + PLAN.table;
    $('print').hidden = false;
    // The chosen period narrows every figure and chart: its date words are added to each find request (or make one), unless the request already sets that date, as New this month does.
    const period = $('period') ? $('period').value : '';
    // Choosing a bar or slice narrows the figures to that group too; the two charts by group still show every group.
    const ask = (w, all, when) => {
      const add = Object.assign({}, (when === undefined ? period : when) ? { [PLAN.date]: when === undefined ? period : when } : {}, pick && !all ? { [PLAN.category]: '==' + pick } : {});
      if (Object.keys(add).length) w = Object.assign({}, w, { query: (w.query || [{}]).map((q) => Object.assign({}, add, q)) });
      return tabularius.summarize(Object.assign({ layout: PLAN.layout }, w));
    };
    if ($('picked')) { $('picked').hidden = !pick; $('picked').textContent = pick ? PLAN.category + ' = ' + pick : ''; if (pick) { const b = document.createElement('button'); b.textContent = 'Clear'; b.onclick = () => choose(''); $('picked').append(b); } }
    const prev = period ? before(period) : null;
    ['count-trend', 'sum-trend'].forEach((id) => $(id) && $(id).replaceChildren());
    ask({ kind: 'number' }).then((r) => {
      const n = Number(r.value) || 0; countUp($('count'), n);
      if (prev) ask({ kind: 'number' }, false, prev[0]).then((o) => trend($('count-trend'), n, Number(o.value) || 0, prev[1]), () => {});
    }, (e) => fail($('count'), e));
    if (measure) {
      ask({ kind: 'number', measure }).then((s) => {
        const n = Number(s.value) || 0; countUp($('sum'), n);
        if (prev) ask({ kind: 'number', measure }, false, prev[0]).then((o) => trend($('sum-trend'), n, Number(o.value) || 0, prev[1]), () => {});
        return ask({ kind: 'number' }).then((r) => countUp($('avg'), n / (Number(r.value) || 1)));
      }).catch((e) => { fail($('sum'), e); fail($('avg'), e); });
    }
    if (PLAN.flavour === 'inventory') {
      const count = (el, q) => ask({ kind: 'number', query: [q] }).then((r) => countUp(el, Number(r.value) || 0), (e) => fail(el, e));
      count($('low'), { [PLAN.stock]: '<=' + LOW_STOCK }); count($('none'), { [PLAN.stock]: '0' });
    }
    if (PLAN.flavour === 'crm') ask({ kind: 'number', query: [{ [PLAN.date]: 'this month' }] }).then((r) => countUp($('fresh'), Number(r.value) || 0), (e) => fail($('fresh'), e));
    if (PLAN.category) ask({ kind: 'chart', chart: 'column', groupBy: [PLAN.category], measure, limit: 12 }, true).then((c) => { bars($('by-category'), c); donut($('share'), c); if (PLAN.flavour === 'invoicing') owed(c); }, (e) => { fail($('by-category'), e); fail($('share'), e); if (PLAN.flavour === 'invoicing') { fail($('owed'), e); fail($('paid'), e); } });
    if (PLAN.date) ask({ kind: 'chart', chart: 'line', groupBy: [PLAN.date], by: 'month', measure, limit: 24 }).then((c) => line($('by-month'), c), (e) => fail($('by-month'), e));
    tabularius.records(PLAN.layout, { limit: 8, sort: [{ fieldName: 'recordId', sortOrder: 'descend' }] }).catch(() => tabularius.records(PLAN.layout, { limit: 8 })).then((r) => {
      $('latest').replaceChildren(...r.data.map((rec) => {
        const li = document.createElement('li'); li.tabIndex = 0;
        PLAN.shown.forEach((f) => { const s = document.createElement('span'); s.textContent = rec.fieldData[f] === undefined ? '' : String(rec.fieldData[f]); li.append(s); });
        return li;
      }));
      if (!r.data.length) $('latest').textContent = 'No records yet.';
      if (PLAN.picture) {
        // A record with no picture has an empty link and is left out; the page's image policy allows only the window's own address.
        const shown = r.data.filter((rec) => rec.fieldData[PLAN.picture]);
        $('pics').replaceChildren(...shown.map((rec) => {
          const img = document.createElement('img'); img.loading = 'lazy';
          img.src = tabularius.image(rec.fieldData[PLAN.picture], 240);
          img.alt = PLAN.shown.length ? String(rec.fieldData[PLAN.shown[0]] || '') : '';
          return img;
        }));
        if (!shown.length) $('pics').textContent = 'No pictures yet.';
      }
    }, (e) => fail($('latest'), e));
  }
  $('print').addEventListener('click', () => tabularius.print().catch((e) => { $('where').textContent = e.message; }));
  show();
  if ($('period')) $('period').addEventListener('change', () => show());
  if (window.tabularius) tabularius.on('refresh', () => show());
</script>
</body>
</html>
`;
}

/** The layouts that are landing pages, which a landing page leaves out of its own list. */
export const HOME_PREFIX = 'Home - ';

/** A hue (0-359) from a name, so each privilege set's landing page has its own colour. */
export function hueOf(name: string): number {
  let n = 0;
  for (const c of name) n = (n * 31 + c.codePointAt(0)!) >>> 0;
  return n % 360;
}

/**
 * A landing page for one privilege set: a greeting, the set's name, and a card for each layout the signed-in account
 * may open (so it shows each set only what it can use), each going to that layout. Its colour comes from the set's name.
 */
export function homePage(title: string, privilegeSet: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(title)}</title>
<style>
  :root { --h: ${hueOf(privilegeSet)}; --bg: hsl(var(--h) 45% 9%); --card: hsl(var(--h) 40% 18% / .75); --line: hsl(var(--h) 60% 70% / .2); --text: #eef0fa; --muted: hsl(var(--h) 25% 75%); --a: hsl(var(--h) 90% 66%); --b: hsl(calc(var(--h) + 60) 90% 62%); }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font: 16px/1.5 system-ui, -apple-system, sans-serif; color: var(--text);
    background: radial-gradient(1000px 520px at 12% -10%, hsl(var(--h) 70% 28%) 0, transparent 62%), radial-gradient(800px 460px at 105% 5%, hsl(calc(var(--h) + 60) 60% 22%) 0, transparent 58%), var(--bg); }
  header { padding: clamp(24px, 6vw, 56px) clamp(20px, 5vw, 48px) 8px; }
  .badge { display: inline-block; padding: 2px 12px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  h1 { margin: 12px 0 0; font-size: clamp(28px, 6vw, 48px); letter-spacing: -.03em; line-height: 1.1; background: linear-gradient(90deg, var(--a), var(--b)); -webkit-background-clip: text; background-clip: text; color: transparent; animation: rise .6s ease both; }
  .muted { color: var(--muted); }
  nav { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 14px; padding: 24px clamp(20px, 5vw, 48px) 48px; }
  button { all: unset; box-sizing: border-box; cursor: pointer; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px 18px 20px; min-height: 84px; display: flex; align-items: flex-end; font-weight: 600; animation: rise .5s ease both; transition: transform .15s ease, border-color .15s ease; }
  button:hover { transform: translateY(-3px); border-color: var(--a); }
  button:focus-visible { outline: 3px solid var(--b); outline-offset: 2px; }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
  @media (prefers-reduced-motion: reduce) { h1, button { animation: none; transition: none; } button:hover { transform: none; } }
  @media (forced-colors: active) { h1 { background: none; color: CanvasText; } }
</style>
</head>
<body>
<header><span class="badge" id="set"></span><h1 id="hello">Welcome</h1><p class="muted" id="where"></p></header>
<nav id="links" aria-label="Where to go"></nav>
<script>
  const SET = ${js(privilegeSet)}, HOME = ${js(HOME_PREFIX)};
  document.getElementById('set').textContent = SET;
  async function show() {
    if (!window.tabularius) { document.getElementById('where').textContent = 'Your layouts show here when opened in Tabularius.'; return; }
    const [who, names] = await Promise.all([tabularius.context(), tabularius.layouts()]);
    document.getElementById('hello').textContent = who.account ? 'Welcome, ' + who.account : 'Welcome';
    const links = names.filter((n) => !n.startsWith(HOME) && n !== who.layout);
    document.getElementById('where').textContent = links.length ? 'Where would you like to go?' : 'There is nothing else here for you to open yet.';
    document.getElementById('links').replaceChildren(...links.map((n, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = n; b.style.animationDelay = (i * .04) + 's';
      b.addEventListener('click', () => tabularius.goToLayout(n).catch((e) => (document.getElementById('where').textContent = e.message)));
      return b;
    }));
  }
  show().catch((e) => (document.getElementById('where').textContent = e.message));
</script>
</body>
</html>
`;
}

/** The script that sends each account to its privilege set's landing page when the file opens. */
export function homeScript(sets: { set: string; layout: string }[]): string {
  const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines: string[] = [];
  sets.forEach((s, i) => {
    lines.push(`${i === 0 ? 'If' : 'Else If'} [ Get ( AccountPrivilegeSetName ) = ${q(s.set)} ]`, `  Go to Layout [ ${q(s.layout)} ]`);
  });
  if (lines.length) lines.push('End If');
  return lines.join('\n');
}
