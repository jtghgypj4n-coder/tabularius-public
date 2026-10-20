// FileMaker's keyboard shortcuts in a real browser, on a small database built
// here with no .fmp12: ⌘F, ⌘B and ⌘U switch modes, ⌘J shows all records, ⌘N
// and ⌘E make and delete records (and, in Find mode, requests), ⌘↓ and ⌘↑ move
// between records (and requests), and ⌘/ lists the shortcuts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// The generated form's Name field.
const NAME = 5;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  for (const [Id, Name] of [[1, 'Ada'], [2, 'Grace'], [3, 'Hedy']] as const) store.create('Customers', { Id, Name });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  // Shortcuts are tried with no field active, as after clicking the layout's background.
  await page.locator('.fm-part').first().click({ position: { x: 5, y: 5 } });
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

const key = (page: Page, k: string) => page.keyboard.press(`ControlOrMeta+${k}`);
const pressed = (page: Page) => page.getByRole('group', { name: 'Mode' }).locator('button[aria-pressed="true"]').textContent();
const count = (page: Page) => found(page).locator('b').textContent().then(Number);
const customers = () => hosted.store('Shop').find('Customers', { limit: 100 }).records.length;

test('⌘F finds, ⌘J shows all again, ⌘U previews and ⌘B comes back to Browse', { skip }, async () => {
  const page = await open();
  try {
    await key(page, 'f');
    await until(() => pressed(page), (m) => m === 'Find');
    await field(page, NAME).fill('Grace');
    await field(page, NAME).press('Enter');
    await until(() => pressed(page), (m) => m === 'Browse');
    await until(() => count(page), (n) => n === 1);
    assert.equal(await field(page, NAME).inputValue(), 'Grace');

    await page.locator('.fm-part').first().click({ position: { x: 5, y: 5 } });
    await key(page, 'j');
    await until(() => count(page), (n) => n === 3);

    await key(page, 'u');
    await until(() => pressed(page), (m) => m === 'Preview');
    await key(page, 'b');
    await until(() => pressed(page), (m) => m === 'Browse');
    await until(() => field(page, NAME).count(), (n) => n === 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('⌘↓ and ⌘↑ go to the next and previous record; ⌘N makes one and ⌘E deletes it, asking first', { skip }, async () => {
  const page = await open();
  try {
    await key(page, 'ArrowDown');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    await key(page, 'ArrowDown');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Hedy');
    await key(page, 'ArrowUp');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');

    await key(page, 'n');
    await until(() => count(page), (n) => n === 4);
    await field(page, NAME).fill('Katherine');
    await field(page, NAME).press('Tab');
    await until(async () => customers(), (n) => n === 4);

    await page.locator('.fm-part').first().click({ position: { x: 5, y: 5 } });
    await key(page, 'e');
    await answer(page, 'Delete Record', 'Cancel');
    assert.equal(customers(), 4, 'cancelled: still there');
    await key(page, 'e');
    await answer(page, 'Delete Record', 'Delete');
    await until(async () => customers(), (n) => n === 3);
    await until(() => count(page), (n) => n === 3);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('in Find mode ⌘N adds a request, ⌘↑ and ⌘↓ move between them and ⌘E deletes one', { skip }, async () => {
  const page = await open();
  try {
    await key(page, 'f');
    await until(() => pressed(page), (m) => m === 'Find');
    await field(page, NAME).fill('Ada');
    await key(page, 'n');
    await until(() => count(page), (n) => n === 2);
    await field(page, NAME).fill('Hedy');
    await key(page, 'ArrowUp');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
    await key(page, 'ArrowDown');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Hedy');
    // Two requests: Ada or Hedy.
    await field(page, NAME).press('Enter');
    // (In Find mode the toolbar counts requests, so the mode comes first.)
    await until(() => pressed(page), (m) => m === 'Browse');
    await until(() => count(page), (n) => n === 2);

    // Again, with the second request deleted: just Ada.
    await key(page, 'f');
    await until(() => pressed(page), (m) => m === 'Find');
    await field(page, NAME).fill('Ada');
    await key(page, 'n');
    await until(() => count(page), (n) => n === 2);
    await field(page, NAME).fill('Hedy');
    await key(page, 'e');
    await until(() => count(page), (n) => n === 1);
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
    await field(page, NAME).press('Enter');
    await until(() => pressed(page), (m) => m === 'Browse');
    await until(() => count(page), (n) => n === 1);
    assert.equal(await field(page, NAME).inputValue(), 'Ada');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('⌘/ lists the keyboard shortcuts', { skip }, async () => {
  const page = await open();
  try {
    await key(page, '/');
    const sheet = page.locator('dialog.shortcuts-sheet');
    await sheet.waitFor();
    const text = await sheet.textContent() ?? '';
    for (const name of ['New Record', 'Delete Record', 'Find Mode', 'Show All Records']) assert.match(text, new RegExp(name), `lists ${name}`);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
