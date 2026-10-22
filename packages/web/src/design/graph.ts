// Relationships: the relationship graph, with table occurrences you can drag
// around, and panels to add, change and delete occurrences and relationships.

import type { DesignOccurrence, DesignRelationship, GraphReview } from './client.ts';
import { h, button, select, field, check, toast } from './dom.ts';
import type { Studio } from './main.ts';

const SVG = 'http://www.w3.org/2000/svg';
const OPERATORS = ['=', '≠', '<', '≤', '>', '≥', '×'];
const BOX_W = 180;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A color safe to put in a style: #hex, rgb()/rgba() of numbers, or a name (a design made by hand or by an older version may hold anything). */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([0-9.,/ %]+\)|[a-z]+)$/i;
const safeColor = (color: string | undefined): string | undefined => (color && SAFE_COLOR.test(color.trim()) ? color.trim() : undefined);

/** Whether a color (#rrggbb or rgb()) is dark enough to need light text on it. */
function dark(color: string): boolean {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  const rgb = /^rgba?\((\d+)\D+(\d+)\D+(\d+)/.exec(color);
  const [r, g, b] = hex ? hex.slice(1).map((x) => parseInt(x, 16)) : rgb ? rgb.slice(1).map(Number) : [255, 255, 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/** Shortens text with an ellipsis to roughly fit a width in pixels at the graph's 11–12px type. */
const fit = (text: string, width: number) => {
  const max = Math.max(4, Math.floor(width / 6.6));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Box { left: number; top: number; width: number; height: number }

const HEAD_H = 20;
const TABLE_H = 22;
const ROW_H = 16;

/** Occurrences showing all their fields; the rest show only their match fields, as FileMaker's collapsed boxes do. */
const expanded = new Set<string>();
/** Occurrences the review problem last clicked is about, outlined until the background is clicked. */
let flagged: number[] = [];

/** Where each occurrence is drawn: its saved place on the graph, or a grid for ones without. */
function boxes(tos: DesignOccurrence[], heightOf: (t: DesignOccurrence) => number): Map<number, Box> {
  const out = new Map<number, Box>();
  let free = 0;
  // A zero-size box is one whose place wasn't read from the file; lay those out in a grid.
  const where = (t: DesignOccurrence) => (t.graph?.width ? t.graph : undefined);
  const placed = tos.filter(where);
  const bottom = placed.length ? Math.max(...placed.map((t) => where(t)!.top + heightOf(t))) + 60 : 30;
  let rowTop = bottom;
  let rowH = 0;
  for (const t of tos) {
    const height = heightOf(t);
    const g = where(t);
    if (g) out.set(t.id, { left: g.left, top: g.top, width: Math.max(100, g.width), height });
    else {
      const i = free++;
      if (i && i % 6 === 0) {
        rowTop += rowH + 50;
        rowH = 0;
      }
      rowH = Math.max(rowH, height);
      out.set(t.id, { left: 30 + (i % 6) * (BOX_W + 50), top: rowTop, width: BOX_W, height });
    }
  }
  return out;
}

export function graphTab(studio: Studio): HTMLElement {
  const { design } = studio;
  const tos = design.tableOccurrences;
  const sel = studio.selected;
  const zoom = Number(sel.zoom ?? 100) / 100;

  // The fields each box lists: its match fields, or every field when expanded.
  const keys = new Map<number, Set<number>>();
  const key = (to: number, f: number) => (keys.get(to) ?? keys.set(to, new Set()).get(to)!).add(f);
  for (const r of design.relationships) {
    for (const p of r.predicates) {
      key(r.leftTableOccurrenceId, p.leftFieldId);
      key(r.rightTableOccurrenceId, p.rightFieldId);
    }
  }
  const isOpen = (t: DesignOccurrence) => expanded.has(`${design.database}:${t.id}`);
  const rows = new Map(tos.map((t) => {
    const all = fieldsOf(studio, t.id);
    return [t.id, isOpen(t) ? all : all.filter((f) => keys.get(t.id)?.has(f.id))];
  }));
  const at = boxes(tos, (t) => HEAD_H + TABLE_H + rows.get(t.id)!.length * ROW_H + (rows.get(t.id)!.length ? 4 : 0));
  const rowY = (to: number, field: number) => {
    const b = at.get(to)!;
    const i = rows.get(to)!.findIndex((f) => f.id === field);
    return i < 0 ? b.top + b.height / 2 : b.top + HEAD_H + TABLE_H + i * ROW_H + ROW_H / 2;
  };

  const width = Math.max(800, ...[...at.values()].map((b) => b.left + b.width + 60));
  const height = Math.max(500, ...[...at.values()].map((b) => b.top + b.height + 60));
  const canvas = svg('svg', { class: 'd-graph', width: width * zoom, height: height * zoom, viewBox: `0 0 ${width} ${height}` });

  for (const r of design.relationships) {
    const a = at.get(r.leftTableOccurrenceId);
    const b = at.get(r.rightTableOccurrenceId);
    if (!a || !b) continue;
    const g = svg('g', { class: `d-rel${sel.relationship === r.id ? ' selected' : ''}` });
    // A line from field to field for each pair of match fields, leaving each box from its nearer side.
    const rightward = a.left + a.width / 2 <= b.left + b.width / 2;
    const ax = rightward ? a.left + a.width : a.left;
    const bx = rightward ? b.left : b.left + b.width;
    const stub = rightward ? 14 : -14;
    const ys = r.predicates.length ? r.predicates.map((p) => [rowY(r.leftTableOccurrenceId, p.leftFieldId), rowY(r.rightTableOccurrenceId, p.rightFieldId)]) : [[a.top + a.height / 2, b.top + b.height / 2]];
    for (const [ay, by] of ys) {
      const d = `M${ax},${ay} H${ax + stub} L${bx - stub},${by} H${bx}`;
      g.append(svg('path', { d, class: 'd-rel-line' }), svg('path', { d, class: 'd-rel-hit' }));
    }
    const [ay, by] = ys[0];
    const label = svg('text', { x: (ax + bx) / 2, y: (ay + by) / 2 - 4, class: 'd-rel-label', 'text-anchor': 'middle' });
    label.textContent = r.predicates.map((x) => x.operator).join(' ') || '?';
    const tip = svg('title');
    tip.textContent = r.predicates.map((x) => `${r.leftTableOccurrence}::${x.leftField} ${x.operator} ${r.rightTableOccurrence}::${x.rightField}`).join('\n');
    g.append(label, tip);
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      sel.relationship = r.id;
      sel.occurrence = undefined;
      studio.render();
    });
    canvas.append(g);
  }

  for (const t of tos) {
    const b = at.get(t.id)!;
    const g = svg('g', { class: `d-to${sel.occurrence === t.id ? ' selected' : ''}${flagged.includes(t.id) ? ' flagged' : ''}`, transform: `translate(${b.left},${b.top})`, tabindex: 0, 'data-to': t.id });
    g.append(svg('rect', { width: b.width, height: b.height, rx: 6, class: 'd-to-box' }));
    const fill = safeColor(t.color);
    g.append(svg('rect', { width: b.width, height: HEAD_H, rx: 6, class: 'd-to-head', ...(fill ? { style: `fill:${fill}` } : {}) }));
    const tone = fill ? (dark(fill) ? ' on-dark' : ' on-light') : '';
    const name = svg('text', { x: 8, y: 14, class: `d-to-name${tone}` });
    name.textContent = fit(t.name, b.width - 44);
    if (name.textContent !== t.name) name.append(Object.assign(svg('title'), { textContent: t.name }));
    const base = svg('text', { x: 8, y: HEAD_H + 15, class: 'd-to-table' });
    base.textContent = fit(t.file ? `${t.file} (other file)` : t.table ?? '<Table Missing>', b.width - 16);
    g.append(name, base);
    const all = fieldsOf(studio, t.id);
    if (all.length) {
      const open = isOpen(t);
      const toggle = svg('text', { x: b.width - 8, y: 14, class: `d-to-toggle${tone}`, 'text-anchor': 'end', role: 'button', 'aria-label': open ? 'Show only match fields' : 'Show all fields' });
      toggle.textContent = open ? '▾' : `${all.length} ▸`;
      const tip = svg('title');
      tip.textContent = open ? 'Show only match fields' : 'Show all fields';
      toggle.append(tip);
      toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = `${design.database}:${t.id}`;
        if (open) expanded.delete(k);
        else expanded.add(k);
        studio.render();
      });
      g.append(toggle);
    }
    rows.get(t.id)!.forEach((f, i) => {
      const y = HEAD_H + TABLE_H + i * ROW_H;
      const row = svg('g', { class: `d-field${keys.get(t.id)?.has(f.id) ? ' key' : ''}`, 'data-to': t.id, 'data-field': f.id });
      row.append(svg('rect', { x: 1, y, width: b.width - 2, height: ROW_H, class: 'd-field-hit' }));
      const label = svg('text', { x: 12, y: y + 12, class: 'd-field-name' });
      label.textContent = fit(f.name, b.width - 20);
      const tip = svg('title');
      tip.textContent = `${t.name}::${f.name}\nDrag to a field in another occurrence to relate them.`;
      row.append(label, tip);
      relateDrag(row, canvas, studio, t.id, f.id);
      g.append(row);
    });
    drag(g, b, zoom, (moved) => {
      if (moved) void studio.apply([{ op: 'updateOccurrence', occurrence: t.id, graph: { left: Math.round(moved.left), top: Math.round(moved.top), width: b.width, height: b.height } }]);
      else {
        sel.occurrence = t.id;
        sel.relationship = undefined;
        studio.render();
      }
    });
    canvas.append(g);
  }
  canvas.addEventListener('click', () => {
    if (sel.occurrence === undefined && sel.relationship === undefined && !flagged.length) return;
    flagged = [];
    sel.occurrence = undefined;
    sel.relationship = undefined;
    studio.render();
  });

  const zoomBy = (d: number) => {
    sel.zoom = Math.min(200, Math.max(25, (sel.zoom ?? 100) + d));
    studio.render();
  };
  const tools = h('div', { class: 'd-graph-tools' },
    button('−', () => zoomBy(-25), { title: 'Zoom out', 'aria-label': 'Zoom out' }),
    h('span', { class: 'd-muted' }, `${Math.round(zoom * 100)}%`),
    button('+', () => zoomBy(25), { title: 'Zoom in', 'aria-label': 'Zoom in' }),
    button('Tidy up', () => void tidy(studio), { title: 'Arrange the boxes: each group from its anchor, buoys to the right' }),
    h('span', { class: 'd-muted' }, `${plural(tos.length, 'occurrence')} · ${plural(design.relationships.length, 'relationship')} · drag a field onto another occurrence's field to relate them`),
  );
  const occ = tos.find((t) => t.id === sel.occurrence);
  const rel = design.relationships.find((r) => r.id === sel.relationship);
  const panel = h('aside', { class: 'd-panel' }, ...(rel ? relationshipPanel(studio, rel) : occ ? occurrencePanel(studio, occ) : newPanel(studio)));
  return h('div', { class: 'd-graph-layout' }, h('div', { class: 'd-graph-wrap' }, tools, h('div', { class: 'd-graph-scroll' }, canvas)), panel);
}

