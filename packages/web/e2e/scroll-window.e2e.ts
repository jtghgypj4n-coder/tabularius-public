// Scroll Window in a real browser: a script's Home, End, Page Down and To Selection scroll the person's window, in the
// order the steps ran, once the window shows what the script left.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let BOTTOM = 0;
const BUTTONS = { End: 920, Home: 921, PageDown: 922, ToSelection: 923, EndThenOther: 924 };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Tall'] });
  const store = hosted.store('Tall');
  store.applyDesign([
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }, { name: 'Bottom' }] },
    { op: 'createScript', name: 'End', text: 'Scroll Window [ End ]' },
    { op: 'createScript', name: 'Home', text: 'Scroll Window [ Home ]' },
    { op: 'createScript', name: 'Page Down', text: 'Scroll Window [ Home ]\nScroll Window [ Page Down ]' },
    { op: 'createScript', name: 'To Selection', text: 'Go to Field [ Notes::Bottom ]\nScroll Window [ Home ]\nScroll Window [ To Selection ]' },
  ] as DesignOp[]);
  // A body far taller than the window, with the Bottom field at its foot and the buttons at its top.
  const design = store.design('Notes')!;
  const scriptId = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const button = (id: number, left: number, script: string): LayoutObject => ({
    id, kind: 'button', type: 0, text: script, anchors, style: {}, bounds: { top: 10, left, bottom: 34, right: left + 100 },
    action: { stepId: 1, step: 'Perform Script', scriptId: scriptId(script), script },
  } as LayoutObject);
  const body = design.parts.find((p) => p.kind === 'body')!;
  const objects = design.objects.map((o) => o.kind === 'field' && o.field?.field === 'Bottom'
    ? { ...o, bounds: { ...o.bounds, top: body.top + 2900, bottom: body.top + 2922 } }
    : o);
  BOTTOM = objects.find((o) => o.kind === 'field' && o.field?.field === 'Bottom')!.id;
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 3000 } : p.kind === 'footer' ? { ...p, top: body.top + 3000 } : p);
  // As tall as Notes, so a scroll that landed here by mistake would show.
  store.applyDesign([
    { op: 'createLayout', name: 'Other', occurrence: 'Notes', design: { parts, objects } },
    { op: 'createScript', name: 'End Then Other', text: 'Scroll Window [ End ]\nRefresh Window []\nGo to Layout [ "Other" ]' },
  ] as DesignOp[]);
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: {
    parts, objects: [...objects, button(BUTTONS.End, 20, 'End'), button(BUTTONS.Home, 130, 'Home'), button(BUTTONS.PageDown, 240, 'Page Down'), button(BUTTONS.ToSelection, 350, 'To Selection'), button(BUTTONS.EndThenOther, 460, 'End Then Other')],
  } }] as DesignOp[]);
  store.create('Notes', { Title: 'Alpha', Bottom: 'way down' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

/**
 * Runs a button's script, wherever the window is scrolled. The window ignores a click while a script is running
 * (it marks its content aria-busy), so the one before finishes first: a script that scrolls to where the window
 * already is gives the test nothing else to wait for, and on a slow runner the next click would be dropped.
 */
async function press(page: Page, id: number): Promise<void> {
  await page.locator('#content[aria-busy="true"], .content[aria-busy="true"]').waitFor({ state: 'detached' });
  await page.locator(`.fm[data-id="${id}"]`).evaluate((el) => (el.querySelector('button') ?? el as HTMLElement).click());
}
const scroll = (page: Page) => page.evaluate(() => {
  const c = document.querySelector('#content, .content') as HTMLElement;
  return { top: c.scrollTop, max: c.scrollHeight - c.clientHeight, height: c.clientHeight };
});

test('Scroll Window scrolls the person\'s window: End, Home, Page Down and To Selection', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Tall', 'Ann', 'ann-secret-1');
  await until(() => field(page, BOTTOM).inputValue(), (v) => v === 'way down');
  assert.ok((await scroll(page)).max > 1000, 'the layout is taller than the window');

  await press(page, BUTTONS.End);
  await until(() => scroll(page), (s) => s.top > 0 && Math.abs(s.top - s.max) <= 2);
  await press(page, BUTTONS.Home);
  await until(() => scroll(page), (s) => s.top === 0);
  await press(page, BUTTONS.PageDown);
  const s = await until(() => scroll(page), (x) => x.top > 0);
  assert.ok(s.top >= s.height / 2 && s.top <= s.height, `a page down, less a line (${s.top} of ${s.height})`);

  // Home after Go to Field takes the field out of view; To Selection brings it back.
  await press(page, BUTTONS.Home);
  await until(() => scroll(page), (x) => x.top === 0);
  await press(page, BUTTONS.ToSelection);
  await until(() => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value), (v) => v === 'way down');
  const box = await until(() => field(page, BOTTOM).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const c = (document.querySelector('#content, .content') as HTMLElement).getBoundingClientRect();
    return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; // to the pixel: the edges are fractional
  }), (v) => v);
  assert.equal(box, true, 'the field with the cursor is in view');
  assert.ok((await scroll(page)).top > 1000);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Scroll Window before a Refresh Window checkpoint scrolls the layout it ran on, before the script moves to another', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Tall', 'Ann', 'ann-secret-1');
  await until(() => field(page, BOTTOM).inputValue(), (v) => v === 'way down');
  await press(page, BUTTONS.Home);
  await until(() => scroll(page), (s) => s.top === 0);
  // Which layout was showing each time the window scrolled.
  await page.evaluate(() => {
    const seen: { layout: string; top: number }[] = [];
    (window as unknown as { scrolled: typeof seen }).scrolled = seen;
    document.addEventListener('scroll', (e) => {
      seen.push({ layout: (document.querySelector('select.layout-menu') as HTMLSelectElement).value, top: (e.target as HTMLElement).scrollTop });
    }, true);
  });
  await press(page, BUTTONS.EndThenOther);
  await until(() => page.locator('select.layout-menu').inputValue(), (v) => v === 'Other');
  const scrolled = await until(() => page.evaluate(() => (window as unknown as { scrolled: { layout: string; top: number }[] }).scrolled), (v) => v.some((x) => x.top > 0));
  assert.equal(scrolled.find((x) => x.top > 0)?.layout, 'Notes', 'End scrolled Notes, where it ran, not Other');
  assert.deepEqual(page.errors, []);
  await page.close();
});
