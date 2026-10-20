// A slide control with its navigation dots hidden, in a real browser: the
// dots are still there for the keyboard (and show while one has the focus),
// so the slides can be changed without swiping. Built here, with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };
const SLIDES = 950;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Slides'] });
  const store = hosted.store('Slides');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] }] as DesignOp[]);
  const design = store.design('Notes')!;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const bounds = { top: 100, left: 20, bottom: 200, right: 300 };
  const text = (id: number, words: string): LayoutObject => ({ id, kind: 'text', type: 0, anchors, style: {}, bounds: { top: 110, left: 30, bottom: 130, right: 200 }, text: words } as LayoutObject);
  const slides = {
    id: SLIDES, kind: 'slide-control', type: 0, anchors, style: {}, bounds, noDots: true,
    children: [
      { id: 951, kind: 'slide-panel', type: 0, anchors, style: {}, bounds, children: [text(953, 'First slide')] },
      { id: 952, kind: 'slide-panel', type: 0, anchors, style: {}, bounds, children: [text(954, 'Second slide')] },
    ],
  } as unknown as LayoutObject;
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: { objects: [...design.objects, slides] } }] as DesignOp[]);
  store.create('Notes', { Title: 'one' });
  store.setPassword('Admin', 'admin-secret-1', '[Full Access]');
  browser = await launch();
  page = await window(browser);
  await signIn(page, hosted.url, 'Slides', 'Admin', 'admin-secret-1');
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('hidden slide dots can still change the slide from the keyboard, and show while focused', { skip }, async () => {
  const control = page.locator(`.fm[data-id="${SLIDES}"]`);
  await control.waitFor();
  const visible = () => control.locator('.fm-panel:not([hidden])').textContent();
  assert.match(await visible() ?? '', /First slide/);
  const dots = control.locator('.fm-dots');
  const width = () => dots.evaluate((d) => d.getBoundingClientRect().width);
  assert.ok(await width() <= 1, 'the dots are hidden until focused');
  const second = control.getByRole('button', { name: 'Slide 2 of 2' });
  await second.focus();
  assert.ok(await width() > 1, 'a focused dot shows');
  await page.keyboard.press('Enter');
  await until(visible, (t) => !!t?.includes('Second slide'));
  assert.deepEqual(page.errors, []);
});