/**
 * Drag from a field to a field in another occurrence to relate them with "=",
 * as in FileMaker's graph. Dropping on an occurrence's box rather than a field
 * matches the field of the same name, or opens the box's fields to drop on.
 */
function relateDrag(row: SVGGElement, canvas: SVGSVGElement, studio: Studio, to: number, field: number): void {
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const point = (ev: PointerEvent) => {
      const m = canvas.getScreenCTM()?.inverse();
      const p = new DOMPoint(ev.clientX, ev.clientY);
      return m ? p.matrixTransform(m) : p;
    };
    const start = point(e);
    const line = svg('line', { x1: start.x, y1: start.y, x2: start.x, y2: start.y, class: 'd-rel-draft' });
    canvas.append(line);
    canvas.classList.add('relating');
    row.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = point(ev);
      line.setAttribute('x2', String(p.x));
      line.setAttribute('y2', String(p.y));
    };
    const up = (ev: PointerEvent) => {
      row.removeEventListener('pointermove', move);
      row.removeEventListener('pointerup', up);
      line.remove();
      canvas.classList.remove('relating');
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-to]');
      const other = Number(hit?.getAttribute('data-to'));
      if (!hit || !other || other === to) return;
      void relate(studio, to, field, other, hit.getAttribute('data-field') ? Number(hit.getAttribute('data-field')) : undefined);
    };
    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', up);
  });
  row.addEventListener('click', (e) => e.stopPropagation());
}

