// Records > Sort Records, in a real browser, on a small database built here
// with no .fmp12: fields added to the sort order, one turned descending, one
// moved up, one sorted in the order of a value list, Remove and Clear All,
// Cancel leaving the order as it was, and Unsort.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Id field.
const ID = 3;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] },
    { op: 'createValueList', name: 'Cities', values: ['Vienna', 'Paris', 'London'] },
  ] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'Paris' });
  store.create('Customers', { Id: 2, Name: 'Grace', City: 'London' });
  store.create('Customers', { Id: 3, Name: 'Alan', City: 'Vienna' });
  store.create('Customers', { Id: 4, Name: 'Barbara', City: 'London' });
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
  await until(() => field(page, ID).inputValue(), (v) => v !== '');
  return page;
}

/** The Ids of the found set, in order, read by going to each record. */
async function ids(page: Page): Promise<string[]> {
  const box = page.getByRole('textbox', { name: 'Record number' });
  const out: string[] = [];
  for (let i = 1; i <= 4; i++) {
    await until(async () => {
      if (await box.inputValue() !== String(i)) {
        await box.fill(String(i));
        await box.press('Enter');
      }
      return box.inputValue();
    }, (v) => v === String(i));
    out.push(await until(() => field(page, ID).inputValue(), (v) => v !== '' && !out.includes(v)));
  }
  return out;
}

/** Records > Sort Records…, and its dialog. */
async function sortDialog(page: Page) {
  await page.locator('.menubar').getByRole('button', { name: 'Records', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Sort Records/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Sort records' });
  await dialog.waitFor();
  return dialog;
}

async function add(dialog: ReturnType<Page['getByRole']>, name: string): Promise<void> {
  await dialog.getByRole('listbox', { name: 'Fields' }).selectOption(name);
  await dialog.getByRole('button', { name: 'Add →' }).click();
}

const order = (dialog: ReturnType<Page['getByRole']>) => dialog.getByRole('list', { name: 'Sort order' }).locator('li .name').allTextContents();

test('Sort Records sorts by several fields, one descending, and a field moved up comes first', { skip }, async () => {
  const page = await open();
  try {
    let dialog = await sortDialog(page);
    await add(dialog, 'Name');
    await add(dialog, 'City');
    assert.deepEqual(await order(dialog), ['Name', 'City']);
    // City first, then Name descending.
    await dialog.getByRole('button', { name: 'Move City up' }).click();
    assert.deepEqual(await order(dialog), ['City', 'Name']);
    await dialog.getByRole('combobox', { name: 'Order for Name' }).selectOption('descend');
    await dialog.getByRole('button', { name: 'Sort', exact: true }).click();
    await until(() => found(page).textContent(), (t) => /Total \(Sorted\)/.test(t ?? ''));
    assert.deepEqual(await ids(page), ['2', '4', '1', '3']);

    // The dialog opens on the order in force. Cancel leaves it.
    dialog = await sortDialog(page);
    assert.deepEqual(await order(dialog), ['City', 'Name']);
    assert.equal(await dialog.getByRole('combobox', { name: 'Order for Name' }).inputValue(), 'descend');
    await dialog.getByRole('button', { name: 'Remove Name' }).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(await ids(page), ['2', '4', '1', '3']);

    // Clear All and Sort: unsorted, in creation order.
    dialog = await sortDialog(page);
    await dialog.getByRole('button', { name: 'Clear All' }).click();
    assert.deepEqual(await dialog.getByRole('list', { name: 'Sort order' }).locator('li').allTextContents(), ['Unsorted']);
    await dialog.getByRole('button', { name: 'Sort', exact: true }).click();
    await until(() => found(page).textContent(), (t) => /Total \(Unsorted\)/.test(t ?? ''));
    assert.deepEqual(await ids(page), ['1', '2', '3', '4']);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a custom order based on a value list sorts in the list\'s order, and Unsort undoes it', { skip }, async () => {
  const page = await open();
  try {
    const dialog = await sortDialog(page);
    await add(dialog, 'City');
    await add(dialog, 'Name');
    await dialog.getByRole('combobox', { name: 'Order for City' }).selectOption('Cities');
    await dialog.getByRole('button', { name: 'Sort', exact: true }).click();
    await until(() => found(page).textContent(), (t) => /Total \(Sorted\)/.test(t ?? ''));
    // Vienna, Paris, London; the two in London by Name.
    assert.deepEqual(await ids(page), ['3', '1', '4', '2']);

    await page.locator('.menubar').getByRole('button', { name: 'Records', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Unsort', exact: true }).click();
    await until(() => found(page).textContent(), (t) => /Total \(Unsorted\)/.test(t ?? ''));
    assert.deepEqual(await ids(page), ['1', '2', '3', '4']);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
