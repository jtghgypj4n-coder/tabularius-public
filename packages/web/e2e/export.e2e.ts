// Export Records, Save Records as Excel and Save Records as PDF from the web
// client's File menu, in a real browser, on a small database built here with
// no .fmp12: the file downloaded holds the found set, in its order, with the
// fields ticked, in the type picked. An account whose privilege set doesn't
// allow exporting or printing isn't offered them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  for (const [Id, Name, City] of [[1, 'Ada', 'London'], [2, 'Hedy', 'Vienna'], [3, 'Alan', 'Wilmslow']] as const) store.create('Customers', { Id, Name, City });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.savePrivilegeSet({ name: 'Readers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmwebdirect'], printing: false, exporting: false });
  store.setPassword('Rex', 'rex-secret-1', 'Readers');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Signed in, in form view, on the found set of Ada and Alan (a find for "a"). */
async function open(account = 'Ann', password = 'ann-secret-1'): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', account, password);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  await page.keyboard.press('ControlOrMeta+f');
  await field(page, NAME).fill('a');
  await page.keyboard.press('Enter');
  await until(() => found(page).textContent(), (t) => /^2Found/.test(t ?? ''));
  return page;
}

async function fileMenu(page: Page, ...path: string[]): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  for (const [i, name] of path.entries()) {
    // A submenu's name carries its arrow.
    if (i < path.length - 1) await page.getByRole('menuitem', { name }).first().hover();
    else await page.getByRole('menuitem', { name, exact: true }).click();
  }
}

/** Runs `start`, and gives back the file the browser downloads because of it. */
async function download(page: Page, start: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent('download'), start()]);
  return { name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) };
}

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

test('Export Records downloads the found set with the fields ticked, as comma- or tab-separated text', { skip }, async () => {
  const page = await open();
  try {
    await fileMenu(page, 'Export Records…');
    const d = dialog(page, 'Export Records');
    await d.getByText('The 2 record(s) of the found set').waitFor();
    await d.getByLabel('Id', { exact: true }).uncheck();
    await d.getByLabel('Field names in the first row').check();
    await d.getByLabel('File name').fill('customers');
    const csv = await download(page, () => d.getByRole('button', { name: 'Export' }).click());
    assert.equal(csv.name, 'customers.csv');
    assert.deepEqual(csv.bytes.toString('utf8').trim().split(/\r?\n/), ['"Name","City"', '"Ada","London"', '"Alan","Wilmslow"']);

    await fileMenu(page, 'Export Records…');
    await dialog(page, 'Export Records').getByLabel('Type').selectOption('tab');
    const tab = await download(page, () => dialog(page, 'Export Records').getByRole('button', { name: 'Export' }).click());
    assert.equal(tab.name, 'Customers.tab');
    assert.deepEqual(tab.bytes.toString('utf8').trim().split(/\r?\n/), ['1\tAda\tLondon', '3\tAlan\tWilmslow']);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('Save Records as Excel downloads a workbook, and Save Records as PDF a PDF of the records or the current one', { skip }, async () => {
  const page = await open();
  try {
    await fileMenu(page, 'Save/Send Records As', 'Excel…');
    await dialog(page, 'Export Records').getByRole('heading', { name: 'Save Records as Excel' }).waitFor();
    const xlsx = await download(page, () => dialog(page, 'Export Records').getByRole('button', { name: 'Export' }).click());
    assert.equal(xlsx.name, 'Customers.xlsx');
    assert.equal(xlsx.bytes.subarray(0, 2).toString('latin1'), 'PK', 'a zip, as a workbook is');
    assert.ok(xlsx.bytes.includes('xl/worksheets/sheet1.xml'));

    await fileMenu(page, 'Save/Send Records As', 'PDF…');
    const d = dialog(page, 'Save Records as PDF');
    await d.getByLabel('Save').selectOption('current');
    const pdf = await download(page, () => d.getByRole('button', { name: 'Save' }).click());
    assert.equal(pdf.name, 'Customers.pdf');
    assert.equal(pdf.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(pdf.bytes.toString('latin1'), /\/Count 1\b/, 'one page, for the current record');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('an account not allowed to export or print isn\'t offered Export Records, Save Records As or Print', { skip }, async () => {
  const page = await open('Rex', 'rex-secret-1');
  try {
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    // The menu is open: the File menu's other commands are there.
    await page.getByRole('menuitem', { name: /^Close/ }).first().waitFor();
    for (const name of ['Export Records…', 'Save/Send Records As', 'Print…']) {
      const item = page.getByRole('menuitem', { name });
      assert.ok((await item.count()) === 0 || (await item.getAttribute('aria-disabled')) === 'true', `${name} is offered`);
    }
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
