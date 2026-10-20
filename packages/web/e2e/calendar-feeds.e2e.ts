// Calendar feeds and .ics import from the web client's File menu, in a real browser, on a small database built here
// with no .fmp12: an account with Full Access makes a feed (its address shown once), the link opens in a calendar app,
// the list never shows it again, and Revoke ends it. An account without Full Access is not offered the entry. An .ics
// file imports through File > Import Calendar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { axeViolations, host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Planner'] });
  const store = hosted.store('Planner');
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Title' }, { name: 'Day', type: 'date' }] }] as DesignOp[]);
  store.create('Events', { Title: 'Standup', Day: '2026-10-19' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmwebdirect', 'fmrest'] });
  store.setPassword('Sam', 'sam-secret-1', 'Staff');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(account: string, password: string): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Planner', account, password);
  await page.getByRole('button', { name: 'View as Form' }).click();
  return page;
}

async function menu(page: Page, ...path: string[]): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  for (const [i, name] of path.entries()) {
    if (i < path.length - 1) await page.getByRole('menuitem', { name }).first().hover();
    else await page.getByRole('menuitem', { name, exact: true }).click();
  }
}

test('Full Access makes a feed, sees its address once, opens the link, and revokes it', { skip }, async () => {
  const page = await open('Ann', 'ann-secret-1');
  try {
    await menu(page, 'Manage', 'Calendar Feeds…');
    const d = page.getByRole('dialog', { name: 'Calendar Feeds' });
    await d.getByText('No calendar feeds yet.').waitFor();
    await d.getByLabel('Starts at (required)').selectOption('Day');
    await d.getByLabel('Title', { exact: true }).selectOption('Title');
    await d.getByLabel('Name', { exact: true }).fill('Team calendar');
    await d.getByRole('button', { name: 'Make link' }).click();
    const address = d.getByLabel('Calendar feed address');
    await address.waitFor();
    const url = await address.inputValue();
    assert.match(url, /\/tabularius\/calendar\/v1\/databases\/Planner\/layouts\/Events\/calendar\.ics\?start=Day&title=Title&token=ohbt_/);
    // The link opens with no sign-in, as a calendar app opens it.
    const opened = await fetch(url);
    assert.equal(opened.status, 200);
    assert.match(await opened.text(), /SUMMARY:Standup/);
    // The list has the feed; closing and reopening shows no address.
    await d.getByRole('row', { name: /Team calendar/ }).waitFor();
    assert.deepEqual(await axeViolations(page, 'dialog.calendar-dialog'), []);
    await d.getByRole('button', { name: 'Done' }).click();
    await menu(page, 'Manage', 'Calendar Feeds…');
    const again = page.getByRole('dialog', { name: 'Calendar Feeds' });
    await again.getByRole('row', { name: /Team calendar/ }).waitFor();
    assert.equal(await again.getByLabel('Calendar feed address').count(), 0, 'the address is not shown again');
    assert.ok(!(await again.textContent())!.includes('ohbt_'));
    // Revoke ends the link.
    page.once('dialog', (c) => void c.accept());
    await again.getByRole('button', { name: /^Revoke Team calendar/ }).click();
    await again.getByText('No calendar feeds yet.').waitFor();
    assert.equal((await fetch(url)).status, 401);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('an account without Full Access is not offered Calendar Feeds', { skip }, async () => {
  const page = await open('Sam', 'sam-secret-1');
  try {
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
    await page.getByRole('menuitem', { name: /^Layouts/ }).first().waitFor();
    assert.equal(await page.getByRole('menuitem', { name: /Calendar Feeds/ }).count(), 0);
  } finally {
    await page.context().close();
  }
});

test('File > Import Calendar reads an .ics file into the layout', { skip }, async () => {
  const page = await open('Sam', 'sam-secret-1');
  try {
    await menu(page, 'Import Calendar (.ics)…');
    const d = page.getByRole('dialog', { name: 'Import Calendar' });
    await d.getByLabel('Starts at (required)').selectOption('Day');
    await d.getByLabel('Title', { exact: true }).selectOption('Title');
    // No file yet: it says so and imports nothing.
    await d.getByRole('button', { name: 'Import' }).click();
    await d.getByText('Choose an .ics file.').waitFor();
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VEVENT\r\nUID:x@test\r\nDTSTART;VALUE=DATE:20261105\r\nSUMMARY:From the file\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    await d.getByLabel('File').setInputFiles({ name: 'plan.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
    await d.getByRole('button', { name: 'Import' }).click();
    await d.getByText('Imported 1 event.').waitFor();
    const rows = hosted.store('Planner').query("SELECT Title FROM Events WHERE Title = 'From the file'");
    assert.equal(rows.length, 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
