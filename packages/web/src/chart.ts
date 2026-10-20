// Draws a FileMaker chart as SVG from its data: column, bar (plain or
// stacked), line, area, pie, scatter and bubble charts, with a title, axis
// titles, value gridlines and a legend.

import type { Chart, ChartData } from './types.ts';

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#3879a3', '#d89241', '#5ca75c', '#c65454', '#8a6bb1', '#55a7a8', '#c7b84a', '#8f6f55', '#d27eb5', '#888888'];
type Part = 'title' | 'xLabels' | 'xTitle' | 'yLabels' | 'yTitle' | 'legend';
type Text = { size: number; color: string };
export const DEFAULT_TEXT: Record<Part, Text> = {
  title: { size: 15, color: '#333' }, xLabels: { size: 12, color: '#555' }, xTitle: { size: 12, color: '#333' },
  yLabels: { size: 12, color: '#555' }, yTitle: { size: 12, color: '#333' }, legend: { size: 12, color: '#333' },
};

type Attrs = Record<string, string | number>;

function el(name: string, attrs: Attrs = {}, text?: string): SVGElement {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** About how wide text is at a size, without measuring it. */
const textWidth = (s: string, size: number) => s.length * size * 0.56;

/** Round tick values covering [min, max]: steps of 1, 2 or 5 times a power of ten. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (min === max) [min, max] = min === 0 ? [0, 1] : [Math.min(0, min), Math.max(0, max)];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  const at = (k: number) => Number((k * step).toPrecision(12));
  let k = Math.floor(min / step);
  do out.push(at(k++));
  while (out[out.length - 1] < max);
  return out;
}

/** The value axis's ticks: round ones covering the values, or running between the bounds Chart Setup fixes. */
export function valueTicks(values: number[], min?: number, max?: number): number[] {
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  if (!(hi > lo)) return ticks(Math.min(...values), Math.max(...values));
  const out = ticks(lo, hi).filter((t) => (min === undefined || t >= min) && (max === undefined || t <= max));
  if (min !== undefined && out[0] !== min) out.unshift(min);
  if (max !== undefined && out[out.length - 1] !== max) out.push(max);
  return out;
}

const label = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function renderChart(chart: Chart, data: ChartData | undefined, width: number, height: number): SVGSVGElement {
  const svg = el('svg', { class: 'fm-chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' }) as SVGSVGElement;
  const [top, bottom] = chart.background ?? ['#fff', '#fff'];
  const grad = `g${Math.random().toString(36).slice(2, 8)}`;
  const defs = el('defs');
  const lg = el('linearGradient', { id: grad, x1: 0, y1: 0, x2: 0, y2: 1 });
  lg.append(el('stop', { offset: 0, 'stop-color': top }), el('stop', { offset: 1, 'stop-color': bottom }));
  defs.append(lg);
  svg.append(defs, el('rect', { width, height, fill: `url(#${grad})` }));
  if (data?.title) svg.setAttribute('aria-label', data.title);
  if (!data) return svg;
  // Without a title a screen reader would hear only "image": say what it shows, by category.
  if (!data.title) {
    const shown = data.categories.slice(0, 12).map((c, i) => `${c} ${data.series.map((x) => x.values[i] ?? '').join(' / ')}`);
    svg.setAttribute('aria-label', `${data.yTitle || data.series.map((x) => x.name).join(', ') || 'Chart'}${data.xTitle ? ` by ${data.xTitle}` : ''}: ${shown.join(', ')}${data.categories.length > 12 ? ', …' : ''}`);
  }
  const text = (part: Part): Text => {
    const t = chart.text?.[part];
    return t && t.size > 0 ? t : DEFAULT_TEXT[part];
  };

  const pad = Math.min(8, width / 30, height / 30);
  let y0 = pad;
  if (data.title) {
    const t = text('title');
    for (const line of data.title.split('\n')) {
      y0 += t.size + 2;
      svg.append(el('text', { x: width / 2, y: y0, 'text-anchor': 'middle', 'font-size': t.size, 'font-weight': 'bold', fill: t.color }, line));
    }
    y0 += pad;
  }
  const area = { left: pad, top: y0, right: width - pad, bottom: height - pad };
  const pie = chart.type === 'pie';
  // Legend: the named series, or a pie's slices.
  const entries = pie ? data.categories.slice(0, data.series[0]?.values.length) : data.series.length > 1 ? data.series.map((s) => s.name) : [];
  if (entries.some((e) => e)) {
    const t = text('legend');
    const box = Math.max(4, t.size * 0.8);
    const w = Math.min(width / 3, Math.max(...entries.map((e) => textWidth(e, t.size))) + box + 6);
    const g = el('g', { class: 'fm-chart-legend' });
    entries.forEach((e, i) => {
      const y = area.top + pad + i * (t.size + 4);
      g.append(el('rect', { x: area.right - w, y, width: box, height: box, fill: PALETTE[i % PALETTE.length] }));
      g.append(el('text', { x: area.right - w + box + 4, y: y + box, 'font-size': t.size, fill: t.color }, e));
    });
    svg.append(g);
    area.right -= w + pad;
  }
  if (pie) drawPie(svg, data, area);
  else drawAxes(svg, chart, data, area, text);
  return svg;
}

function drawPie(svg: SVGElement, data: ChartData, area: { left: number; top: number; right: number; bottom: number }): void {
  const all = data.series[0]?.values ?? [];
  // A pie with category labels has one slice per label.
  const values = (data.categories.length ? all.slice(0, data.categories.length) : all).map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return;
  const cx = (area.left + area.right) / 2;
  const cy = (area.top + area.bottom) / 2;
  const r = Math.max(10, Math.min(area.right - area.left, area.bottom - area.top) / 2 - 4);
  let a = -Math.PI / 2;
  values.forEach((v, i) => {
    if (!v) return;
    const sweep = (v / total) * Math.PI * 2;
    const color = PALETTE[i % PALETTE.length];
    const title = `${data.categories[i] ?? ''}: ${label(v)}`;
    let shape: SVGElement;
    if (sweep >= Math.PI * 2 - 1e-9) shape = el('circle', { cx, cy, r, fill: color });
    else {
      const [x1, y1] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const [x2, y2] = [cx + r * Math.cos(a + sweep), cy + r * Math.sin(a + sweep)];
      shape = el('path', { d: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`, fill: color, stroke: '#fff', 'stroke-width': 1 });
    }
    shape.append(el('title', {}, title));
    svg.append(shape);
    if (sweep > 0.45 && r > 30) {
      const mid = a + sweep / 2;
      svg.append(el('text', { x: cx + r * 0.65 * Math.cos(mid), y: cy + r * 0.65 * Math.sin(mid) + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff' },
        `${Math.round((v / total) * 100)}%`));
    }
    a += sweep;
  });
}

function drawAxes(svg: SVGElement, chart: Chart, data: ChartData, area: { left: number; top: number; right: number; bottom: number }, text: (part: Part) => Text): void {
  const horizontal = chart.type === 'bar' || chart.type === 'stacked-bar';
  const stacked = chart.type === 'stacked-column' || chart.type === 'stacked-bar';
  const xy = chart.type === 'scatter' || chart.type === 'bubble';
  const n = xy ? 0 : Math.max(data.categories.length, ...data.series.map((s) => s.values.length));
  // Value range: stacked charts add up each category's positive and negative values.
  const values: number[] = [0];
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0;
      for (const s of data.series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      values.push(pos, neg);
    }
  } else for (const s of data.series) for (const v of s.values) if (v !== null) values.push(v);
  const vt = valueTicks(values, data.yMin, data.yMax);
  const xs = xy ? data.series.flatMap((s) => (s.x ?? s.values.map((_, i) => i + 1)).filter((v): v is number => v !== null)) : [];
  // Bubbles get room around the outermost ones.
  const spread = chart.type === 'bubble' && xs.length ? (Math.max(...xs) - Math.min(...xs)) * 0.1 : 0;
  const xt = xy ? ticks(Math.min(...xs, ...(chart.type === 'bubble' ? [] : [0])) - spread, Math.max(...xs, 1) + spread) : [];

  // Room for the axis labels and titles. The x axis is the categories' (or a scatter chart's x values), whichever way it runs.
  const xl = text('xLabels');
  const yl = text('yLabels');
  const xT = text('xTitle');
  const yT = text('yTitle');
  const valueLabels = vt.map(label);
  const catLabels = xy ? xt.map(label) : data.categories.slice(0, n);
  if (data.yTitle) area.left += yT.size + 4;
  if (data.xTitle) area.bottom -= xT.size + 4;
  const [left, below] = horizontal ? [xl, yl] : [yl, xl];
  const leftLabels = horizontal ? catLabels : valueLabels;
  area.left += Math.min((area.right - area.left) / 3, Math.max(0, ...leftLabels.map((s) => textWidth(s, left.size)))) + 4;
  area.bottom -= below.size + 4;
  area.top += yl.size / 2;
  if (area.right - area.left < 20 || area.bottom - area.top < 20) return;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const vmin = vt[0];
  const vmax = vt[vt.length - 1];
  // Position of a value along the value axis, and of a category's slot along the other.
  // Values beyond a fixed axis stop at its end.
  const vpos = (value: number) => {
    const v = Math.max(vmin, Math.min(vmax, value));
    return horizontal ? area.left + ((v - vmin) / (vmax - vmin)) * W : area.bottom - ((v - vmin) / (vmax - vmin)) * H;
  };
  const slot = (horizontal ? H : W) / Math.max(1, n);
  const cpos = (i: number) => (horizontal ? area.top + slot * (i + 0.5) : area.left + slot * (i + 0.5));
  const xmin = xt[0];
  const xmax = xt[xt.length - 1];
  const xpos = (v: number) => area.left + ((v - xmin) / (xmax - xmin)) * W;

  const grid = el('g', { stroke: '#ddd', 'stroke-width': 1 });
  const labels = el('g');
  const put = (t: Text, attrs: Attrs, s: string) => labels.append(el('text', { 'font-size': t.size, fill: t.color, ...attrs }, s));
  // Value labels, thinned out when they would overlap.
  const vevery = Math.ceil((horizontal ? Math.max(...valueLabels.map((s) => textWidth(s, yl.size))) + 6 : yl.size + 2) / ((horizontal ? W : H) / Math.max(1, vt.length - 1)));
  vt.forEach((v, i) => {
    const p = vpos(v);
    if (horizontal) grid.append(el('line', { x1: p, y1: area.top, x2: p, y2: area.bottom }));
    else grid.append(el('line', { x1: area.left, y1: p, x2: area.right, y2: p }));
    if (i % Math.max(1, vevery)) return;
    if (horizontal) put(yl, { x: p, y: area.bottom + yl.size + 2, 'text-anchor': 'middle' }, valueLabels[i]);
    else put(yl, { x: area.left - 4, y: p + yl.size / 3, 'text-anchor': 'end' }, valueLabels[i]);
  });
  if (xy) {
    const every = Math.ceil((Math.max(...catLabels.map((s) => textWidth(s, xl.size))) + 6) / (W / Math.max(1, xt.length - 1)));
    xt.forEach((v, i) => {
      if (!(i % Math.max(1, every))) put(xl, { x: xpos(v), y: area.bottom + xl.size + 2, 'text-anchor': 'middle' }, label(v));
    });
  } else {
    // Category labels, skipping some when they would run into each other.
    const every = horizontal ? Math.ceil((xl.size + 2) / slot) : Math.ceil((Math.max(0, ...catLabels.map((s) => textWidth(s, xl.size))) + 6) / slot);
    catLabels.forEach((c, i) => {
      if (i % Math.max(1, every)) return;
      if (horizontal) put(xl, { x: area.left - 4, y: cpos(i) + xl.size / 3, 'text-anchor': 'end' }, c);
      else put(xl, { x: cpos(i), y: area.bottom + xl.size + 2, 'text-anchor': 'middle' }, c);
    });
  }
  if (data.xTitle) put(xT, { x: (area.left + area.right) / 2, y: area.bottom + below.size + xT.size + 6, 'text-anchor': 'middle' }, data.xTitle);
  if (data.yTitle) {
    const y = (area.top + area.bottom) / 2;
    const x = Math.max(yT.size, area.left - Math.max(0, ...leftLabels.map((s) => textWidth(s, left.size))) - 8);
    put(yT, { x, y, 'text-anchor': 'middle', transform: `rotate(-90 ${x} ${y})` }, data.yTitle);
  }
  svg.append(grid, labels);
  const zero = vpos(Math.max(vmin, Math.min(vmax, 0)));
  svg.append(horizontal
    ? el('line', { x1: zero, y1: area.top, x2: zero, y2: area.bottom, stroke: '#888' })
    : el('line', { x1: area.left, y1: zero, x2: area.right, y2: zero, stroke: '#888' }));

  const marks = el('g');
  const tip = (shape: SVGElement, s: { name: string }, i: number, v: number) => {
    shape.append(el('title', {}, `${s.name ? `${s.name} · ` : ''}${data.categories[i] ?? ''}${data.categories[i] !== undefined ? ': ' : ''}${label(v)}`));
    return shape;
  };
  if (chart.type === 'column' || chart.type === 'bar' || stacked) {
    const groups = stacked ? 1 : data.series.length;
    const bw = (slot * 0.7) / groups;
    const pos = new Array<number>(n).fill(0);
    const neg = new Array<number>(n).fill(0);
    data.series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length];
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        let from = 0;
        if (stacked) {
          from = v >= 0 ? pos[i] : neg[i];
          if (v >= 0) pos[i] += v;
          else neg[i] += v;
        }
        const a = vpos(from);
        const b = vpos(from + v);
        const off = cpos(i) - slot * 0.35 + (stacked ? 0 : si * bw);
        const rect = horizontal
          ? el('rect', { x: Math.min(a, b), y: off, width: Math.abs(b - a), height: bw, fill: color })
          : el('rect', { x: off, y: Math.min(a, b), width: bw, height: Math.abs(b - a), fill: color });
        marks.append(tip(rect, s, i, v));
      }
    });
  } else if (chart.type === 'line' || chart.type === 'area') {
    data.series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length];
      const pts = s.values.slice(0, n).map((v, i) => (v === null ? undefined : [cpos(i), vpos(v)] as const)).filter((p): p is readonly [number, number] => !!p);
      if (!pts.length) return;
      const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
      if (chart.type === 'area') marks.append(el('polygon', { points: `${pts[0][0]},${zero} ${line} ${pts[pts.length - 1][0]},${zero}`, fill: color, 'fill-opacity': 0.6, stroke: color }));
      else marks.append(el('polyline', { points: line, fill: 'none', stroke: color, 'stroke-width': 2 }));
      s.values.slice(0, n).forEach((v, i) => {
        if (v !== null && chart.type === 'line') marks.append(tip(el('circle', { cx: cpos(i), cy: vpos(v), r: 3, fill: color }), s, i, v));
      });
    });
  } else {
    const sizes = data.series.flatMap((s) => (s.sizes ?? []).filter((v): v is number => v !== null).map(Math.abs));
    const maxSize = Math.max(1, ...sizes);
    const maxR = Math.max(4, Math.min(W, H) / 10);
    data.series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length];
      s.values.forEach((v, i) => {
        const x = s.x ? s.x[i] : i + 1;
        if (v === null || x === null || x === undefined) return;
        const size = s.sizes?.[i];
        const r = chart.type === 'bubble' ? Math.max(2, Math.sqrt(Math.abs(size ?? 0) / maxSize) * maxR) : 4;
        const dot = el('circle', { cx: xpos(x), cy: vpos(v), r, fill: color, 'fill-opacity': chart.type === 'bubble' ? 0.6 : 1 });
        dot.append(el('title', {}, `${s.name ? `${s.name}: ` : ''}${label(x)}, ${label(v)}${size !== undefined && size !== null ? ` (${label(size)})` : ''}`));
        marks.append(dot);
      });
    });
  }
  svg.append(marks);
}
