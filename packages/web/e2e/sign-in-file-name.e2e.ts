// A server started without --list-files-publicly (the default) lists no file, so the sign-in page asks for the file's
// name in a text box. It used to read that answer as "server unreachable" and showed no way to sign in at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { host, launch, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'], listFilesOff: true });
  const store = hosted.store('Shop');
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function fresh(): Promise<Page & { errors: string[] }> {
  return window(await browser.newContext());
}

test('with the file list off, the sign-in page has a labelled file name box and signs in with the typed name', { skip }, async () => {
  const page = await fresh();
  try {
    await page.goto(hosted.url + '/app/');
    const box = page.getByLabel('File name');
    await box.waitFor();
    assert.equal(await page.locator('select[name="db"]').count(), 0);
    assert.doesNotMatch((await page.locator('form.login').textContent()) ?? '', /can't be reached|offline cop/);
    // Keyboard only: the box takes focus by tab order and the form submits with Enter.
    await box.focus();
    await page.keyboard.type('Shop');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Ann');
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await page.locator('select.layout-menu').waitFor({ state: 'attached' });
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a link with ?db= fills the box, and a wrong name gets the sign-in error, not an offline screen', { skip }, async () => {
  const page = await fresh();
  try {
    await page.goto(hosted.url + '/app/?db=Nowhere');
    assert.equal(await page.getByLabel('File name').inputValue(), 'Nowhere');
    await page.locator('input[name="account"]').fill('Ann');
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('.login-error').filter({ hasText: /\S/ }).waitFor();
    assert.doesNotMatch((await page.locator('form.login').textContent()) ?? '', /can't be reached/);
  } finally {
    await page.context().close();
  }
});

test('an unreachable server still gets the offline screen, with no file name box', { skip }, async () => {
  const page = await fresh();
  try {
    await page.route('**/fmi/data/vLatest/databases', (route) => route.abort('connectionrefused'));
    await page.goto(hosted.url + '/app/');
    await page.locator('form.login').waitFor();
    assert.match((await page.locator('form.login').textContent()) ?? '', /server can't be reached/);
    assert.equal(await page.getByLabel('File name').count(), 0);
  } finally {
    await page.context().close();
  }
});
