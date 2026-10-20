// Edit > Find/Replace in the web client, in a real browser, on a small
// database built here with no .fmp12: Find Next selects each match in the
// fields and goes on to the next record that has one, round the found set;
// Match case and whole words narrow it; Replace changes the selected match;
// Replace All changes the found set (or only this record) on the server, after
// asking, and Undo on its toast takes it back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name and Note fields.
const NAME = 5;
const NOTE = 7;
const NOTES = ['a red apple', 'Apple pie for Grace', 'pineapple and apple'];

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Note' }] }] as DesignOp[]);
  for (const [i, Name] of ['Ada', 'Grace', 'Hedy'].entries()) store.create('Customers', { Id: i + 1, Name, Note: NOTES[i] });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The notes as the file holds them, in Id order. */
function notes(): string[] {
  return hosted.store('Shop').find('Customers', { query: [{ Id: '*' }], sort: [{ fieldName: 'Id' }] }).records.map((r) => String(r.fieldData.Note));
}
function putBack(): void {
  const store = hosted.store('Shop');
  for (const r of store.find('Customers', { query: [{ Id: '*' }] }).records) store.update('Customers', Number(r.recordId), { Note: NOTES[Number(r.fieldData.Id) - 1] });
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  await page.locator('.menubar').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Find/Replace' }).first().hover();
  await page.getByRole('menuitem', { name: 'Find/Replace…' }).click();
  await dialog(page).waitFor();
  return page;
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Find/Replace' });
/** The record shown and the text selected in the field the cursor is in. */
const selected = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLInputElement | null;
  const name = (document.querySelector('.fm[data-id="5"] input') as HTMLInputElement | null)?.value;
  return `${name}: ${el && 'selectionStart' in el ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0) : ''}`;
});
const statusText = (page: Page) => dialog(page).locator('.find-status').textContent().then((t) => t ?? '');

test('Find Next selects each match, record after record and round the found set; match case and whole words narrow it', { skip }, async () => {
  const page = await open();
  try {
    await dialog(page).getByLabel('Find what').fill('apple');
    const next = dialog(page).getByRole('button', { name: 'Find Next' });
    await next.click();
    await until(() => selected(page), (s) => s === 'Ada: apple');
    await next.click();
    await until(() => selected(page), (s) => s === 'Grace: Apple');
    // Two in Hedy's note: inside "pineapple", then the word.
    await next.click();
    await until(() => selected(page), (s) => s === 'Hedy: apple');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).selectionStart), 4);
    await next.click();
    await until(() => page.evaluate(() => (document.activeElement as HTMLInputElement).selectionStart), (n) => n === 14);
    // Direction All goes round to the first record.
    await next.click();
    await until(() => selected(page), (s) => s === 'Ada: apple');

    // Whole words: not the "apple" in "pineapple". Match case: not "Apple".
    await dialog(page).getByLabel('Match whole words only').check();
    await dialog(page).getByLabel('Match case').check();
    await next.click();
    await until(() => selected(page), (s) => s === 'Hedy: apple');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).selectionStart), 14);

    // Nothing else to find: it says so.
    await dialog(page).getByLabel('Find what').fill('banana');
    await next.click();
    await until(() => statusText(page), (t) => t === 'No matches for “banana”.');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('Replace changes the selected match, and Replace All the found set after asking, which Undo takes back', { skip }, async () => {
  const page = await open();
  try {
    await dialog(page).getByLabel('Find what').fill('apple');
    await dialog(page).getByLabel('Replace with').fill('pear');
    await dialog(page).getByRole('button', { name: 'Find Next' }).click();
    await until(() => selected(page), (s) => s === 'Ada: apple');
    await dialog(page).getByRole('button', { name: 'Replace', exact: true }).click();
    await until(() => field(page, NOTE).inputValue(), (v) => v === 'a red pear');
    // Saved when the field is left, as typing would be.
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await page.locator('.content').click({ position: { x: 600, y: 400 } });
    await until(async () => notes()[0], (n) => n === 'a red pear');

    // Replace All, over the found set: asked first; cancelling changes nothing.
    await page.locator('.menubar').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Find/Replace' }).first().hover();
    await page.getByRole('menuitem', { name: 'Find/Replace…' }).click();
    await dialog(page).getByRole('button', { name: 'Replace All' }).click();
    assert.equal(await answer(page, 'Replace All', 'Cancel'), 'Replace every “apple” with “pear” in all 3 records of the found set?');
    assert.deepEqual(notes(), ['a red pear', 'Apple pie for Grace', 'pineapple and apple']);
    await dialog(page).getByRole('button', { name: 'Replace All' }).click();
    await answer(page, 'Replace All', 'Replace All');
    await until(async () => notes().join('|'), (n) => n === 'a red pear|pear pie for Grace|pinepear and pear');
    await until(() => field(page, NOTE).inputValue(), (v) => v === 'a red pear');

    // Its toast's Undo puts back what Replace All changed.
    await page.getByRole('button', { name: 'Undo' }).last().click();
    await until(async () => notes().join('|'), (n) => n === 'a red pear|Apple pie for Grace|pineapple and apple');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
    putBack();
  }
});

test('Replace All across the current record only leaves the others alone', { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Next record' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    await dialog(page).getByLabel('Find what').fill('apple');
    await dialog(page).getByLabel('Replace with').fill('plum');
    await dialog(page).getByLabel('Search across').selectOption('current');
    await dialog(page).getByRole('button', { name: 'Replace All' }).click();
    const asked = await answer(page, 'Replace All', 'Replace All');
    await until(async () => notes().join('|'), (n) => n === 'a red apple|plum pie for Grace|pineapple and apple');
    assert.match(asked, /in this record\?$/);
    await until(() => field(page, NOTE).inputValue(), (v) => v === 'plum pie for Grace');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
    putBack();
  }
});
