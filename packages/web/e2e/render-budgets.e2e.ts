// How long the web client takes to draw the layouts that stress it: 1,500 objects, a list of 10,000 records, a table
// view with 40 columns, a portal of 500 rows, 30 tab panels with 30 popovers, and a chart. Each is timed in the
// page from the layout menu's change to the content on screen and the main thread free again, with the longest
// stretch the page was blocked and how many elements it built. The limits are three times what a CI runner takes
// (see docs/performance.md for the numbers and the machine), so a slow runner passes and a real slowdown does not.
// The times go into the output and, when TABULARIUS_PERF_OUT is set, a file beside the server's performance numbers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/design.ts';
import type { LayoutObject } from '../src/types.ts';
import { host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

const RECORDS = 10_000;
const COLUMNS = 40;
const PORTAL_ROWS = 500;
const PANELS = 30;
const POPOVERS = 30;
const anchors = { left: true, top: true, right: false, bottom: false };
const box = (top: number, left: number, height = 22, width = 120) => ({ top, left, bottom: top + height, right: left + width });

interface Result { name: string; paintMs: number; freeMs: number; blockedMs: number; elements: number }
const results: Result[] = [];

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Perf'] });
  const store = hosted.store('Perf');
  const columns = Array.from({ length: COLUMNS }, (_, i) => ({ name: `C${i + 1}` }));
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Qty', type: 'number' }, ...columns] },
    { op: 'createTable', name: 'Owners', fields: [{ name: 'Id', type: 'number' }, { name: 'Label' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'OwnerId', type: 'number' }, { name: 'Item' }, { name: 'Note' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Owners', right: 'Lines', predicates: [{ left: 'Id', right: 'OwnerId' }], allowCreation: 'right' },
  ] as DesignOp[]);
  for (let i = 0; i < RECORDS; i++) {
    store.create('Items', { Name: `Item ${i}`, Qty: i % 97, ...Object.fromEntries(columns.map((c, k) => [c.name, `v${i}-${k}`])) });
  }
  store.create('Owners', { Id: 1, Label: 'Owner' });
  for (let i = 0; i < PORTAL_ROWS; i++) store.create('Lines', { OwnerId: 1, Item: `Line ${i}`, Note: `Note ${i}`, Amount: i });

  const field = (id: number, table: string, name: string, top: number, left: number): LayoutObject => {
    const t = store.schema.tableOccurrences.find((x) => x.name === table)!;
    const f = store.schema.tables.find((x) => x.name === table)!.fields.find((x) => x.name === name)!;
    return { id, kind: 'field', type: 1, anchors, style: {}, bounds: box(top, left),
      field: { tableOccurrenceId: t.id, fieldId: f.id, tableOccurrence: table, field: name, display: 'edit', repetitions: 1 } } as LayoutObject;
  };
  const text = (id: number, label: string, top: number, left: number): LayoutObject => ({ id, kind: 'text', type: 0, anchors, style: {}, bounds: box(top, left, 18, 100), text: label }) as LayoutObject;

  // 1,500 objects: 500 fields and 1,000 labels, ten to a row.
  const dense: LayoutObject[] = [];
  for (let i = 0; i < 500; i++) {
    const row = Math.floor(i / 10), col = i % 10;
    dense.push(text(1000 + i, `Label ${i}`, 10 + row * 50, 10 + col * 130));
    dense.push(field(2000 + i, 'Items', `C${(i % COLUMNS) + 1}`, 28 + row * 50, 10 + col * 130));
    dense.push(text(3000 + i, `Note ${i}`, 50 + row * 50, 10 + col * 130));
  }
  store.applyDesign([
    { op: 'createLayout', name: 'Dense', occurrence: 'Items', design: { objects: dense } },
    { op: 'createLayout', name: 'List', occurrence: 'Items', design: { view: 'list' } },
    { op: 'createLayout', name: 'Wide', occurrence: 'Items', design: { view: 'table' } },
  ] as DesignOp[]);
  const body = store.design('Dense')!.parts.map((p) => p.kind === 'body' ? { ...p, height: 2600 } : p.kind === 'footer' ? { ...p, top: 2700 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Dense', design: { parts: body } }] as DesignOp[]);

  // A portal of 500 related rows that scrolls.
  const lines = store.schema.tableOccurrences.find((t) => t.name === 'Lines')!;
  const lineField = (id: number, name: string, left: number): LayoutObject => {
    const f = store.schema.tables.find((x) => x.name === 'Lines')!.fields.find((x) => x.name === name)!;
    return { id, kind: 'field', type: 1, anchors, style: {}, bounds: box(182, left, 22, 110),
      field: { tableOccurrenceId: lines.id, fieldId: f.id, tableOccurrence: 'Lines', field: name, display: 'edit', repetitions: 1 } } as LayoutObject;
  };
  const portal = {
    id: 500, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 180, left: 10, bottom: 420, right: 480 },
    portal: { tableOccurrenceId: lines.id, tableOccurrence: 'Lines', rows: 10, initialRow: 1, scrolling: true },
    children: [lineField(501, 'Item', 12), lineField(502, 'Note', 130), lineField(503, 'Amount', 250)],
  } as unknown as LayoutObject;
  store.applyDesign([{ op: 'createLayout', name: 'Portal', occurrence: 'Owners', design: { objects: [portal] } }] as DesignOp[]);

  // 30 tab panels of 20 labels each, 30 popover buttons with a popover of 10 labels each, and a chart.
  const panels = Array.from({ length: PANELS }, (_, p) => ({
    id: 600 + p, kind: 'tab-panel', type: 0, anchors, style: {}, name: `Tab ${p + 1}`, text: `Tab ${p + 1}`,
    bounds: box(60, 10, 300, 600), tab: { left: p * 60, width: 58 },
    children: Array.from({ length: 20 }, (_, i) => text(700 + p * 20 + i, `Panel ${p + 1} label ${i}`, 90 + i * 10, 20 + (i % 5) * 110)),
  })) as unknown as LayoutObject[];
  const tabs = { id: 599, kind: 'tab-control', type: 0, anchors, style: {}, bounds: box(40, 10, 340, 640), tabHeight: 24, children: panels } as unknown as LayoutObject;
  const popovers: LayoutObject[] = [];
  for (let i = 0; i < POPOVERS; i++) {
    popovers.push({ id: 1500 + i, kind: 'popover-button', type: 0, anchors, style: {}, bounds: box(10, 700 + (i % 3) * 90, 22, 80), text: `More ${i + 1}`, target: 1600 + i } as LayoutObject);
    popovers.push({ id: 1600 + i, kind: 'popover', type: 0, anchors, style: {}, bounds: box(40, 700, 120, 220), titleBar: true, text: `Details ${i + 1}`,
      children: Array.from({ length: 10 }, (_, k) => text(1700 + i * 10 + k, `Popover ${i + 1} label ${k}`, 60 + k * 10, 710)) } as unknown as LayoutObject);
  }
  const chart = { id: 2900, kind: 'chart', type: 0, anchors, style: {}, bounds: box(400, 10, 240, 480),
    chart: { type: 'column', source: 'found-set', title: 'Qty', series: [{ data: 'Items::Qty' }], categories: 'Items::Name' } } as unknown as LayoutObject;
  store.applyDesign([
    { op: 'createLayout', name: 'Panels', occurrence: 'Items', design: { objects: [tabs, ...popovers] } },
    { op: 'createLayout', name: 'Chart', occurrence: 'Items', design: { objects: [chart] } },
  ] as DesignOp[]);

  store.setPassword('Admin', 'perf-secret-1', '[Full Access]');
  browser = await launch();
  page = await window(browser);
  await signIn(page, hosted.url, 'Perf', 'Admin', 'perf-secret-1');
});
after(async () => {
  await browser?.close();
  await hosted?.close();
  const out = process.env.TABULARIUS_PERF_OUT;
  if (!out || !results.length) return;
  const path = out.replace(/(\.json)?$/, '-render.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), render: results }, null, 2));
});

/**
 * Changes the layout menu and times it in the page: until `ready` finds something on screen and a frame has been
 * drawn (paint), until the main thread then runs a task of its own (free), and how long it was blocked on the way.
 */
async function draw(name: string, ready: string): Promise<Result> {
  const result = await page.evaluate(async ({ layout, ready }) => {
    const select = document.querySelector<HTMLSelectElement>('select.layout-menu')!;
    let blocked = 0;
    const observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) blocked += e.duration; });
    observer.observe({ entryTypes: ['longtask'] });
    const t0 = performance.now();
    select.value = layout;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const paintMs = await new Promise<number>((resolve) => {
      const look = () => {
        if (new Function(`return (${ready});`)()) requestAnimationFrame(() => resolve(performance.now() - t0));
        else if (performance.now() - t0 > 60_000) resolve(-1);
        else requestAnimationFrame(look);
      };
      look();
    });
    const freeMs = await new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - t0), 0));
    await new Promise((r) => setTimeout(r, 300));
    observer.disconnect();
    return { paintMs, freeMs, blockedMs: blocked, elements: document.querySelectorAll('*').length };
  }, { layout: name, ready });
  return { name, ...Object.fromEntries(Object.entries(result).map(([k, v]) => [k, Math.round(v)])) } as Result;
}

