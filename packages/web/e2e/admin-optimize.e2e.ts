// The admin console's Optimize button, in a real browser: it lists what would make a file smaller and faster,
// changes nothing by itself, and an action (an index) runs only after the dialog that says what it does is accepted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Status', type: 'text' }] },
    { op: 'createValueList', name: 'Colours', values: ['red', 'green'] },
    { op: 'createScript', name: 'Sort by status', text: 'Sort Records [ Restore; Orders::Status; ascending ; With dialog: Off ]' },
  ] as never);
  store.sql.exec('BEGIN');
  const insert = store.sql.prepare('INSERT INTO Orders (Status) VALUES (?)');
  for (let i = 0; i < 2_000; i++) insert.run(i % 2 ? 'open' : 'closed');
  store.sql.exec('COMMIT');
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('Optimize lists what is slow, and the index goes in only after the dialog is accepted', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await page.locator('[data-optimize="Shop"]').click();
  const guide = page.locator('#guide');
  await guide.getByText('Field used to sort but not indexed: Orders::Status').waitFor();
  assert.match(await guide.innerText(), /2,000 records in Orders; sorting on it reads them all/);
  assert.deepEqual([...hosted.store('Shop').indexedFields('Orders')], [], 'looking changed nothing');

  // Declined: nothing happens.
  const dialogs: string[] = [];
  const indexIt = guide.locator('li', { hasText: 'Add an index on Orders::Status' }).getByRole('button', { name: 'Do it' });
  page.once('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await indexIt.click();
  await until(async () => dialogs.length, (n) => n === 1);
  assert.match(dialogs[0], /Add an index on Orders::Status\?/);
  assert.deepEqual([...hosted.store('Shop').indexedFields('Orders')], []);

  // Accepted: the index is made and the finding goes.
  page.once('dialog', (d) => void d.accept());
  await indexIt.click();
  await until(async () => [...hosted.store('Shop').indexedFields('Orders')], (f) => f.includes('Status'));
  await until(() => guide.innerText(), (t) => !t.includes('not indexed'));
  assert.deepEqual(page.errors, []);
});

test('a fix to the design says exactly what it does first, is made only when accepted, and the list has an Undo', { skip }, async () => {
  const store = hosted.store('Shop');
  await page.goto(hosted.url + '/admin/');
  await page.locator('[data-optimize="Shop"]').click();
  const guide = page.locator('#guide');
  const remove = guide.locator('li', { hasText: 'Remove 1 value list' }).getByRole('button', { name: 'Do it' });
  await remove.waitFor();

  // Declined after reading what it would do: the value list is still there.
  const dialogs: string[] = [];
  page.once('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await remove.click();
  await until(async () => dialogs.length, (n) => n === 1);
  assert.match(dialogs[0], /Remove 1 value list\?\n\nRemove the value list "Colours"\./);
  assert.match(dialogs[0], /one change, and the list here has an Undo/);
  assert.deepEqual(store.schema.valueLists.map((v) => v.name), ['Colours']);

  // Accepted: it goes, and the change is listed with an Undo that brings it back.
  page.once('dialog', (d) => void d.accept());
  await remove.click();
  await until(async () => store.schema.valueLists.length, (n) => n === 0);
  await guide.getByText('Changes made from this list').waitFor();
  await guide.locator('li', { hasText: 'Remove 1 value list' }).getByRole('button', { name: 'Undo' }).click();
  await until(async () => store.schema.valueLists.map((v) => v.name), (n) => n.includes('Colours'));
  await guide.getByText('Undone').waitFor();
  assert.deepEqual(page.errors, []);
});
