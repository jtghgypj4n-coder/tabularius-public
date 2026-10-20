// The field's context menu (Find Matching Records, Sort Ascending, ...) works from the keyboard: focus goes into it,
// the arrows move, Enter runs the item, and Escape closes it with the keyboard back in the field.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name field.
const NAME = 5;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'Paris' });
  store.create('Customers', { Id: 2, Name: 'Grace', City: 'Oslo' });
  store.create('Customers', { Id: 3, Name: 'Ada', City: 'Rome' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  return page;
}

const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '');

test('the field menu takes focus, the arrows move it (skipping what is off), Enter runs the item', { skip }, async () => {
  const page = await open();
  await field(page, NAME).click({ button: 'right' });
  await page.locator('.field-menu').waitFor();
  assert.equal(await page.locator('.field-menu').getAttribute('aria-label'), 'Name');
  assert.match(await focusedText(page), /Find Matching Records/);
  await page.keyboard.press('ArrowDown');
  assert.match(await focusedText(page), /Constrain Found Set/);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.doesNotMatch(await focusedText(page), /Find Matching Records|Constrain Found Set/, 'wraps to the last item');
  await page.keyboard.press('Home');
  assert.match(await focusedText(page), /Find Matching Records/);
  await page.keyboard.press('Enter');
  await page.locator('.field-menu').waitFor({ state: 'detached' });
  // Find Matching Records for "Ada": the two Adas.
  await until(() => found(page).innerText(), (t) => /\b2\b/.test(t));
  await page.close();
});

test('Escape closes the menu after any number of other keys, and the keyboard goes back to the field', { skip }, async () => {
  const page = await open();
  await field(page, NAME).focus();
  await field(page, NAME).click({ button: 'right' });
  await page.locator('.field-menu').waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.locator('.field-menu').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT');
  // And the same again: a second menu is not held up by the first.
  await field(page, NAME).click({ button: 'right' });
  await page.locator('.field-menu').waitFor();
  await page.keyboard.press('Tab');
  await page.locator('.field-menu').waitFor({ state: 'detached' });
  await page.close();
});

test('a click elsewhere still closes it', { skip }, async () => {
  const page = await open();
  await field(page, NAME).click({ button: 'right' });
  await page.locator('.field-menu').waitFor();
  await page.mouse.click(5, 5);
  await page.locator('.field-menu').waitFor({ state: 'detached' });
  await page.close();
});
