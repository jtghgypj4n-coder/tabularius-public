// Card windows in a real browser: a script opens one at the size New Window gives, and a button on the card runs
// Move/Resize Window, which sizes and places the card as WebDirect does. The database is built here with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
const OPEN = 920;
const GROW = 921;
let NAME = 0;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Cards'] });
  const store = hosted.store('Cards');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Open Card', text: 'New Window [ Style: Card ; "Card" ; 200 ; 300 ; 40 ; 60 ]' },
    { op: 'createScript', name: 'Grow', text: 'Move/Resize Window [ Current Window ; Height: 260 ; Width: 420 ; Top: 30 ]' },
  ] as DesignOp[]);
  const design = store.design('Items')!;
  NAME = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!.id;
  const scriptId = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const button = (id: number, left: number, text: string, script: string): LayoutObject => ({
    id, kind: 'button', type: 0, text, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
    bounds: { top: 100, left, bottom: 124, right: left + 90 }, action: { stepId: 1, step: 'Perform Script', scriptId: scriptId(script), script },
  } as LayoutObject);
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 140 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { view: 'form', parts, objects: [...design.objects, button(OPEN, 20, 'Open', 'Open Card'), button(GROW, 120, 'Grow', 'Grow')] } }] as DesignOp[]);
  store.create('Items', { Name: 'one' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The card's frame: its size and its place in the window, in CSS pixels. */
const frame = (page: Page) => page.locator('.window-frame.window-card').evaluate((el: HTMLElement) =>
  [el.style.height, el.style.width, el.style.top, el.style.left].join(' '));

test('Move/Resize Window sizes and places a card window', { skip }, async () => {
  const page = await window(await browser.newContext({ viewport: { width: 1200, height: 900 } }));
  try {
    await signIn(page, hosted.url, 'Cards', 'Ann', PASSWORD);
    await until(() => field(page, NAME).inputValue(), (v) => v === 'one');
    await page.locator(`.fm[data-id="${OPEN}"]`).click();
    await until(() => frame(page), (v) => v === '200px 300px 40px 60px');
    // The card's own Grow button: taller, wider and higher up, at the same left.
    await page.locator(`.window-frame.window-card .fm[data-id="${GROW}"]`).click();
    await until(() => frame(page), (v) => v === '260px 420px 30px 60px');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
