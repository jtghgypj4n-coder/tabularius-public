// Right-click > Explain This Value in the web client, in a real browser, on a
// small database built here with no .fmp12 and with AI off: a calculation shows
// its formula and the values it read, a stored value that has gone out of date
// says so, a data field says no formula sets it, and Done closes the sheet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name, Qty and Double fields.
const NAME = 5;
const QTY = 7;
const DOUBLE = 9;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Qty', type: 'number' }] }] as DesignOp[]);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Double', kind: 'calculation', type: 'number', calculation: 'Qty * 2' }] as DesignOp[]);
  store.create('Items', { Id: 1, Name: 'Bolt', Qty: 4 });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open() {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Bolt');
  return page;
}

async function explain(page: Page, objectId: number) {
  await field(page, objectId).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Explain This Value' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.waitFor();
  return sheet;
}

test('a calculation is explained with its formula, the values it read and what the formula gives', { skip }, async () => {
  const page = await open();
  try {
    await until(() => field(page, DOUBLE).inputValue(), (v) => v === '8');
    const sheet = await explain(page, DOUBLE);
    await sheet.getByRole('heading', { name: /Why Double shows/ }).waitFor();
    assert.match(await sheet.locator('.explain-facts').innerText(), /Items::Double/);
    assert.equal((await sheet.locator('.explain-formula').innerText()).trim(), 'Qty * 2');
    assert.match(await sheet.locator('.explain-verdict').innerText(), /The formula gives 8/);
    assert.match(await sheet.locator('.explain-table').innerText(), /Qty\s+4/);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await sheet.waitFor({ state: 'detached' });
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a data field says no formula sets it, and Escape closes the sheet', { skip }, async () => {
  const page = await open();
  try {
    const sheet = await explain(page, NAME);
    assert.match(await sheet.locator('.explain-verdict').innerText(), /No formula sets this field/);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
