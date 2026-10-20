// Modernize interfaces in a real browser: the layouts made from templates list, search, sort, open, edit, add and delete
// records, show related records, and page through them one at a time, as the signed-in account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { modernizeChange } from '../../server/src/modernize.ts';
import { goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const frameOf = (page: Awaited<ReturnType<typeof window>>) => page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'CustomerID' }, { name: 'Name' }, { name: 'City' }, { name: 'Notes' }, { name: 'Since', type: 'date' }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }, { name: 'CustomerID' }, { name: 'Status' }, { name: 'Amount', type: 'number' }] },
  ] as unknown as DesignOp[]);
  store.applyDesign([{ op: 'createRelationship', left: 'Customers', right: 'Invoices', predicates: [{ left: 'CustomerID', right: 'CustomerID' }] }] as DesignOp[]);
  for (const [i, n, c] of [['1', 'Ada', 'London'], ['2', 'Grace', 'New York'], ['3', 'Linus', 'Helsinki']] as const) store.create('Customers', { CustomerID: i, Name: n, City: c, Since: '2024-03-05' });
  store.create('Invoices', { Number: 'A-1', CustomerID: '1', Status: 'Paid', Amount: 100 });
  store.create('Invoices', { Number: 'A-2', CustomerID: '1', Status: 'Open', Amount: 250 });
  store.applyDesign(modernizeChange(store, { styles: ['modern-list', 'modern-detail', 'modern-split'] }).changes);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('the modern list searches, sorts, and opens a record to edit, add and delete', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Customers - Modern list');
  const frame = frameOf(page);
  await until(() => frame.locator('tbody tr').count(), (n) => n === 3);
  await frame.locator('#q').fill('gra');
  await until(() => frame.locator('tbody tr').count(), (n) => n === 1);
  assert.match(await frame.locator('tbody tr').first().innerText(), /Grace/);
  await frame.locator('#q').fill('');
  await until(() => frame.locator('tbody tr').count(), (n) => n === 3);
  await frame.locator('th button', { hasText: 'City' }).click();
  await until(() => frame.locator('tbody tr td').first().textContent(), (t) => t === 'Linus');
  // Open Ada, change the city, save.
  await until(() => frame.locator('tbody tr', { hasText: 'Ada' }).count(), (n) => n === 1);
  await frame.locator('tbody tr', { hasText: 'Ada' }).click();
  await frame.locator('input[data-field="City"]').fill('Paris');
  await frame.locator('#save').click();
  await until(() => frame.locator('#status').textContent(), (t) => t === 'Saved.');
  await until(() => frame.locator('tbody tr', { hasText: 'Paris' }).count(), (n) => n === 1);
  assert.equal(hosted.store('Shop').find('Customers', { query: [{ Name: '==Ada' }] }).records[0]?.fieldData['City'], 'Paris');
  // The related invoices show under the form.
  await until(() => frame.locator('#related tbody tr').count(), (n) => n === 2);
  // A new customer.
  await frame.locator('#new').click();
  await frame.locator('input[data-field="Name"]').fill('Hedy');
  await frame.locator('#save').click();
  await until(() => frame.locator('tbody tr').count(), (n) => n === 4);
  await frame.locator('#del').click();
  await frame.locator('#del').click();
  await until(() => frame.locator('tbody tr').count(), (n) => n === 3);
  assert.equal(await frame.locator('.err').count(), 0);
  assert.deepEqual(page.errors, []);
});

test('the detail layout pages through records, and the split shows the list beside the form', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Customers - Modern detail');
  const frame = frameOf(page);
  await until(() => frame.locator('input[data-field="Name"]').inputValue(), (v) => v === 'Ada');
  await frame.locator('button', { hasText: 'Next' }).click();
  await until(() => frame.locator('input[data-field="Name"]').inputValue(), (v) => v === 'Grace');
  await goToLayout(page, 'Customers - Modern list and detail');
  await until(() => frame.locator('tbody tr').count(), (n) => n === 3);
  await frame.locator('tbody tr', { hasText: 'Linus' }).click();
  await until(() => frame.locator('input[data-field="Name"]').inputValue(), (v) => v === 'Linus');
  assert.equal(await frame.locator('tbody tr[aria-selected=true]').count(), 1);
  assert.deepEqual(page.errors, []);
});

test('the list can show its records as cards, sort them from a menu, and open one', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Customers - Modern list');
  const frame = frameOf(page);
  await until(() => frame.locator('tbody tr').count(), (n) => n === 3);
  await frame.getByRole('button', { name: 'Cards', exact: true }).click();
  await until(() => frame.locator('button.card').count(), (n) => n === 3);
  assert.equal(await frame.locator('tbody tr').count(), 0);
  assert.equal(await frame.getByRole('button', { name: 'Cards', exact: true }).getAttribute('aria-pressed'), 'true');
  // The first column is the heading and the others sit under it.
  assert.match(await frame.locator('button.card', { hasText: 'Grace' }).innerText(), /New York/);
  await frame.locator('#sortby').selectOption({ label: 'Sort: City' });
  await until(() => frame.locator('button.card strong').first().textContent(), (t) => t === 'Linus');
  await frame.locator('button.card', { hasText: 'Grace' }).click();
  await until(() => frame.locator('input[data-field="Name"]').inputValue(), (v) => v === 'Grace');
  assert.equal(await frame.locator('button.card[aria-pressed=true]').count(), 1);
  // Back to the table keeps the sort.
  await frame.getByRole('button', { name: 'Table', exact: true }).click();
  await until(() => frame.locator('tbody tr').count(), (n) => n === 3);
  assert.equal(await frame.locator('th[aria-sort=ascending]').count(), 1);
  assert.deepEqual(page.errors, []);
});
