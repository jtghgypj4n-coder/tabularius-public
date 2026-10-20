// The Insert menu in the web client, in a real browser, on a small database
// built here with no .fmp12: Current Date, Current Time and Current User Name
// typed into the field the cursor is in, from the menu and with their
// shortcuts; From Last Visited Record copying the field from the record shown
// before; and a word to click in a field first when none is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name and City fields.
const NAME = 5;
const CITY = 7;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'Paris' });
  store.create('Customers', { Id: 2, Name: 'Grace', City: '' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Signed in, in form view on the first customer. */
async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  return page;
}

async function insert(page: Page, item: RegExp | string): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

const city = (id: number) => String(hosted.store('Shop').find('Customers', { query: [{ Id: `==${id}` }] }).records[0].fieldData.City);
const usDate = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

test('Current Date, Current Time and Current User Name type into the field, from the menu and with their shortcuts', { skip }, async () => {
  const page = await open();
  try {
    const box = field(page, CITY);
    await box.fill('');
    await box.focus();
    await insert(page, /^Current Date/);
    await until(() => box.inputValue(), (v) => v === usDate(new Date()));

    await box.fill('');
    await box.focus();
    await insert(page, /^Current Time/);
    await until(() => box.inputValue(), (v) => /^\d\d:\d\d:\d\d$/.test(v));

    await box.fill('');
    await box.focus();
    await insert(page, /^Current User Name/);
    await until(() => box.inputValue(), (v) => v === 'Ann');

    // The shortcuts: ⌘- for the date, ⌘; for the time and ⇧⌘N for the name.
    await box.fill('');
    await box.focus();
    await page.keyboard.press('ControlOrMeta+-');
    await until(() => box.inputValue(), (v) => v === usDate(new Date()));
    await box.fill('');
    await page.keyboard.press('ControlOrMeta+;');
    await until(() => box.inputValue(), (v) => /^\d\d:\d\d:\d\d$/.test(v));
    await box.fill('');
    await page.keyboard.press('ControlOrMeta+Shift+N');
    await until(() => box.inputValue(), (v) => v === 'Ann');

    // Typed like typing: it is saved when the field is left.
    await box.press('Tab');
    await until(async () => city(1), (v) => v === 'Ann');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('From Last Visited Record copies the field from the record shown before, and with no field a word says to click in one', { skip }, async () => {
  const first = city(1);
  const page = await open();
  try {
    // Nothing yet to copy from: the first record is the only one visited.
    await page.getByRole('button', { name: 'Next record' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    const box = field(page, CITY);
    await box.click();
    await insert(page, /^From Last Visited Record/);
    await until(() => box.inputValue(), (v) => v === first);
    await box.press('Tab');
    await until(async () => city(2), (v) => v === first);

    // The cursor in no field: a toast says what to do.
    await page.locator('.content').click({ position: { x: 700, y: 5 } });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await insert(page, /^Current Date/);
    await page.locator('.toast', { hasText: 'Click in a field first.' }).waitFor();
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
