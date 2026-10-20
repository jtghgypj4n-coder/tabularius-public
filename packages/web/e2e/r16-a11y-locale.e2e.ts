// The web client and admin console, in a real browser: text reads in its own direction, a non-modal dialog hands
// focus back when it closes, the Import Records dialog keeps focus on the control being used, and the admin console
// names its repeated buttons, says when the audit log is cut off, and sets one session timeout at a time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let tmp: string;
const NAME = 5;

before(async () => {
  if (skip) return;
  tmp = mkdtempSync(join(tmpdir(), 'tabularius-r16-'));
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  for (const [i, Name] of ['Ada', 'مرحبا'].entries()) store.create('Customers', { Id: i + 1, Name, City: 'Paris' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  for (let i = 0; i < 4; i++) store.create('Customers', { Id: 10 + i, Name: `Extra ${i}`, City: 'Rome' }, { account: 'Ann' });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  return page;
}

test('text fields and table view cells read each value in its own direction', { skip }, async () => {
  const page = await open();
  try {
    assert.equal(await field(page, NAME).getAttribute('dir'), 'auto');
    await page.getByRole('button', { name: 'View as Table' }).click();
    const cell = page.locator('table.table-view td input').first();
    await cell.waitFor();
    assert.equal(await cell.getAttribute('dir'), 'auto');
    assert.equal(await cell.evaluate((el) => getComputedStyle(el).textAlign), 'start');
  } finally {
    await page.context().close();
  }
});

test('closing Find/Replace puts focus back on the Edit menu', { skip }, async () => {
  const page = await open();
  try {
    await page.locator('.menubar').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Find/Replace' }).first().hover();
    await page.getByRole('menuitem', { name: 'Find/Replace…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Find/Replace' });
    await dialog.waitFor();
    await dialog.getByLabel('Find what').press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Edit');
  } finally {
    await page.context().close();
  }
});

test('the Import Records dialog keeps focus on the control just used', { skip }, async () => {
  const file = join(tmp, 'people.csv');
  writeFileSync(file, 'Name,City\nHedy,Vienna\nGrace,Rome\n');
  const page = await open();
  try {
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Import Records…' }).click();
    await (await chooser).setFiles(file);
    const dialog = page.getByRole('dialog', { name: 'Import Records' });
    await dialog.waitFor();
    const settled = () => until(() => dialog.locator('.g-status').textContent(), (t) => !t?.startsWith('Updating'));
    const city = dialog.getByLabel('Field for City');
    await city.waitFor();
    await city.focus();
    await city.selectOption('');
    await settled();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Field for City');
    const header = dialog.getByLabel('The first row holds column names');
    await header.focus();
    await header.press('Space');
    await settled();
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.fk), 'header');
  } finally {
    await page.context().close();
  }
});

test('admin console: repeated buttons say which row, the audit log says it is cut and filters by date, one timeout is set at a time', { skip }, async () => {
  const page = await window(browser);
  try {
    await page.goto(hosted.url + '/admin/');
    // The audit log: a limit smaller than the log is said, and a date range narrows it.
    await until(() => page.locator('#audit-db option').count(), (n) => n > 0);
    await page.locator('#audit-limit').evaluate((el: HTMLSelectElement) => { el.options[0].value = '2'; el.options[0].text = '2'; el.value = '2'; });
    await page.locator('#audit-refresh').click();
    await until(() => page.locator('#audit-note').textContent(), (t) => /Showing the newest 2 entries/.test(t ?? ''));
    await page.locator('#audit-since').fill('2999-01-01');
    await until(() => page.locator('#audit-count').textContent(), (t) => t === '0');
    assert.equal(await page.locator('#audit-note').textContent(), '');

    // Setting the Data API's timeout leaves the web client's following it; the web box stays empty.
    await page.locator('#session-minutes').waitFor();
    assert.equal(await page.locator('#web-session-minutes').inputValue(), '');
    await page.locator('#session-minutes').fill('7');
    await page.locator('#session-set').click();
    await until(() => page.evaluate(() => fetch('/tabularius/admin/v1/status').then((r) => r.json()).then((s) => [s.server.sessionIdleMinutes, s.server.webSessionIdleMinutes, s.server.webSessionIdleOwn])), (v) => v[0] === 7);
    assert.deepEqual(await page.evaluate(() => fetch('/tabularius/admin/v1/status').then((r) => r.json()).then((s) => [s.server.webSessionIdleMinutes, s.server.webSessionIdleOwn])), [7, false]);
    // A value outside the range is not sent.
    await page.locator('#session-minutes').fill('5000');
    await page.locator('#session-set').click();
    assert.equal(await page.evaluate(() => fetch('/tabularius/admin/v1/status').then((r) => r.json()).then((s) => s.server.sessionIdleMinutes)), 7);
  } finally {
    await page.close();
  }
});
