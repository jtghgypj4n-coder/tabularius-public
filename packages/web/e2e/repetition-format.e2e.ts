// The Format menu in the second repetition of a repeating text field, in a real browser: that repetition keeps the
// formatting, the first keeps none, and it shows again after the record is read back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let id = 0;
let tags = 0;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Reps'] });
  const store = hosted.store('Reps');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }, { name: 'Tags', options: { repetitions: 2 } }] }] as DesignOp[]);
  const design = store.design('Notes')!;
  const objects = design.objects.map((o) => o.kind === 'field' && o.field?.field === 'Tags' ? { ...o, field: { ...o.field, repetitions: 2 } } : o);
  tags = objects.find((o) => o.kind === 'field' && o.field?.field === 'Tags')!.id;
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: { parts: design.parts, objects } }] as DesignOp[]);
  id = store.create('Notes', { Title: 'A', Tags: 'red', 'Tags(2)': 'green' }).recordId;
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('Format > Style > Bold in a second repetition formats that repetition only', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Reps', 'Ann', 'ann-secret-1');
  const second = page.locator(`.fm[data-id="${tags}"]`).locator('input, textarea').nth(1);
  await until(() => second.inputValue(), (v) => v === 'green');
  await second.click();
  await second.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 3));
  await page.keyboard.press('ControlOrMeta+Shift+b');
  const styles = await until(async () => hosted.store('Reps').get('Notes', id).styles, (v) => !!v?.['Tags(2)']?.length);
  assert.deepEqual(styles, { 'Tags(2)': [{ start: 0, end: 3, style: 256 }] }); // bold, second repetition only
  assert.equal(hosted.store('Reps').get('Notes', id).fieldData['Tags(2)'], 'green');
  // Read back: the field shows it once it is left.
  await page.reload();
  const again = page.locator(`.fm[data-id="${tags}"]`).locator('input, textarea').nth(1);
  await until(() => again.inputValue(), (v) => v === 'green');
  await until(() => page.locator(`.fm[data-id="${tags}"] span[style*="bold"]`).count(), (n) => n === 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});