/**
 * What each may take: three times the numbers in docs/performance.md (the elements, which don't depend on the
 * machine), and for times that much or a floor, since a few milliseconds measured would otherwise fail on any
 * slow runner. `elements` is also what keeps the 10,000-record list drawing only the rows in view.
 */
const BUDGET: Record<string, { paintMs: number; freeMs: number; blockedMs: number; elements: number }> = {
  Dense: { paintMs: 600, freeMs: 600, blockedMs: 400, elements: 9_600 },
  List: { paintMs: 500, freeMs: 500, blockedMs: 300, elements: 2_200 },
  Wide: { paintMs: 700, freeMs: 700, blockedMs: 600, elements: 10_800 },
  Portal: { paintMs: 500, freeMs: 500, blockedMs: 300, elements: 11_000 },
  Panels: { paintMs: 500, freeMs: 500, blockedMs: 300, elements: 4_600 },
  Chart: { paintMs: 1_200, freeMs: 1_200, blockedMs: 700, elements: 30_500 },
};

const READY: Record<string, string> = { List: "document.querySelector('.list > *')", Wide: "document.querySelector('table tbody tr')" };
const overTime = (name: string, r: Result) => {
  const b = BUDGET[name];
  return r.paintMs === -1 || r.paintMs > b.paintMs || r.freeMs > b.freeMs || r.blockedMs > b.blockedMs;
};

