// Preview mode in a real browser with Layout Setup's "Print in 2 columns":
// records sit side by side, across first or down first, each cut at the
// column's width. The database is built here, with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Labels'] });
  const store = hosted.store('Labels');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as DesignOp[]);
  const design = store.design('People')!;
  // Only a body, 100 tall, so pages hold several rows.
  const body = design.parts.find((p) => p.kind === 'body')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: {
    parts: [{ ...body, top: 0, height: 100 }],
    objects: design.objects.filter((o) => o.field?.field === 'Name').map((o) => ({ ...o, bounds: { top: 10, left: 10, bottom: 30, right: 200 } })),
    width: 400,
    printColumns: { count: 2 },
  } }] as DesignOp[]);
  for (const name of ['Ada', 'Ben', 'Cy', 'Di']) store.create('People', { Name: name });
  store.setPassword('Admin', 'admin-secret-1', '[Full Access]');
  browser = await launch();
  page = await window(browser);
  await signIn(page, hosted.url, 'Labels', 'Admin', 'admin-secret-1');
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Each record's name in Preview with its place on the first page: [name, left, top]. */
async function placed(): Promise<[string, number, number][]> {
  return page.locator('.preview-sheet').first().locator('.preview-cell').evaluateAll((cells) => cells.map((c) => {
    const el = c as HTMLElement;
    const box = el.querySelector('input, textarea') as HTMLInputElement | null;
    return [(box?.value ?? el.textContent ?? '').trim(), parseFloat(el.style.left), parseFloat(el.style.top)] as [string, number, number];
  }));
}

test('Preview mode prints records in columns, across first then down first', { skip }, async () => {
  await page.keyboard.press('Control+u');
  const across = await until(placed, (v) => v.length === 4);
  // US Letter less half-inch margins is 540 points wide: two columns of 270.
  assert.deepEqual(across, [['Ada', 0, 0], ['Ben', 270, 0], ['Cy', 0, 100], ['Di', 270, 100]]);
  const width = await page.locator('.preview-cell').first().evaluate((c) => (c as HTMLElement).style.width);
  assert.equal(width, '270px');
  hosted.store('Labels').applyDesign([{ op: 'updateLayout', layout: 'People', design: { printColumns: { count: 2, order: 'down' } } }] as DesignOp[]);
  await page.reload();
  await page.locator('.fm-part').first().waitFor();
  await page.keyboard.press('Control+u');
  // Down first: all four fit down the first column of a 720-point page.
  const down = await until(placed, (v) => v.length === 4 && v[1][2] === 100);
  assert.deepEqual(down, [['Ada', 0, 0], ['Ben', 0, 100], ['Cy', 0, 200], ['Di', 0, 300]]);
  assert.deepEqual(page.errors, []);
});
