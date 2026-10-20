// Preview mode in a real browser: a body part whose objects slide shows the
// page number of the page it lands on, not page 1. The database is built
// here, with no .fmp12.
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
  hosted = await host({ stores: ['Pages'] });
  const store = hosted.store('Pages');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as DesignOp[]);
  const design = store.design('People')!;
  const body = design.parts.find((p) => p.kind === 'body')!;
  const name = design.objects.find((o) => o.field?.field === 'Name')!;
  // A tall Name field that slides up and shrinks the body, with the page number under it.
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: {
    parts: [{ ...body, top: 0, height: 400 }],
    objects: [
      { ...name, bounds: { top: 10, left: 10, bottom: 300, right: 200 }, sliding: { up: true, resizePart: true } },
      { id: 90001, kind: 'text', type: 0, bounds: { top: 310, left: 10, bottom: 330, right: 200 }, anchors: { left: true, top: true, right: false, bottom: false },
        style: {}, name: 'pageNo', text: 'Page {{PageNumber}}', sliding: { up: true, resizePart: true } },
    ],
    width: 400,
  } }] as DesignOp[]);
  for (let i = 1; i <= 12; i++) store.create('People', { Name: `Person ${i}` });
  store.setPassword('Admin', 'admin-secret-1', '[Full Access]');
  browser = await launch();
  page = await window(browser);
  await signIn(page, hosted.url, 'Pages', 'Admin', 'admin-secret-1');
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The page numbers each sheet's records show. */
async function shown(): Promise<string[][]> {
  return page.locator('.preview-sheet').evaluateAll((sheets) => sheets.map((s) =>
    [...s.querySelectorAll('.preview-flow > *')].map((el) => (el.textContent ?? '').match(/Page \d+/)?.[0] ?? '').filter(Boolean)));
}

test('a sliding body part shows the page number of its own page', { skip }, async () => {
  await page.keyboard.press('Control+u');
  const sheets = await until(shown, (v) => v.length >= 2 && v.every((s) => s.length > 0));
  sheets.forEach((onSheet, p) => {
    assert.deepEqual([...new Set(onSheet)], [`Page ${p + 1}`], `sheet ${p + 1}: ${onSheet.join(', ')}`);
  });
  // The records slid: more than one fits on a page, which a 400-point body wouldn't.
  assert.ok(sheets[0].length > 1, `first sheet has ${sheets[0].length} records`);
  assert.deepEqual(page.errors, []);
});