async function relate(studio: Studio, left: number, leftField: number, right: number, rightField?: number): Promise<void> {
  const { design } = studio;
  const target = design.tableOccurrences.find((t) => t.id === right);
  if (!target) return;
  if (!fieldsOf(studio, right).length || !fieldsOf(studio, left).length) return toast('That occurrence\'s table is in another file this account can\'t design, so its fields aren\'t known here.');
  if (rightField === undefined) {
    const name = fieldsOf(studio, left).find((f) => f.id === leftField)?.name.toLowerCase();
    rightField = fieldsOf(studio, right).find((f) => f.name.toLowerCase() === name)?.id;
    if (rightField === undefined) {
      expanded.add(`${design.database}:${right}`);
      studio.render();
      return toast(`Drop on one of ${target.name}'s fields.`, 'info');
    }
  }
  // Another pair of match fields between the same two occurrences joins the existing relationship.
  const existing = design.relationships.find((r) => r.leftTableOccurrenceId === left && r.rightTableOccurrenceId === right)
    ?? design.relationships.find((r) => r.leftTableOccurrenceId === right && r.rightTableOccurrenceId === left);
  const ok = existing
    ? await studio.apply([{ op: 'updateRelationship', relationship: existing.id, predicates: [
      ...existing.predicates.map((p) => ({ left: p.leftFieldId, operator: p.operator, right: p.rightFieldId })),
      existing.leftTableOccurrenceId === left ? { left: leftField, operator: '=', right: rightField } : { left: rightField, operator: '=', right: leftField },
    ] }], 'Match fields added')
    : await studio.apply([{ op: 'createRelationship', left, right, predicates: [{ left: leftField, operator: '=', right: rightField }] }], 'Relationship created');
  if (!ok) return;
  const r = existing ?? studio.design.relationships.find((x) => x.leftTableOccurrenceId === left && x.rightTableOccurrenceId === right);
  studio.selected.relationship = r?.id;
  studio.selected.occurrence = undefined;
  studio.render();
}

