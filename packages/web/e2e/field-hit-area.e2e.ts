// A desktop layout shown on a phone is scaled down until its fields are a few pixels high. Each field gets an
// invisible strip above and below it, into the empty space around it, that puts the cursor in it (WCAG 2.5.8).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let FIRST = 0;
let SECOND = 0;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Wide'] });
  const store = hosted.store('Wide');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'First' }, { name: 'Second' }] }] as DesignOp[]);
  // Two wide fields 60 points apart on a layout 900 points wide: on a 390px phone each is about 9px high.
  const design = store.design('Notes')!;
  const body = design.parts.find((p) => p.kind === 'body')!;
  const at = (top: number) => ({ top: body.top + top, left: 20, bottom: body.top + top + 20, right: 900 });
  const objects = design.objects
    .filter((o) => o.kind === 'field')
    .map((o) => ({ ...o, bounds: at(o.field?.field === 'First' ? 40 : 120) }));
  FIRST = objects.find((o) => o.field?.field === 'First')!.id;
  SECOND = objects.find((o) => o.field?.field === 'Second')!.id;
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 200 } : p.top > body.top ? { ...p, top: p.top - body.height + 200 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: { parts, objects, responsive: { stackBelow: 0 } } }] as DesignOp[]);
  store.create('Notes', { First: 'one', Second: 'two' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

const focusedValue = (page: Awaited<ReturnType<typeof window>>) => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value);

test('a field scaled below a fingertip takes a tap just above or below it', { skip }, async () => {
  const page = await window(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, hosted.url, 'Wide', 'Ann', 'ann-secret-1');
  const first = field(page, FIRST), second = field(page, SECOND);
  await until(() => first.inputValue(), (v) => v === 'one');
  const cell = (id: number) => page.locator(`.fm[data-id="${id}"]`).first().boundingBox().then((x) => x!);
  const a = await cell(FIRST), b = await cell(SECOND);
  assert.ok(a.height < 15, `the field is drawn ${a.height}px high`);
  // Just above the first field, and just below the second: outside what is drawn.
  await page.mouse.click(a.x + 40, a.y - 4);
  await until(() => focusedValue(page), (v) => v === 'one');
  await page.mouse.click(b.x + 40, b.y + b.height + 4);
  await until(() => focusedValue(page), (v) => v === 'two');
  // Each strip stops halfway to the other field, and none makes the target under 24px.
  const strips = await page.locator(`.fm[data-id="${FIRST}"]`).first().locator('.fm-hit').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.equal(strips.length, 2);
  const target = a.height + strips[0] + strips[1];
  assert.ok(target >= 23.5, `the target is ${target}px high`);
  assert.ok(a.y + a.height + strips[1] <= (a.y + a.height + b.y) / 2 + 0.5, 'the strip below stops halfway to the next field');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('at full size, fields get no strips', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Wide', 'Ann', 'ann-secret-1');
  await until(() => field(page, FIRST).inputValue(), (v) => v === 'one');
  assert.equal(await page.locator('.fm-hit').count(), 0);
  await page.close();
});
