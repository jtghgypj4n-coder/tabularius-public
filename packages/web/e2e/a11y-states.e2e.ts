// axe-core (WCAG 2.0/2.1/2.2 A and AA) on the web client's states a page-load audit never reaches:
// Find mode, the dialogs, the Manage screens and the phone Menu button open. The database is built
// here, with no .fmp12. `npm run a11y:web` audits the pages at load, in light and dark; these keep
// the states from slipping back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { axeViolations, host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  for (const [Id, Name, City] of [[1, 'Ada', 'London'], [2, 'Alan', 'Wilmslow'], [3, 'Grace', 'New York']]) store.create('Customers', { Id, Name, City });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(width = 1280): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext({ viewport: { width, height: width > 900 ? 900 : 844 }, reducedMotion: 'reduce' }));
  await page.setViewportSize({ width, height: width > 900 ? 900 : 844 });
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  return page;
}
async function command(page: Page, menu: string, item: string): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).first().click();
}
async function clean(page: Page, what: string): Promise<void> {
  assert.deepEqual(await axeViolations(page), [], what);
}

test('Browse, Find mode and the List and Table views pass axe', { skip }, async () => {
  const page = await open();
  await clean(page, 'Browse');
  await page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'List' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="View As"] button[aria-pressed="true"]')?.getAttribute('aria-label') === 'View as List');
  await clean(page, 'List view');
  await page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'Table' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="View As"] button[aria-pressed="true"]')?.getAttribute('aria-label') === 'View as Table');
  await clean(page, 'Table view');
  await page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'Form' }).click();
  await command(page, 'View', 'Find Mode');
  await page.getByRole('button', { name: 'Find', exact: true }).first().waitFor();
  await clean(page, 'Find mode');
  await page.close();
});

test('an open menu, with its shortcuts, passes axe', { skip }, async () => {
  const page = await open();
  for (const menu of ['File', 'Edit', 'Records']) {
    await page.locator('.menubar').getByRole('button', { name: menu, exact: true }).click();
    await clean(page, `${menu} menu open`);
    await page.keyboard.press('Escape');
  }
  await page.close();
});

test('the dialogs pass axe', { skip }, async () => {
  const page = await open();
  for (const [menu, item] of [['Records', 'Sort Records…'], ['Help', 'Keyboard Shortcuts']]) {
    await command(page, menu, item);
    await page.locator('dialog[open]').waitFor();
    await clean(page, `${item} dialog`);
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
  }
  await page.close();
});

test('the Manage screens pass axe', { skip }, async () => {
  const page = await open();
  for (const item of ['Database…', 'Layouts…', 'Security…']) {
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
    await page.getByRole('menuitem', { name: item }).click();
    if (item === 'Database…') await page.getByRole('tab', { name: 'Tables & fields' }).waitFor();
    else if (item === 'Layouts…') await page.getByLabel('New layout name').waitFor();
    else await page.waitForURL('**/security.html');
    await clean(page, `Manage ${item}`);
    await page.keyboard.press('Escape');
    await page.goBack();
    await page.locator('select.layout-menu').waitFor();
  }
  await page.close();
});

test('the phone layout with its Menu button open passes axe', { skip }, async () => {
  const page = await open(390);
  await page.getByRole('button', { name: /^Menu/ }).click();
  await clean(page, 'phone menu open');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await clean(page, 'phone File menu open');
  await page.close();
});

test('a dialog takes keyboard focus and Escape closes it', { skip }, async () => {
  const page = await open();
  await command(page, 'Records', 'Sort Records…');
  await page.locator('dialog[open]').waitFor();
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]')), true, 'focus moves into the dialog');
  // Tab never leaves a modal dialog.
  for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]')), true, 'Tab stays inside the dialog');
  await page.keyboard.press('Escape');
  await page.locator('dialog[open]').waitFor({ state: 'detached' });
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'BODY', 'focus returns to something after the dialog closes');
  await page.close();
});