/** Drag a box; calls back with its new place, or undefined for a click. */
function drag(g: SVGGElement, b: Box, zoom: number, done: (moved?: Box) => void): void {
  g.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    g.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / zoom;
      const dy = (ev.clientY - y0) / zoom;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      g.setAttribute('transform', `translate(${Math.max(0, b.left + dx)},${Math.max(0, b.top + dy)})`);
    };
    const up = (ev: PointerEvent) => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      const dx = (ev.clientX - x0) / zoom;
      const dy = (ev.clientY - y0) / zoom;
      done(moved ? { ...b, left: Math.max(0, b.left + dx), top: Math.max(0, b.top + dy) } : undefined);
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
  });
  g.addEventListener('click', (e) => e.stopPropagation());
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done();
  });
}

/** An "Explain with AI" button, when the assistant is on. */
function explain(studio: Studio, question: string): HTMLElement[] {
  return studio.ask ? [button('Explain with AI', () => studio.ask!(question), { title: 'Ask the assistant what this does' })] : [];
}

/** An occurrence's fields: its table's, in this file or (when the server lists them) in the other hosted file it shows. */
function fieldsOf(studio: Studio, toId: number) {
  const { design } = studio;
  const to = design.tableOccurrences.find((t) => t.id === toId);
  if (to?.dataSourceId) return design.dataSources?.find((d) => d.id === to.dataSourceId)?.tables?.find((t) => t.id === to.baseTableId)?.fields ?? [];
  return design.tables.find((t) => t.id === to?.baseTableId)?.fields ?? [];
}

