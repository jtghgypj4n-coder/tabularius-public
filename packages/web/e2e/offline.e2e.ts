// The offline copy in a real browser, on a small database built here with no
// .fmp12: File > Offline Copy > Keep Offline Copy, then the connection goes. A
// field changed offline is kept in the browser and saved when the connection
// comes back; when someone else changed the record meanwhile, a dialog shows
// both and the person picks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// The generated form's Name and City fields.
const NAME = 5;
const CITY = 7;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'Leeds' });
  store.create('Customers', { Id: 2, Name: 'Grace', City: 'York' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Customer `id`'s field as the file holds it. */
function customer(id: number, name: string): string {
  return String(hosted.store('Shop').find('Customers', { query: [{ Id: `==${id}` }] }).records[0].fieldData[name]);
}

function setCustomer(id: number, data: Record<string, string>): void {
  const store = hosted.store('Shop');
  store.update('Customers', Number(store.find('Customers', { query: [{ Id: `==${id}` }] }).records[0].recordId), data);
}

/** Signed in, in form view on the first customer, with an offline copy kept. */
async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Offline Copy' }).hover();
  await page.getByRole('menuitemcheckbox', { name: 'Keep Offline Copy' }).click();
  await until(() => page.locator('.toast').allTextContents(), (t) => t.some((x) => x.includes('now keeps what you open')));
  return page;
}

async function close(page: Page): Promise<void> {
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

const banner = (page: Page) => page.locator('.offline-banner').textContent().catch(() => '');

test('a field changed offline is kept, and saved when the connection is back', { skip }, async () => {
  const page = await open();
  try {
    await page.context().setOffline(true);
    await until(() => banner(page), (t) => /offline, working from this browser's copy/.test(t ?? ''));

    await field(page, CITY).fill('Bath');
    await field(page, CITY).press('Tab');
    await until(() => banner(page), (t) => /1 change will be saved when the connection is back/.test(t ?? ''));
    assert.equal(customer(1, 'City'), 'Leeds', 'not saved while offline');
    assert.equal(await field(page, CITY).inputValue(), 'Bath', 'the window shows the change');

    await page.context().setOffline(false);
    await until(async () => customer(1, 'City'), (c) => c === 'Bath');
    await until(() => page.locator('.offline-banner').count(), (n) => n === 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    setCustomer(1, { City: 'Leeds' });
  }
});

test('when the record changed meanwhile, the person sees both and picks: Keep Mine saves the offline change over theirs', { skip }, async () => {
  const page = await open();
  try {
    await page.context().setOffline(true);
    await until(() => banner(page), (t) => /offline/.test(t ?? ''));
    await field(page, NAME).fill('Ada L.');
    await field(page, NAME).press('Tab');
    await until(() => banner(page), (t) => /1 change/.test(t ?? ''));
    // Someone else, online, changes the same field.
    setCustomer(1, { Name: 'Augusta' });

    await page.context().setOffline(false);
    const dialog = page.locator('dialog.clash-dialog[open]');
    await dialog.waitFor();
    assert.match(await dialog.textContent() ?? '', /changed while you were offline/);
    assert.match(await dialog.textContent() ?? '', /Augusta/);
    assert.match(await dialog.textContent() ?? '', /Ada L\./);
    assert.equal(customer(1, 'Name'), 'Augusta', 'nothing overwritten before the person picks');
    await dialog.getByRole('button', { name: 'Keep Mine' }).click();
    await until(async () => customer(1, 'Name'), (n) => n === 'Ada L.');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    setCustomer(1, { Name: 'Ada' });
  }
});

test('Keep Theirs drops the change made offline', { skip }, async () => {
  const page = await open();
  try {
    await page.context().setOffline(true);
    await until(() => banner(page), (t) => /offline/.test(t ?? ''));
    await field(page, CITY).fill('Hull');
    await field(page, CITY).press('Tab');
    await until(() => banner(page), (t) => /1 change/.test(t ?? ''));
    setCustomer(1, { City: 'Wakefield' });

    await page.context().setOffline(false);
    const dialog = page.locator('dialog.clash-dialog[open]');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Keep Theirs' }).click();
    await until(() => field(page, CITY).inputValue(), (v) => v === 'Wakefield');
    assert.equal(customer(1, 'City'), 'Wakefield');
    await until(() => page.locator('.offline-banner').count(), (n) => n === 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    setCustomer(1, { City: 'Leeds' });
  }
});

test('offline, the records already opened can still be browsed, and New Record says it needs the connection', { skip }, async () => {
  const page = await open();
  try {
    await page.context().setOffline(true);
    await until(() => banner(page), (t) => /offline/.test(t ?? ''));
    await page.getByRole('button', { name: 'Next record' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    await page.getByRole('button', { name: 'Previous record' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');

    const before = hosted.store('Shop').find('Customers', { limit: 10 }).records.length;
    await page.locator('button.tb', { hasText: 'New Record' }).first().click();
    await until(() => page.locator('.toast').allTextContents(), (t) => t.some((x) => /connection|offline/i.test(x)));
    assert.equal(hosted.store('Shop').find('Customers', { limit: 10 }).records.length, before);
    assert.equal(await field(page, NAME).inputValue(), 'Ada', 'still on the record');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
