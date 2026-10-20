// File > Manage > Database in the web client, in a real browser, on a small
// database built here with no .fmp12: a new table (with a layout for it),
// text, number and calculation fields, an auto-enter serial and a range
// check, then back in Browse mode the new layout works as designed. A field
// renamed keeps its data; one deleted waits under Recently deleted and comes
// back with its data on Restore.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

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

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Database…' }).click();
  await page.getByRole('tab', { name: 'Tables & fields' }).waitFor();
  return page;
}

/** A field's row in the table's field list. */
const row = (page: Page, name: string) => page.locator('.d-grid > tbody > tr:not(.d-editor-row)', { has: page.locator('td:first-child', { hasText: new RegExp(`^${name}`) }) });
const editor = (page: Page) => page.locator('form.d-editor');
const fieldsOf = (table: string) => hosted.store('Shop').schema.tables.find((t) => t.name === table)?.fields.map((f) => f.name) ?? [];

async function addField(page: Page, name: string, type: string, kind = 'normal'): Promise<void> {
  await page.getByLabel('New field name').fill(name);
  await page.getByLabel('Type', { exact: true }).first().selectOption(type);
  await page.getByLabel('Kind', { exact: true }).first().selectOption(kind);
  await page.getByRole('button', { name: 'Add field' }).click();
  await row(page, name).waitFor();
}

test('a table made in Manage Database, with a serial, a range check and a calculation, works in Browse mode', { skip }, async () => {
  const page = await open();
  try {
    await page.getByLabel('New table name').fill('Orders');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByLabel('Table name').and(page.locator('[value="Orders"]')).waitFor();

    await addField(page, 'No', 'number');
    await addField(page, 'Qty', 'number');
    // A calculation opens its editor for the formula.
    await addField(page, 'Double', 'number', 'calculation');
    await editor(page).getByRole('textbox', { name: /^Formula/ }).fill('Qty * 2');
    await editor(page).getByRole('button', { name: 'Save field' }).click();
    await until(async () => hosted.store('Shop').schema.tables.find((t) => t.name === 'Orders')?.fields.find((f) => f.name === 'Double')?.calculation ?? '', (c) => c === 'Qty * 2');

    // No: an auto-enter serial number. Qty: 1 to 10, with a message.
    await row(page, 'No').click();
    await editor(page).getByLabel('Serial number').check();
    await editor(page).getByRole('button', { name: 'Save field' }).click();
    await until(() => row(page, 'No').locator('td.d-options').textContent(), (t) => /serial/i.test(t ?? ''));
    await row(page, 'Qty').click();
    await editor(page).getByLabel('In range').check();
    await editor(page).getByLabel('From', { exact: true }).fill('1');
    await editor(page).getByLabel('To', { exact: true }).fill('10');
    await editor(page).getByRole('textbox', { name: 'Message when it fails' }).fill('Between 1 and 10, please');
    await editor(page).getByRole('button', { name: 'Save field' }).click();
    await until(() => row(page, 'Qty').locator('td.d-options').textContent(), (t) => /range/i.test(t ?? ''));
    assert.deepEqual(fieldsOf('Orders'), ['No', 'Qty', 'Double']);

    // Back to Browse mode, on the Orders layout Manage Database made.
    await page.getByRole('link', { name: 'Back to browse' }).click();
    await page.locator('select.layout-menu').waitFor();
    await goToLayout(page, 'Orders');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await page.getByRole('button', { name: 'New Record' }).click();
    // The generated form's fields: No, Qty and Double, each after its label.
    const [no, qty, double] = [field(page, 3), field(page, 5), field(page, 7)];
    await until(() => no.inputValue(), (v) => v === '1');
    await qty.fill('4');
    await qty.press('Tab');
    await until(() => double.inputValue(), (v) => v === '8');
    // Out of range: refused, with the field's message.
    await qty.fill('50');
    await qty.press('Tab');
    await until(() => page.locator('.toast, dialog[open]').allTextContents().then((t) => t.join(' | ')), (t) => /Between 1 and 10, please/.test(t));
    assert.equal(hosted.store('Shop').find('Orders', { query: [{ No: '1' }] }).records[0].fieldData.Qty, 4);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a field renamed keeps its data, and one deleted comes back with its data on Restore', { skip }, async () => {
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Id', type: 'number' }, { name: 'Body' }, { name: 'Tag' }] }] as DesignOp[]);
  store.create('Notes', { Id: 1, Body: 'hello', Tag: 'red' });
  const page = await open();
  try {
    await page.locator('.d-side .d-list button', { hasText: /^Notes/ }).click();
    await row(page, 'Body').click();
    await editor(page).getByLabel('Name', { exact: true }).fill('Text');
    await editor(page).getByRole('button', { name: 'Save field' }).click();
    await row(page, 'Text').waitFor();
    assert.equal(store.find('Notes', { query: [{ Id: '1' }] }).records[0].fieldData.Text, 'hello');

    await row(page, 'Tag').click();
    page.once('dialog', (d) => void d.accept());
    await editor(page).getByRole('button', { name: 'Delete field…' }).click();
    await until(() => row(page, 'Tag').count(), (n) => n === 0);
    assert.deepEqual(fieldsOf('Notes'), ['Id', 'Text']);
    const deleted = page.locator('.d-deleted-item', { hasText: 'Tag' });
    await deleted.waitFor();
    await deleted.getByRole('button', { name: 'Restore' }).click();
    await row(page, 'Tag').waitFor();
    assert.equal(store.find('Notes', { query: [{ Id: '1' }] }).records[0].fieldData.Tag, 'red');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
