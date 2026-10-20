// Tools > Record Script in the web client, in a real browser, on a small
// database built here with no .fmp12: a field typed in while recording, then
// Stop shows what was done as a script; its text is edited, a Dry run on a
// copy says what it would change and leaves the file alone, Save adds it, and
// the saved script runs from the Scripts menu.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name and City fields.
const NAME = 5;
const CITY = 7;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'London' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const city = () => String(hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData.City);
const stepsOf = (name: string) => hosted.store('Shop').schema.scripts.find((s) => s.name === name)?.steps.map((s) => s.line ?? s.name) ?? [];

async function tools(page: Page, item: string | RegExp): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('a script recorded in the browser is shown, edited, dry run on a copy, saved, and run from the Scripts menu', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');

    await tools(page, /^Record Script/);
    const stop = page.getByRole('button', { name: /^Stop recording/ });
    await stop.waitFor();
    await field(page, CITY).fill('Berlin');
    await field(page, CITY).press('Tab');
    await until(async () => city(), (v) => v === 'Berlin');
    await stop.click();

    // What was done, as a script. Its text is changed to move the city to Oslo instead.
    const dialog = page.getByRole('dialog', { name: 'Recorded script' });
    const text = dialog.getByLabel('Script steps');
    await until(() => text.inputValue(), (v) => v.includes('Set Field [ Customers::City ; "Berlin" ]'));
    assert.match(await text.inputValue(), /Commit Records\/Requests \[ With dialog: Off \]/);
    await text.fill((await text.inputValue()).replace('"Berlin"', '"Oslo"'));

    // A dry run runs on a copy: it says what it would change, and the file keeps Berlin.
    await dialog.getByRole('button', { name: 'Dry run' }).click();
    await until(() => dialog.locator('.g-status').textContent(), (t) => /It would change 1 record/.test(t ?? ''));
    await dialog.locator('.macro-changes').getByText('Oslo').waitFor();
    assert.equal(city(), 'Berlin');

    await dialog.getByLabel('Script name').fill('Move to Oslo');
    await dialog.getByRole('button', { name: 'Save script' }).click();
    await dialog.waitFor({ state: 'detached' });
    await until(async () => stepsOf('Move to Oslo').length, (n) => n >= 2);
    assert.ok(stepsOf('Move to Oslo').some((s) => s.includes('"Oslo"')));

    // Run from the Scripts menu.
    await page.locator('.menubar').getByRole('button', { name: 'Scripts', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to Oslo', exact: true }).click();
    await until(() => field(page, CITY).inputValue(), (v) => v === 'Oslo');
    await until(async () => city(), (v) => v === 'Oslo');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('Stop with nothing done says so, and Discard asks before the recording is lost', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');

    await tools(page, /^Record Script/);
    await page.getByRole('button', { name: /^Stop recording/ }).click();
    await page.locator('.toast', { hasText: 'Nothing was recorded.' }).waitFor();

    await tools(page, /^Record Script/);
    await field(page, NAME).fill('Ada Lovelace');
    await field(page, NAME).press('Tab');
    await until(async () => String(hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData.Name), (v) => v === 'Ada Lovelace');
    await page.getByRole('button', { name: /^Stop recording/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Recorded script' });
    await dialog.waitFor();
    const messages: string[] = [];
    page.once('dialog', (d) => { messages.push(d.message()); void d.dismiss(); });
    await dialog.getByRole('button', { name: 'Discard' }).click();
    assert.match(messages[0], /Discard the recorded steps/);
    assert.ok(await dialog.isVisible());
    page.once('dialog', (d) => void d.accept());
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.ok(hosted.store('Shop').schema.scripts.every((x) => x.name !== 'Recorded' && !x.name.startsWith('Recorded ')), 'the discarded recording was not saved');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
