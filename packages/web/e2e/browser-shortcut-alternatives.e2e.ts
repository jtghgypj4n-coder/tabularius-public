// Alt-based alternatives to browser-reserved shortcuts, plus the corresponding
// menu commands, in a real browser. Ctrl/Cmd+N, T and W are deliberately not sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let name = 0;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as DesignOp[]);
  name = store.design('People')!.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!.id;
  for (const Name of ['Ada', 'Grace', 'Hedy', 'Katherine']) store.create('People', { Name });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const all = () => hosted.store('Shop').find('People', { limit: 100 }).records.length;
const foundCount = (page: Page) => found(page).locator('b').textContent().then(Number);
async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, name).inputValue(), (v) => v === 'Ada');
  await page.locator('.fm-part').first().click({ position: { x: 5, y: 5 } });
  return page;
}
async function command(page: Page, menu: string, item: string): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}
async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

test('Alt shortcuts and menu commands work for New Record, Omit, Omit Multiple, Close and Insert User Name', { skip }, async () => {
  const page = await open();
  try {
    // Alt+N makes a record; the FileMaker menu command does too.
    await page.keyboard.press('Control+Alt+n');
    await until(async () => all(), (n) => n === 5);
    await field(page, name).fill('Alt New');
    await field(page, name).press('Tab');
    await command(page, 'Records', 'New Record');
    await until(async () => all(), (n) => n === 6);
    await field(page, name).fill('Menu New');
    await field(page, name).press('Tab');

    // Alt+Shift+N inserts the current account name; so does Insert > Current User Name.
    await field(page, name).fill('');
    await field(page, name).click();
    await page.keyboard.press('Control+Alt+Shift+n');
    await until(() => field(page, name).inputValue(), (v) => v === 'Ann');
    await command(page, 'Insert', 'Current User Name');
    await until(() => field(page, name).inputValue(), (v) => v === 'AnnAnn');
    await field(page, name).press('Tab');

    // Omit shortcuts are tested on the current record, then the menu item on another record.
    await page.keyboard.press('Control+Alt+t');
    await until(() => foundCount(page), (n) => n === 5);
    await command(page, 'Records', 'Show All Records');
    await until(() => foundCount(page), (n) => n === 6);
    await command(page, 'Records', 'Omit Record');
    await until(() => foundCount(page), (n) => n === 5);

    await page.keyboard.press('Control+Alt+Shift+t');
    await answer(page, 'Omit Multiple', 'Omit', '1');
    await until(() => foundCount(page), (n) => n === 4);
    await command(page, 'Records', 'Show All Records');
    await command(page, 'Records', 'Omit Multiple…');
    await answer(page, 'Omit Multiple', 'Omit', '1');
    await until(() => foundCount(page), (n) => n === 5);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }

  // Close is exercised through both paths in separate sessions; the browser tab itself stays open.
  const byMenu = await open();
  await command(byMenu, 'File', 'Close');
  await byMenu.locator('select[name="db"]').waitFor();
  assert.deepEqual(byMenu.errors, []);
  await byMenu.context().close();
  const byShortcut = await open();
  await byShortcut.keyboard.press('Control+Alt+w');
  await byShortcut.locator('select[name="db"]').waitFor();
  assert.deepEqual(byShortcut.errors, []);
  await byShortcut.context().close();
});
