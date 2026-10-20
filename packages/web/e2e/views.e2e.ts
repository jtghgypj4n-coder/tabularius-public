// List view and Table view in a real browser, on a small database built here
// with no .fmp12: editing a record in its row, sorting by a column heading, and
// a new record in Table view. Each test checks what reaches the file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
let NAME = 0;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Crew'] });
  const store = hosted.store('Crew');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  NAME = store.design('People')!.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!.id;
  store.create('People', { Id: 1, Name: 'Grace', City: 'York' });
  store.create('People', { Id: 2, Name: 'Ada', City: 'Leeds' });
  store.create('People', { Id: 3, Name: 'Edsger', City: 'Paris' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const person = (id: number) => hosted.store('Crew').find('People', { query: [{ Id: `==${id}` }] }).records[0]?.fieldData ?? {};

async function open(view: 'List' | 'Table'): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Crew', 'Ann', PASSWORD);
  await page.getByRole('button', { name: `View as ${view}` }).click();
  await until(() => page.getByRole('button', { name: `View as ${view}` }).getAttribute('aria-pressed'), (v) => v === 'true');
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

test('List view: a field typed in on the second row changes the second record', { skip }, async () => {
  const page = await open('List');
  try {
    const names = page.locator(`.fm[data-id="${NAME}"]`).locator('input, textarea');
    await until(() => names.count(), (n) => n === 3);
    assert.equal(await names.nth(1).inputValue(), 'Ada');
    await names.nth(1).fill('Ada Lovelace');
    await names.nth(1).press('Tab');
    await until(async () => person(2).Name, (v) => v === 'Ada Lovelace');
    assert.equal(person(1).Name, 'Grace');
    assert.equal(person(3).Name, 'Edsger');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Table view: a cell edits its record, and a column heading sorts by that field', { skip }, async () => {
  const page = await open('Table');
  try {
    const cell = (field: string, row: number) => page.getByRole('textbox', { name: `${field}, record ${row}` });
    await until(() => cell('City', 3).inputValue(), (v) => v === 'Paris');
    await cell('City', 3).fill('Delft');
    await cell('City', 3).press('Tab');
    await until(async () => person(3).City, (v) => v === 'Delft');

    const column = async () => [await cell('Name', 1).inputValue(), await cell('Name', 2).inputValue(), await cell('Name', 3).inputValue()];
    await page.getByRole('columnheader', { name: 'Name' }).click();
    await until(column, (c) => c.join() === 'Ada Lovelace,Edsger,Grace');
    assert.equal(await page.getByRole('columnheader', { name: 'Name' }).getAttribute('aria-sort'), 'ascending');
    await page.getByRole('columnheader', { name: 'Name' }).click();
    await until(column, (c) => c.join() === 'Grace,Edsger,Ada Lovelace');
    assert.equal(await page.getByRole('columnheader', { name: 'Name' }).getAttribute('aria-sort'), 'descending');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Table view: column headings sort, move and resize from the keyboard', { skip }, async () => {
  const page = await open('Table');
  try {
    const headings = () => page.locator('table.table-view thead th').evaluateAll((ths) => ths.map((th) => th.textContent?.trim()));
    const start = await until(headings, (h) => h.includes('Name') && h.includes('City'));
    const name = page.getByRole('columnheader', { name: 'Name' });
    await name.focus();
    await page.keyboard.press('Enter');
    await until(() => name.getAttribute('aria-sort'), (v) => v === 'ascending');
    // ⌥→ moves Name one place right, and the heading keeps the focus.
    const at = start.indexOf('Name');
    await page.getByRole('columnheader', { name: 'Name' }).focus();
    await page.keyboard.press('Alt+ArrowRight');
    const moved = await until(headings, (h) => h.indexOf('Name') === at + 1);
    assert.equal(moved.length, start.length);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Name');
    // ⇧→ widens it by 10 points.
    const width = async () => parseFloat(await page.getByRole('columnheader', { name: 'Name' }).evaluate((th) => (th as HTMLElement).style.width));
    const w0 = await width();
    await page.keyboard.press('Shift+ArrowRight');
    await until(width, (w) => w === w0 + 10);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Table view: New Record adds a row to type the record in', { skip }, async () => {
  const page = await open('Table');
  try {
    await page.locator('button.tb', { hasText: 'New Record' }).click();
    await until(() => found(page).locator('b').textContent(), (t) => t === '4');
    const row = 4;
    const name = page.getByRole('textbox', { name: `Name, record ${row}` });
    await name.fill('Hedy');
    await name.press('Tab');
    await until(async () => hosted.store('Crew').find('People', { limit: 10 }).records.map((r) => r.fieldData.Name), (n) => n.includes('Hedy'));
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