/** Tables an occurrence can show: this file's, then each hosted file's the server lists ("ds:<source>:<table>"). */
function tableChoices(studio: Studio): (HTMLOptionElement | HTMLOptGroupElement)[] {
  const { design } = studio;
  const own = design.tables.map((t) => h('option', { value: String(t.id) }, t.name));
  const others = (design.dataSources ?? []).filter((d) => d.tables?.length).map((d) => h('optgroup', { label: `${d.name} (other file)` },
    ...d.tables!.map((t) => h('option', { value: `ds:${d.id}:${t.id}` }, t.name))));
  return others.length ? [h('optgroup', { label: 'This file' }, ...own), ...others] : own;
}

function newPanel(studio: Studio): HTMLElement[] {
  const { design } = studio;
  const name = h('input', { placeholder: 'Occurrence name' });
  const table = h('select', {}, ...tableChoices(studio)) as HTMLSelectElement;
  const form = h('form', { class: 'd-stack' }, h('h3', {}, 'New table occurrence'), field('Name', name), field('Table', table), h('button', { type: 'submit', class: 'primary' }, 'Add to graph'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const external = /^ds:(\d+):(\d+)$/.exec(table.value);
    const n = name.value.trim() || table.selectedOptions[0]?.textContent || '';
    if (!n) return;
    const change = external ? { op: 'createOccurrence', name: n, file: Number(external[1]), externalTable: Number(external[2]) } : { op: 'createOccurrence', name: n, table: Number(table.value) };
    if (await studio.apply([change])) {
      studio.selected.occurrence = studio.design.tableOccurrences.find((t) => t.name === n)?.id;
      studio.render();
    }
  });
  return [form, h('p', { class: 'd-muted' }, 'Click an occurrence to rename it or relate it to another; click a line to change a relationship.'), reviewPanel(studio)];
}

/** The last review, kept while the design it was made from is the one shown. */
let reviewed: { design: unknown; review: GraphReview } | undefined;

async function review(studio: Studio): Promise<GraphReview> {
  if (reviewed?.design !== studio.design) reviewed = { design: studio.design, review: await studio.client.graph() };
  return reviewed.review;
}

/** Tidies the graph in one change; the toast puts every box back. */
async function tidy(studio: Studio): Promise<void> {
  const { arrange } = await review(studio).catch((e) => (toast(String(e)), { arrange: [] as never[] }));
  if (!arrange.length) return toast('The graph is already tidy.', 'info');
  const before = arrange.map((c) => {
    const to = studio.design.tableOccurrences.find((t) => t.id === (c as unknown as { occurrence: number }).occurrence);
    return { op: 'updateOccurrence', occurrence: to?.id, graph: to?.graph ?? { left: 0, top: 0, width: 0, height: 0 } };
  });
  if (!await studio.apply(arrange)) return;
  toast(`Moved ${arrange.length} ${arrange.length === 1 ? 'box' : 'boxes'}.`, 'info', { label: 'Undo', run: () => void studio.apply(before as never[], 'Put back') });
}

