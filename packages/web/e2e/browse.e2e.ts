// Everyday browse and find work in a real browser, on a small database built
// here with no .fmp12: find mode (a find, Constrain, Extend, an Omit request),
// Omit Record and Show All, new and deleted records, the toolbar's sort, and
// Insert > From Index.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
const PEOPLE: [number, string, string][] = [
  [1, 'Ada', 'Leeds'], [2, 'Alan', 'York'], [3, 'Grace', 'Leeds'], [4, 'Alan', 'Leeds'], [5, 'Edsger', 'Paris'], [6, 'Barbara', 'York'],
];
// Layout object ids of the generated form's fields, looked up by name.
let ID = 0;
let NAME = 0;
let CITY = 0;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Town'] });
  const store = hosted.store('Town');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  const design = store.design('People')!;
  const idOf = (name: string) => design.objects.find((o) => o.kind === 'field' && o.field?.field === name)!.id;
  ID = idOf('Id');
  NAME = idOf('Name');
  CITY = idOf('City');
  for (const [Id, Name, City] of PEOPLE) store.create('People', { Id, Name, City });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The people the file holds, by Id. */
function people(): string[] {
  return hosted.store('Town').find('People', { limit: 100 }).records.map((r) => `${r.fieldData['Id']} ${r.fieldData['Name']}`);
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
  // The generated layout opens as a list; one record at a time reads simpler.
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${ID}"]`).count(), (n) => n === 1);
  await until(() => field(page, NAME).inputValue(), (v) => v !== '');
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

const tool = (page: Page, label: string) => page.locator('button.tb', { hasText: label }).first();

/** Goes to record `n` of the found set (from 1) with the toolbar's record number box. */
async function goTo(page: Page, n: number): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Record number' });
  // The toolbar is redrawn as the window updates; type again if a redraw took what was typed.
  await until(async () => {
    if (await box.inputValue() !== String(n)) {
      await box.fill(String(n));
      await box.press('Enter');
    }
    return box.inputValue();
  }, (v) => v === String(n));
}

/** The Ids of the found set, in order. */
async function foundIds(page: Page): Promise<string[]> {
  const n = Number(await found(page).locator('b').textContent());
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    await goTo(page, i);
    ids.push(await until(() => field(page, ID).inputValue(), (v) => v !== '' && !ids.includes(v)));
  }
  return ids;
}

/** Find mode with one request: `criteria` typed into the fields, by layout object id. */
async function request(page: Page, criteria: Record<number, string>): Promise<void> {
  for (const [id, value] of Object.entries(criteria)) await field(page, Number(id)).fill(value);
}

test('find, constrain, extend, an omit request, Omit Record and Show All', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await request(page, { [CITY]: 'Leeds' });
    await tool(page, 'Perform Find').click();
    await until(() => found(page).textContent(), (t) => /^3Found \(Unsorted\)6 Total$/.test(t ?? ''));
    assert.deepEqual(await foundIds(page), ['1', '3', '4']);

    // Constrain: only those of the three named Alan.
    await tool(page, 'Find').click();
    await request(page, { [NAME]: 'Alan' });
    await tool(page, 'Constrain').click();
    await until(() => found(page).locator('b').textContent(), (t) => t === '1');
    await until(() => field(page, ID).inputValue(), (v) => v === '4');

    // Extend: plus everyone in Paris.
    await tool(page, 'Find').click();
    await request(page, { [CITY]: 'Paris' });
    await tool(page, 'Extend').click();
    await until(() => found(page).locator('b').textContent(), (t) => t === '2');
    assert.deepEqual((await foundIds(page)).sort(), ['4', '5']);

    // An Omit request finds everyone not in York.
    await tool(page, 'Find').click();
    await request(page, { [CITY]: 'York' });
    await page.getByRole('group', { name: 'Matching Records' }).getByRole('button', { name: 'Omit' }).click();
    await tool(page, 'Perform Find').click();
    await until(() => found(page).locator('b').textContent(), (t) => t === '4');
    assert.deepEqual(await foundIds(page), ['1', '3', '4', '5']);

    // Omit Record (⌘T) takes the record on screen out of the found set.
    await until(() => field(page, ID).inputValue(), (v) => v === '5');
    await page.keyboard.press('ControlOrMeta+t');
    await until(() => found(page).locator('b').textContent(), (t) => t === '3');
    assert.deepEqual(await foundIds(page), ['1', '3', '4']);

    await tool(page, 'Show All').click();
    await until(() => found(page).textContent(), (t) => /^6Total \(Unsorted\)$/.test(t ?? ''));
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a new record is saved when you leave its field, and Delete Record asks first', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'New Record').click();
    await until(() => found(page).locator('b').textContent(), (t) => t === '7');
    await field(page, ID).fill('7');
    await field(page, NAME).fill('Hedy');
    await field(page, NAME).press('Tab');
    await until(async () => people(), (p) => p.includes('7 Hedy'));

    // Dismissing the confirmation keeps the record.
    await tool(page, 'Delete Record').click();
    await answer(page, 'Delete Record', 'Cancel');
    assert.ok(people().includes('7 Hedy'));

    await tool(page, 'Delete Record').click();
    assert.match(await answer(page, 'Delete Record', 'Delete'), /delete this ENTIRE record/);
    await until(async () => people(), (p) => !p.includes('7 Hedy'));
    await until(() => found(page).locator('b').textContent(), (t) => t === '6');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('the toolbar\'s Sort by sorts the found set, and its arrow turns the order round', { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption('Name');
    await until(() => found(page).textContent(), (t) => /Total \(Sorted\)/.test(t ?? ''));
    const names = async () => {
      const ids = await foundIds(page);
      return ids.map((id) => PEOPLE.find((p) => String(p[0]) === id)![1]);
    };
    assert.deepEqual(await names(), ['Ada', 'Alan', 'Alan', 'Barbara', 'Edsger', 'Grace']);
    await page.getByRole('button', { name: '↑' }).click();
    await until(() => page.getByRole('button', { name: '↓' }).count(), (n) => n === 1);
    assert.deepEqual(await names(), ['Grace', 'Edsger', 'Barbara', 'Alan', 'Alan', 'Ada']);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Insert > From Index (⌘I) pastes a value the field holds in another record', { skip }, async () => {
  const page = await open();
  try {
    await goTo(page, (await foundIds(page)).indexOf('1') + 1);
    await until(() => field(page, ID).inputValue(), (v) => v === '1');
    await field(page, CITY).click();
    await field(page, CITY).selectText();
    await page.keyboard.press('ControlOrMeta+i');
    const dialog = page.getByRole('dialog', { name: 'View Index' });
    await dialog.waitFor();
    assert.deepEqual(await dialog.getByRole('listbox', { name: 'Index values' }).locator('option').allTextContents(), ['Leeds', 'Paris', 'York']);
    await dialog.getByRole('listbox', { name: 'Index values' }).selectOption('Paris');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await until(() => field(page, CITY).inputValue(), (v) => v === 'Paris');
    await field(page, CITY).press('Tab');
    await until(async () => hosted.store('Town').find('People', { query: [{ Id: '==1' }] }).records[0].fieldData['City'], (v) => v === 'Paris');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
