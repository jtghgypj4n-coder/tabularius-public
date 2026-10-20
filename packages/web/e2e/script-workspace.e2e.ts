// The Script Workspace and value lists of Manage Database, in a real browser,
// on a small database built here with no .fmp12: a script made and written in
// the browser, saved, and run from the Scripts menu in Browse mode; a change
// to it not saved goes back with Revert; and a value list made here, used as
// a field's "member of value list" check, refuses a value not in it.
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
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'London' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Signed in, then in Manage Database on the tab named. */
async function design(tab: string): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Database…' }).click();
  await page.getByRole('tab', { name: tab }).click();
  return page;
}

async function backToBrowse(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Back to browse' }).click();
  await page.locator('select.layout-menu').waitFor();
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v !== '');
}

const steps = (name: string) => hosted.store('Shop').schema.scripts.find((s) => s.name === name)?.steps.map((s) => s.line ?? s.name) ?? [];

test('a script written in the Script Workspace is saved, and runs from the Scripts menu', { skip }, async () => {
  const page = await design('Scripts');
  try {
    await page.getByLabel('New script name').fill('Greet');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const text = page.getByLabel('Steps of Greet');
    await text.waitFor();
    await text.fill('Set Field [ Customers::City ; "Hello from " & Customers::Name ]\nCommit Records/Requests [ With dialog: Off ]');
    await page.getByRole('button', { name: 'Save script' }).click();
    await until(async () => steps('Greet').length, (n) => n === 2);
    assert.match(steps('Greet')[0], /^Set Field \[ Customers::City ; "Hello from " & Customers::Name \]/);

    // A change not saved goes back with Revert.
    await text.fill('Beep');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Revert', exact: true }).click();
    await until(() => text.inputValue(), (v) => v.startsWith('Set Field'));
    assert.equal(steps('Greet').length, 2);

    await backToBrowse(page);
    await page.locator('.menubar').getByRole('button', { name: 'Scripts', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Greet', exact: true }).click();
    await until(() => field(page, CITY).inputValue(), (v) => v === 'Hello from Ada');
    await until(async () => String(hosted.store('Shop').find('Customers', { query: [{ Id: '1' }] }).records[0].fieldData.City), (v) => v === 'Hello from Ada');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a value list made in Manage Database, as a field\'s "member of value list" check, refuses other values', { skip }, async () => {
  const page = await design('Value lists');
  try {
    await page.getByLabel('New value list name').fill('Cities');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByLabel('Values, one per line').fill('London\nParis\nVienna');
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await until(async () => hosted.store('Shop').schema.valueLists.find((v) => v.name === 'Cities')?.values?.join(',') ?? '', (v) => v === 'London,Paris,Vienna');

    // City: a member of Cities.
    await page.getByRole('tab', { name: 'Tables & fields' }).click();
    await page.locator('.d-grid > tbody > tr', { has: page.locator('td:first-child', { hasText: /^City/ }) }).click();
    const editor = page.locator('form.d-editor');
    await editor.getByLabel('Member of value list').selectOption({ label: 'Cities' });
    await editor.getByRole('button', { name: 'Save field' }).click();
    await until(async () => hosted.store('Shop').schema.tables.find((t) => t.name === 'Customers')?.fields.find((f) => f.name === 'City')?.options?.validation?.valueList, (v) => v !== undefined);

    await backToBrowse(page);
    await field(page, CITY).fill('Rome');
    await field(page, CITY).press('Tab');
    await until(() => page.locator('.toast').allTextContents().then((t) => t.join(' | ')), (t) => t.includes('Field "City" must be a value from its value list (error 506)'));
    assert.notEqual(String(hosted.store('Shop').find('Customers', { query: [{ Id: '1' }] }).records[0].fieldData.City), 'Rome');
    // In it: saved.
    await field(page, CITY).fill('Paris');
    await field(page, CITY).press('Tab');
    await until(async () => String(hosted.store('Shop').find('Customers', { query: [{ Id: '1' }] }).records[0].fieldData.City), (v) => v === 'Paris');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