/**
 * Draws `name` and checks it against its budget. A runner shared with other jobs can stall one draw for seconds (a
 * chart that takes 1.3 s on a quiet Mac took 4.6 s beside two other jobs), so a draw over a time budget gets two more
 * tries, each after drawing a different layout so the menu change really redraws, and the fastest counts. A real
 * slowdown is slow every time and still fails; the element budget never gets a second try.
 */
async function measure(name: string, ready: string): Promise<Result> {
  let r = await draw(name, ready);
  for (let attempt = 1; attempt < 3 && overTime(name, r); attempt++) {
    const other = name === 'List' ? 'Wide' : 'List';
    await draw(other, READY[other]);
    const again = await draw(name, ready);
    console.log(`render ${name}: over its time budget (paint ${r.paintMs} ms, free ${r.freeMs} ms, blocked ${r.blockedMs} ms); try ${attempt + 1}: paint ${again.paintMs} ms, free ${again.freeMs} ms, blocked ${again.blockedMs} ms`);
    if (again.paintMs !== -1 && (r.paintMs === -1 || again.paintMs + again.freeMs + again.blockedMs < r.paintMs + r.freeMs + r.blockedMs)) r = again;
  }
  results.push(r);
  console.log(`render ${name}: paint ${r.paintMs} ms, free ${r.freeMs} ms, blocked ${r.blockedMs} ms, ${r.elements} elements`);
  assert.notEqual(r.paintMs, -1, `${name} was not on screen after a minute`);
  const b = BUDGET[name];
  assert.ok(r.paintMs <= b.paintMs, `${name} took ${r.paintMs} ms to draw; the budget is ${b.paintMs} ms`);
  assert.ok(r.freeMs <= b.freeMs, `${name} kept the page busy for ${r.freeMs} ms; the budget is ${b.freeMs} ms`);
  assert.ok(r.blockedMs <= b.blockedMs, `${name} blocked the page for ${r.blockedMs} ms in long tasks; the budget is ${b.blockedMs} ms`);
  assert.ok(r.elements <= b.elements, `${name} built ${r.elements} elements; the budget is ${b.elements}`);
  assert.deepEqual(page.errors, []);
  return r;
}

const at = (id: number, inside = '') => `document.querySelector('.fm[data-id="${id}"] ${inside}')`;
test('1,500 objects on one layout', { skip, timeout: 300_000 }, async () => { await measure('Dense', at(3499)); });
test('a list of 10,000 records', { skip, timeout: 300_000 }, async () => { await measure('List', "document.querySelector('.list > *')"); });
test('table view with 40 columns', { skip, timeout: 300_000 }, async () => { await measure('Wide', "document.querySelector('table tbody tr')"); });
test('a portal of 500 related records shows every one of them', { skip, timeout: 300_000 }, async () => {
  await measure('Portal', `document.querySelectorAll('.fm[data-id="500"] .fm-portal-row[data-row]').length >= ${PORTAL_ROWS}`);
  // The record came with 50; the others are fetched, in order, and the empty last row stays last.
  const items = await page.locator('.fm[data-id="500"] .fm-portal-row[data-row] .fm[data-id="501"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  assert.equal(items.length, PORTAL_ROWS);
  assert.deepEqual(items.slice(0, 2), ['Line 0', 'Line 1']);
  assert.equal(items[PORTAL_ROWS - 1], `Line ${PORTAL_ROWS - 1}`);
});
test('30 tab panels and 30 popovers', { skip, timeout: 300_000 }, async () => { await measure('Panels', at(599, '.fm-tab')); });
test('a chart of the 10,000 records found', { skip, timeout: 300_000 }, async () => { await measure('Chart', at(2900, 'svg')); });
