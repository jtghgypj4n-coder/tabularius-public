// File > Manage > Layouts in the web client, in a real browser, on a small
// database built here with no .fmp12: a layout made, renamed, duplicated and
// deleted (after asking), "Include in layout menus" taking it out of the
// Layout menu, and "Open in browse mode" landing on it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Signed in, in Manage Database on its Layouts tab. */
async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Layouts…' }).click();
  await page.getByLabel('New layout name').waitFor();
  return page;
}

const layouts = () => hosted.store('Shop').layouts().map((l) => l.name);
/** A layout's button in the list on the left. */
const listed = (page: Page, name: string) => page.locator('.d-side li button', { has: page.locator('span:first-child', { hasText: new RegExp(`^${name}$`) }) });

test('a layout is made, renamed, duplicated and deleted after asking', { skip }, async () => {
  const page = await open();
  try {
    await page.getByLabel('New layout name').fill('Contacts');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await until(async () => layouts().includes('Contacts'), (v) => v);
    await listed(page, 'Contacts').waitFor();
    assert.equal(await page.getByLabel('Layout name', { exact: true }).inputValue(), 'Contacts');

    await page.getByLabel('Layout name', { exact: true }).fill('People');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await until(async () => layouts().includes('People'), (v) => v);
    assert.ok(!layouts().includes('Contacts'));

    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await listed(page, 'People Copy').waitFor();
    assert.ok(layouts().includes('People Copy'));

    // Delete asks first: Cancel keeps it, OK removes it.
    // The question may come before the click returns or after it, so a handler is set before each click and waited for.
    const remove = page.getByRole('button', { name: /^Delete layout/ });
    const answer = (accept: boolean) => new Promise<string>((resolve) => page.once('dialog', (d) => { resolve(d.message()); void (accept ? d.accept() : d.dismiss()); }));
    const dismissed = answer(false);
    await remove.click();
    assert.match(await dismissed, /Delete layout "People Copy"/);
    assert.ok(layouts().includes('People Copy'));
    const accepted = answer(true);
    await remove.click();
    await accepted;
    await until(async () => layouts().includes('People Copy'), (v) => !v);
    assert.ok(layouts().includes('People'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a layout left out of the layout menus is missing from the Layout menu, and Open in browse mode lands on another', { skip }, async () => {
  const occurrence = hosted.store('Shop').design('Customers')!.tableOccurrenceId;
  hosted.store('Shop').applyDesign([{ op: 'createLayout', name: 'Hidden', occurrence }, { op: 'createLayout', name: 'Shown', occurrence }] as DesignOp[]);
  const page = await open();
  try {
    await listed(page, 'Hidden').click();
    await page.getByLabel('Include in layout menus').uncheck();
    await until(async () => hosted.store('Shop').design('Hidden') !== undefined, (v) => v);
    await listed(page, 'Shown').click();
    await page.getByRole('button', { name: 'Open in browse mode' }).click();
    const menu = page.locator('select.layout-menu');
    await menu.waitFor();
    await until(() => menu.inputValue(), (v) => v === 'Shown');
    const names = await menu.locator('option').allTextContents();
    assert.ok(names.includes('Customers') && names.includes('Shown'), names.join(', '));
    assert.ok(!names.includes('Hidden'), names.join(', '));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
