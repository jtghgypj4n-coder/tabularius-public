// Field validation and auto-enter options in a real browser, on a small
// database built here with no .fmp12: a value that fails a check is not saved
// and the person is told why, and a new record gets its serial number,
// creation account and calculated value without anyone typing them.
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
const ids: Record<string, number> = {};

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [
      { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '100', increment: 5 }, prohibitModification: true } } },
      { name: 'Code', options: { validation: { notEmpty: true, unique: true, strict: true, message: 'Every item needs its own code.' } } },
      { name: 'Qty', type: 'number', options: { validation: { range: { min: '1', max: '99' }, strict: true } } },
      { name: 'Label', calculation: 'Upper ( Code )', options: { autoEnter: { calculation: true, replaceExisting: true } } },
      { name: 'Maker', options: { autoEnter: { value: 'creationAccountName' } } },
    ] },
  ] as DesignOp[]);
  for (const o of store.design('Items')!.objects) if (o.kind === 'field' && o.field?.field) ids[o.field.field] = o.id;
  store.create('Items', { Code: 'ab-1', Qty: 3 });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Every item as the file holds it, in creation order. */
function items(): Record<string, unknown>[] {
  return hosted.store('Shop').find('Items', { limit: 100 }).records.map((r) => r.fieldData);
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${ids.Code}"]`).count(), (n) => n === 1);
  await until(() => field(page, ids.Code).inputValue(), (v) => v !== '');
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

/** Reverts the record on screen (Records > Revert Record…), so a record left failing its checks isn't committed on logging out. */
async function revert(page: Page): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: 'Records' }).click();
  await page.getByRole('menuitem', { name: 'Revert Record…' }).click();
  await answer(page, 'Revert Record', 'Revert');
}

/** Text the window shows the person: toasts and any open dialog. */
const told = (page: Page) => page.locator('.toast, dialog[open]').allTextContents().then((t) => t.join(' | '));

test('a new record gets its serial number, the account that made it and its calculated value', { skip }, async () => {
  const page = await open();
  try {
    assert.equal(items()[0].Serial, 100);
    assert.equal(items()[0].Label, 'AB-1');
    await page.locator('button.tb', { hasText: 'New Record' }).first().click();
    await until(() => found(page).locator('b').textContent(), (t) => t === '2');
    await until(() => field(page, ids.Serial).inputValue(), (v) => v === '105');
    assert.equal(await field(page, ids.Maker).inputValue(), 'Ann');
    await field(page, ids.Code).fill('cd-2');
    await field(page, ids.Code).press('Tab');
    await until(() => field(page, ids.Label).inputValue(), (v) => v === 'CD-2');
    await until(async () => items()[1]?.Label, (v) => v === 'CD-2');
    // A serial number people can't change.
    assert.equal(await field(page, ids.Serial).evaluate((e) => (e as HTMLInputElement).readOnly), true);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a new record is made empty, and its required field is checked when it is committed', { skip }, async () => {
  const page = await open();
  try {
    const before = items().length;
    const tool = (label: string) => page.locator('button.tb', { hasText: label }).first();
    await tool('New Record').click();
    await until(() => found(page).locator('b').textContent(), (t) => Number(t) === before + 1);
    assert.equal(items().length, before + 1, 'made, though Code is empty');

    // Committing it (here, by asking for another new record) says what is wrong; OK stays on it to fix it.
    await tool('New Record').click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Every item needs its own code.' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(Number(await found(page).locator('b').textContent()), before + 1, 'no second record');
    assert.equal(await field(page, ids.Code).inputValue(), '');

    // Revert Record takes it away.
    await tool('New Record').click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Revert Record' }).click();
    await until(() => found(page).locator('b').textContent(), (t) => Number(t) === before + 1);
    await until(async () => items().length, (n) => n === before + 1);
    assert.equal(items().filter((r) => r.Code === '').length, 1, 'the empty record is gone; the new one asked for is the one there now');
    await revert(page);
    await until(async () => items().length, (n) => n === before);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a value that fails validation is not saved, and the person is told why', { skip }, async () => {
  const page = await open();
  try {
    const before = items().length;
    await page.locator('button.tb', { hasText: 'New Record' }).first().click();
    await until(() => found(page).locator('b').textContent(), (t) => Number(t) === before + 1);

    // Not unique: the field's own message.
    await field(page, ids.Code).fill('ab-1');
    await field(page, ids.Code).press('Tab');
    await until(() => told(page), (t) => t.includes('Every item needs its own code.'));
    assert.equal(items().filter((r) => r.Code === 'ab-1').length, 1, 'the duplicate code is not in the file');

    // Out of range.
    await field(page, ids.Qty).fill('500');
    await field(page, ids.Qty).press('Tab');
    await until(() => told(page), (t) => /between 1 and 99|range/i.test(t));
    assert.ok(!items().some((r) => r.Qty === 500), 'the quantity out of range is not in the file');
    await revert(page);
    await until(async () => items().length, (n) => n === before);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
