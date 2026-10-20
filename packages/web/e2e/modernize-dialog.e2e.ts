// Modernize interfaces in Manage Layouts, in a real browser: preview a page on made-up records and try it, then make the
// layouts as one change, in a folder, that Undo takes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'CustomerID' }, { name: 'Name' }, { name: 'City' }, { name: 'Since', type: 'date' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Number' }, { name: 'CustomerID' }, { name: 'Total', type: 'number' }] },
  ] as DesignOp[]);
  store.applyDesign([{ op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'CustomerID', right: 'CustomerID' }] }] as DesignOp[]);
  store.create('Customers', { CustomerID: '1', Name: 'Ada', City: 'London' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('Modernize interfaces previews a page on made-up records, then makes the layouts and Undo takes them back', { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Layouts…' }).click();
  await page.getByRole('button', { name: 'Modernize interfaces…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Modernize interfaces' });
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await dialog.getByText('10 new layouts for 2 tables').waitFor();

  // A modern list opens on made-up records, which can be searched; the file's own Customers record is not in it.
  await dialog.locator('details', { hasText: 'Customers - Modern list' }).first().locator('summary').click();
  const frame = dialog.frameLocator('iframe[title="Preview of Customers - Modern list"]');
  await until(() => frame.locator('tbody tr').count(), (n) => n === 12);
  await frame.locator('#q').fill('hopper');
  await until(() => frame.locator('tbody tr').count(), (n) => n === 1);
  assert.equal(await frame.getByText('Ada', { exact: true }).count(), 0);

  const before = hosted.store('Shop').layouts().map((l) => l.name);
  await dialog.getByRole('button', { name: 'Make 10 layouts' }).click();
  await until(async () => hosted.store('Shop').layouts().length, (n) => n === before.length + 10);
  assert.ok(hosted.store('Shop').schema.layoutOrder.some((o) => o.kind === 'folder' && o.name === 'Modernized interfaces'));
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await until(async () => hosted.store('Shop').layouts().length, (n) => n === before.length);
  assert.deepEqual(page.errors, []);
});

test('the calendar is offered unticked, and its preview puts made-up records on this month', { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Layouts…' }).click();
  await page.getByRole('button', { name: 'Modernize interfaces…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Modernize interfaces' });
  assert.equal(await dialog.getByLabel('Modern calendar', { exact: true }).isChecked(), false);
  assert.equal(await dialog.getByLabel('Modern board', { exact: true }).isChecked(), false);
  for (const name of ['Modern list', 'Modern detail', 'Modern list and detail', 'Classic list', 'Classic form']) await dialog.getByLabel(name, { exact: true }).uncheck();
  await dialog.getByLabel('Modern calendar', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await dialog.getByText('1 new layout for 1 table').waitFor();
  await dialog.locator('details', { hasText: 'Customers - Modern calendar' }).locator('summary').click();
  const frame = dialog.frameLocator('iframe[title="Preview of Customers - Modern calendar"]');
  await until(() => frame.locator('button.ev').count(), (n) => n > 0);
  assert.deepEqual(page.errors, []);
});

test('the link a freshly hosted file opens (?modernize=1) goes straight to Modernize interfaces after signing in', { skip }, async () => {
  const page = await window(await browser.newContext());
  await page.goto(`${hosted.url}/app/?db=Shop&modernize=1`);
  await page.locator('input[name="account"]').fill('Ann');
  await page.locator('input[name="password"]').fill('ann-secret-1');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('dialog', { name: 'Modernize interfaces' }).waitFor();
  assert.ok(page.url().includes('design.html'));
  assert.deepEqual(page.errors, []);
});

test('Polish with AI is offered after the layouts are made, says roughly what it costs, and sends nothing until asked', { skip }, async () => {
  const page = await window(await browser.newContext());
  const asked: string[] = [];
  // The assistant is on for this file; what it is asked is recorded, and nothing leaves the test.
  await page.route('**/tabularius/assistant/v1/databases/Shop', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { available: true, canDesign: true, canExplainScripts: true, model: 'claude-sonnet-5-5', price: { input: 2, output: 10 } } })
    : (asked.push(route.request().postData() ?? ''), route.fulfill({ status: 503, json: { messages: [{ code: '3', message: 'test' }] } })));
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Layouts…' }).click();
  await page.getByRole('button', { name: 'Modernize interfaces…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Modernize interfaces' });
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await dialog.getByRole('button', { name: /^Make \d+ layouts$/ }).click();
  await dialog.getByText('Polish with AI (optional)').waitFor();
  await dialog.getByText(/Pick the pages to polish/).waitFor();
  await dialog.getByLabel('Customers - Modern list', { exact: true }).check();
  await dialog.getByText(/Roughly 26,000 tokens in and 6,000 out, about \$0\.11 with claude-sonnet-5-5/).waitFor();
  assert.deepEqual(asked, [], 'nothing was sent yet');
  assert.deepEqual(page.errors, []);
});
