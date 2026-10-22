// What a real browser displays and stores after invalid date text is entered.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let due = 0;
let record = 0;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Dates'] });
  const store = hosted.store('Dates');
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Name' }, { name: 'Due', type: 'date' }] }] as DesignOp[]);
  due = store.design('Events')!.objects.find((o) => o.kind === 'field' && o.field?.field === 'Due')!.id;
  record = store.create('Events', { Name: 'Boundary' }).recordId;
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('invalid date text remains raw while editing and is stored and displayed as an invalid localized date', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Dates', 'Ann', PASSWORD);
  const input = field(page, due);
  await input.fill('2024-02-31');
  await input.press('Tab');
  const stored = await until(async () => hosted.store('Dates').get('Events', record).fieldData.Due, (v) => typeof v === 'string' && v.length > 0);
  assert.equal(await input.inputValue(), '2024-02-31', 'the input keeps the text as typed before reload');
  assert.equal(stored, '02/31/2024');
  await page.reload();
  const afterReload = field(page, due);
  await until(() => afterReload.inputValue(), (v) => v.length > 0);
  assert.equal(await afterReload.inputValue(), '02/31/2024');
  assert.equal(stored, '02/31/2024');
  assert.deepEqual(page.errors, []);
  await page.close();
});
