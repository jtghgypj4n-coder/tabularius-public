// A layout with no breakpoint of its own stacks in one column in a window narrower than the server's setting (640
// points unless changed); a layout that sets its own breakpoint, or 0 for never, keeps it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let FIRST = 0;

// Two fields 900 points wide: drawn at 390 pixels they shrink to about 9 pixels high; stacked they are the window's width.
function wide(store: ReturnType<Hosted['store']>, layout: string, responsive?: { stackBelow: number }): number {
  const design = store.design(layout)!;
  const body = design.parts.find((p) => p.kind === 'body')!;
  const objects = design.objects.filter((o) => o.kind === 'field').map((o) => ({
    ...o, bounds: { top: body.top + (o.field?.field === 'First' ? 40 : 120), left: 20, bottom: body.top + (o.field?.field === 'First' ? 60 : 140), right: 900 },
  }));
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 200 } : p.top > body.top ? { ...p, top: p.top - body.height + 200 } : p);
  store.applyDesign([{ op: 'updateLayout', layout, design: { parts, objects, ...(responsive ? { responsive } : {}) } }] as DesignOp[]);
  return objects.find((o) => o.field?.field === 'First')!.id;
}

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Sizes'] });
  const store = hosted.store('Sizes');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'First' }, { name: 'Second' }] }, { op: 'createLayout', name: 'Never stacks', occurrence: 'Notes' }] as DesignOp[]);
  FIRST = wide(store, 'Notes');
  wide(store, 'Never stacks', { stackBelow: 0 });
  store.create('Notes', { First: 'one', Second: 'two' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

const box = (page: Awaited<ReturnType<typeof window>>) => field(page, FIRST).evaluate((el) => {
  const r = (el.closest('.fm') ?? el).getBoundingClientRect();
  return { width: r.width, height: r.height };
});

async function open(width: number) {
  const page = await window(browser);
  await page.setViewportSize({ width, height: 844 });
  await signIn(page, hosted.url, 'Sizes', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Notes');
  await until(() => field(page, FIRST).inputValue(), (v) => v === 'one');
  return page;
}

test('below 640 points a layout with no breakpoint stacks; wider, it is as designed', { skip }, async () => {
  const narrow = await open(390);
  const stacked = await until(() => box(narrow), (size) => size.height >= 18 && size.width > 300);
  assert.ok(stacked.height >= 18, `stacked, the field keeps its size: ${stacked.height}px high`);
  assert.ok(stacked.width > 300, `and fills the window: ${stacked.width}px wide`);
  assert.deepEqual(narrow.errors, []);
  await narrow.close();
  const desk = await open(1280);
  const drawn = await until(() => box(desk), (size) => size.width > 800);
  assert.ok(drawn.width > 800, `at 1280 it is as designed: ${drawn.width}px wide`);
  await desk.close();
});

test('a layout that sets 0 is scaled, not stacked, and the server\'s setting changes the width', { skip }, async () => {
  const page = await open(390);
  await goToLayout(page, 'Never stacks');
  await until(() => field(page, FIRST).inputValue(), (v) => v === 'one');
  const scaled = await until(() => box(page), (size) => size.height < 15);
  assert.ok(scaled.height < 15, `never: the layout shrinks to fit, ${scaled.height}px high`);
  await page.close();
  hosted.host.config.setResponsiveStackBelow(300);
  const later = await open(390);
  const unstacked = await until(() => box(later), (size) => size.height < 15);
  assert.ok(unstacked.height < 15, `with the server set to 300 a 390 window is not stacked: ${unstacked.height}px high`);
  await later.close();
  hosted.host.config.setResponsiveStackBelow(null);
});