/** What the graph is and what looks wrong in it, with each problem a link to the boxes or line it's about. */
function reviewPanel(studio: Studio): HTMLElement {
  const out = h('section', { class: 'd-stack d-graph-review' }, h('h3', {}, 'About this graph'), h('p', { class: 'd-muted' }, 'Looking it over…'));
  void review(studio).then((r) => {
    const issues = h('ul', { class: 'd-graph-issues' }, ...r.issues.map((i) => {
      const item = h('li', { class: i.severity }, button(i.message, () => {
        const sel = studio.selected;
        flagged = i.occurrences;
        if (i.relationship !== undefined) sel.relationship = i.relationship;
        else sel.occurrence = i.occurrences[0];
        studio.render();
      }, { class: 'quiet', title: 'Show it on the graph' }));
      return item;
    }));
    out.replaceChildren(h('h3', {}, 'About this graph'), ...r.summary.map((line) => h('p', {}, line)),
      ...(r.issues.length ? [issues] : []),
      ...explain(studio, `Explain this relationship graph in plain English: what each group is for, how the tables relate, and what you'd change. Here is what a quick review found:\n${[...r.summary, ...r.issues.map((i) => `- ${i.message}`)].join('\n')}`));
  }, (e) => out.replaceChildren(h('h3', {}, 'About this graph'), h('p', { class: 'd-muted' }, String(e))));
  return out;
}

function occurrencePanel(studio: Studio, to: DesignOccurrence): HTMLElement[] {
  const { design } = studio;
  const name = h('input', { value: to.name });
  const table = h('select', {}, ...tableChoices(studio)) as HTMLSelectElement;
  table.value = to.dataSourceId ? `ds:${to.dataSourceId}:${to.baseTableId}` : String(to.baseTableId ?? '');
  // Another file's occurrence keeps its table; one whose file isn't listed shows the file's name.
  if (to.dataSourceId && table.value === '') table.replaceChildren(h('option', {}, `${to.file ?? 'Other file'} (other file)`));
  table.disabled = !!to.dataSourceId;
  const color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(to.color ?? '') ? to.color! : '#c7d7ee' });
  const edit = h('form', { class: 'd-stack' }, h('h3', {}, 'Table occurrence'), field('Name', name), field('Table', table), field('Color', color),
    h('div', { class: 'd-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Save'),
      ...explain(studio, `Explain the table occurrence "${to.name}": which table it shows, how it is related to the others, and which layouts, portals and formulas use it.`),
      button('Delete…', () => {
        if (confirm(`Delete "${to.name}" and its relationships? Formulas that use it will show <Table Missing>.`)) {
          studio.selected.occurrence = undefined;
          void studio.apply([{ op: 'deleteOccurrence', occurrence: to.id }]);
        }
      }, { class: 'danger' })));
  edit.addEventListener('submit', (e) => {
    e.preventDefault();
    const change: Record<string, unknown> = { op: 'updateOccurrence', occurrence: to.id };
    if (name.value.trim() !== to.name) change.name = name.value.trim();
    if (!to.dataSourceId && Number(table.value) !== to.baseTableId) change.table = Number(table.value);
    if (color.value !== (to.color ?? '#c7d7ee')) change.color = color.value;
    void studio.apply([change as never], 'Saved');
  });

  const others = design.tableOccurrences.filter((t) => t.id !== to.id && fieldsOf(studio, t.id).length);
  const other = select(others.map((t) => [String(t.id), t.name] as [string, string]), String(others[0]?.id ?? ''));
  const left = select(fieldsOf(studio, to.id).map((f) => [String(f.id), f.name] as [string, string]), String(fieldsOf(studio, to.id)[0]?.id ?? ''));
  const op = select(OPERATORS, '=');
  const right = select([], '');
  const fillRight = () => {
    right.replaceChildren(...fieldsOf(studio, Number(other.value)).map((f) => h('option', { value: String(f.id) }, f.name)));
  };
  other.addEventListener('change', fillRight);
  fillRight();
  const relate = h('form', { class: 'd-stack' }, h('h3', {}, 'Relate to'), field('Occurrence', other), h('div', { class: 'd-relate' }, left, op, right),
    h('button', { type: 'submit', class: 'primary' }, 'Create relationship'));
  relate.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!left.value || !right.value) return;
    await studio.apply([{ op: 'createRelationship', left: to.id, right: Number(other.value), predicates: [{ left: Number(left.value), operator: op.value, right: Number(right.value) }] }], 'Relationship created');
  });
  if (!fieldsOf(studio, to.id).length) relate.hidden = true;
  return [edit, relate];
}

