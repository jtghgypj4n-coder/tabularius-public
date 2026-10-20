// The Records menu and the cursor's way through a layout, in a real browser,
// on a small database built here with no .fmp12: Show Omitted Only, Omit
// Multiple, Revert Record (of changes already saved, and of a new record),
// and a layout's own tab order.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
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
  // Tab goes Id, City, Name: not top to bottom.
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { tabOrder: [ID, CITY, NAME] } }] as DesignOp[]);
  for (const [Id, Name, City] of [[1, 'Ada', 'Leeds'], [2, 'Alan', 'York'], [3, 'Grace', 'Leeds'], [4, 'Edsger', 'Paris'], [5, 'Barbara', 'York']] as const) {
    store.create('People', { Id, Name, City });
  }
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Record `id` as the file holds it, or undefined when there is none. */
function person(id: number): Record<string, unknown> | undefined {
  return hosted.store('Town').find('People', { query: [{ Id: `==${id}` }] }).records[0]?.fieldData;
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${ID}"]`).count(), (n) => n === 1);
  await goTo(page, 1);
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

/** Goes to record `n` of the found set (from 1) with the toolbar's record number box. */
async function goTo(page: Page, n: number): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Record number' });
  await until(async () => {
    if (await box.inputValue() !== String(n)) {
      await box.fill(String(n));
      await box.press('Enter');
    }
    return box.inputValue();
  }, (v) => v === String(n));
}

/** Picks Records > `item` from the menu bar. */
async function records(page: Page, item: string): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: 'Records' }).click();
  await page.getByRole('menuitem', { name: item }).click();
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

test('Omit Multiple takes out records from the current one on, and Show Omitted Only swaps the found set', { skip }, async () => {
  const page = await open();
  try {
    await goTo(page, 2);
    await records(page, 'Omit Multiple…');
    assert.match(await answer(page, 'Omit Multiple', 'Omit', '2'), /Omit how many records/);
    await until(() => found(page).locator('b').textContent(), (t) => t === '3');
    assert.deepEqual(await foundIds(page), ['1', '4', '5']);

    await records(page, 'Show Omitted Only');
    await until(() => found(page).locator('b').textContent(), (t) => t === '2');
    assert.deepEqual(await foundIds(page), ['2', '3']);
    // And back again.
    await records(page, 'Show Omitted Only');
    await until(() => found(page).locator('b').textContent(), (t) => t === '3');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Revert Record puts back the record as it was before it was changed, after asking', { skip }, async () => {
  const page = await open();
  try {
    await field(page, NAME).fill('Countess');
    await field(page, NAME).press('Tab');
    await until(async () => person(1)?.Name, (n) => n === 'Countess');

    // Cancelling the question leaves the change.
    await records(page, 'Revert Record…');
    await answer(page, 'Revert Record', 'Cancel');
    assert.equal(person(1)?.Name, 'Countess');

    await records(page, 'Revert Record…');
    assert.match(await answer(page, 'Revert Record', 'Revert'), /Revert record/);
    await until(async () => person(1)?.Name, (n) => n === 'Ada');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Revert Record on a new record never committed takes it away', { skip }, async () => {
  const page = await open();
  try {
    await page.locator('button.tb', { hasText: 'New Record' }).first().click();
    await until(() => found(page).locator('b').textContent(), (t) => t === '6');
    await field(page, ID).fill('9');
    await field(page, ID).press('Tab');
    await until(async () => person(9), (p) => p !== undefined);
    await records(page, 'Revert Record…');
    await answer(page, 'Revert Record', 'Revert');
    await until(async () => person(9), (p) => p === undefined);
    await until(() => found(page).locator('b').textContent(), (t) => t === '5');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Tab follows the layout\'s own tab order, and Shift+Tab goes back along it', { skip }, async () => {
  const page = await open();
  try {
    const at = () => page.evaluate(() => document.activeElement?.closest<HTMLElement>('.fm[data-id]')?.dataset.id);
    await field(page, ID).click();
    await page.keyboard.press('Tab');
    await until(at, (id) => id === String(CITY));
    await page.keyboard.press('Tab');
    await until(at, (id) => id === String(NAME));
    await page.keyboard.press('Shift+Tab');
    await until(at, (id) => id === String(CITY));
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Records > Go to Record/Request/Page moves to the next and previous record and asks for a number', { skip }, async () => {
  const page = await open();
  try {
    const box = page.getByRole('textbox', { name: 'Record number' });
    const goToItem = async (item: string) => {
      await page.locator('.menubar').getByRole('button', { name: 'Records' }).click();
      await page.getByRole('menuitem', { name: 'Go to Record/Request/Page' }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    };
    await goToItem('Next');
    await until(() => box.inputValue(), (v) => v === '2');
    await goToItem('Next');
    await until(() => box.inputValue(), (v) => v === '3');
    await goToItem('Previous');
    await until(() => box.inputValue(), (v) => v === '2');
    await goToItem('Specify…');
    await answer(page, 'Go to Record', 'Go', '5');
    await until(() => box.inputValue(), (v) => v === '5');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Help > About shows the server version', { skip }, async () => {
  const page = await open();
  try {
    await page.locator('.menubar').getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'About Tabularius' }).click();
    const dialog = page.getByRole('dialog', { name: /Tabularius/i });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Tabularius \d+\.\d+\.\d+/);
    await dialog.getByRole('button', { name: 'OK' }).click();
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