function relationshipPanel(studio: Studio, r: DesignRelationship): HTMLElement[] {
  const lf = fieldsOf(studio, r.leftTableOccurrenceId);
  const rf = fieldsOf(studio, r.rightTableOccurrenceId);
  const rows = h('div', { class: 'd-stack' });
  const addRow = (p?: DesignRelationship['predicates'][number]) => {
    const l = select(lf.map((f) => [String(f.id), f.name] as [string, string]), String(p?.leftFieldId ?? lf[0]?.id ?? ''));
    const o = select(OPERATORS, p?.operator ?? '=');
    const rr = select(rf.map((f) => [String(f.id), f.name] as [string, string]), String(p?.rightFieldId ?? rf[0]?.id ?? ''));
    const row = h('div', { class: 'd-row d-predicate' }, l, o, rr, button('×', () => row.remove(), { title: 'Remove', class: 'quiet' }));
    rows.append(row);
  };
  r.predicates.forEach(addRow);
  const editable = lf.length > 0 && rf.length > 0;
  // FileMaker's per-side options, under each occurrence's name.
  const opts = {
    leftCreate: check('Allow creation of records in this table via this relationship', !!r.leftCreate),
    leftDelete: check(`Delete records in this table when a record in ${r.rightTableOccurrence ?? 'the other'} is deleted`, !!r.leftDelete),
    rightCreate: check('Allow creation of records in this table via this relationship', !!r.rightCreate),
    rightDelete: check(`Delete records in this table when a record in ${r.leftTableOccurrence ?? 'the other'} is deleted`, !!r.rightDelete),
  };
  const side = (title: string | undefined, create: { el: HTMLElement }, del: { el: HTMLElement }) => h('fieldset', {}, h('legend', {}, title ?? '?'), create.el, del.el);
  const form = h('form', { class: 'd-stack' },
    h('h3', {}, `${r.leftTableOccurrence ?? '?'}  ⟷  ${r.rightTableOccurrence ?? '?'}`),
    rows,
    editable ? button('Add match fields', () => addRow()) : h('p', { class: 'd-muted' }, 'One side\'s table is in another file this account can\'t design, so its match fields can\'t be changed here.'),
    editable ? h('div', { class: 'd-rel-options' }, side(r.leftTableOccurrence, opts.leftCreate, opts.leftDelete), side(r.rightTableOccurrence, opts.rightCreate, opts.rightDelete)) : undefined,
    h('div', { class: 'd-actions' }, editable ? h('button', { type: 'submit', class: 'primary' }, 'Save') : undefined,
      ...explain(studio, `Explain the relationship between ${r.leftTableOccurrence ?? '?'} and ${r.rightTableOccurrence ?? '?'}: which records it matches, what its options do, and what uses it.`),
      button('Delete…', () => {
        if (confirm('Delete this relationship? Portals and formulas that go through it will find no related records.')) {
          studio.selected.relationship = undefined;
          void studio.apply([{ op: 'deleteRelationship', relationship: r.id }]);
        }
      }, { class: 'danger' })),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const predicates = [...rows.querySelectorAll('.d-predicate')].map((row) => {
      const [l, o, rr] = [...row.querySelectorAll('select')] as HTMLSelectElement[];
      return { left: Number(l.value), operator: o.value, right: Number(rr.value) };
    });
    if (!predicates.length) return void alert('A relationship needs at least one pair of match fields.');
    void studio.apply([{
      op: 'updateRelationship', relationship: r.id, predicates,
      leftCreate: opts.leftCreate.input.checked, rightCreate: opts.rightCreate.input.checked,
      leftDelete: opts.leftDelete.input.checked, rightDelete: opts.rightDelete.input.checked,
    }], 'Saved');
  });
  return [form];
}
