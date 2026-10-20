// Signing in and out of the web client, in a real browser, on a small database
// built here with no .fmp12: a wrong password and then the lockout after too
// many, an account that must change its password first, an account turned off
// (before signing in, and while its window is open), and Log out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { LOCKOUT } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name field.
const NAME = 5;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page & { errors: string[] }> {
  return window(await browser.newContext());
}

/** Fills in the sign-in screen and presses Open, without waiting for the file to open. */
async function tryToSignIn(page: Page, account: string, password: string): Promise<void> {
  if (!(await page.locator('select[name="db"]').isVisible())) await page.goto(hosted.url + '/app/');
  await page.locator('select[name="db"]').selectOption('Shop');
  await page.locator('input[name="account"]').fill(account);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
}

const said = (page: Page) => page.locator('.login-error').textContent().then((t) => t ?? '');
const opened = (page: Page) => page.locator('.fm-part').first().isVisible();

test('a wrong password is refused and says so; after too many, even the right one waits out the lockout', { skip }, async () => {
  const store = hosted.store('Shop');
  store.setPassword('Bea', 'bea-secret-1', '[Full Access]');
  const page = await open();
  try {
    await tryToSignIn(page, 'Bea', 'not-it');
    await until(() => said(page), (t) => /account name or password is wrong/.test(t));
    assert.equal(await opened(page), false);
    // The ones left before the lockout; the last of them locks this browser's place out.
    for (let i = 1; i < LOCKOUT.attempts; i++) {
      await page.locator('.login-error').evaluate((e) => (e.textContent = ''));
      await tryToSignIn(page, 'Bea', 'still-not-it');
      await until(() => said(page), (t) => t !== '');
    }
    await until(() => said(page), (t) => /Too many tries; wait until/.test(t));
    await page.locator('.login-error').evaluate((e) => (e.textContent = ''));
    await tryToSignIn(page, 'Bea', 'bea-secret-1');
    await until(() => said(page), (t) => /Too many tries/.test(t));
    assert.equal(await opened(page), false);
    // Once it's lifted, the right password opens the file.
    store.unlock('Bea');
    await tryToSignIn(page, 'Bea', 'bea-secret-1');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
    assert.deepEqual(page.errors, []);
  } finally {
    store.unlock('Bea');
    await page.context().close();
  }
});

test('an account that must change its password sets a new one before the file opens, and the old one stops working', { skip }, async () => {
  const store = hosted.store('Shop');
  store.setPassword('Cal', 'cal-temp-1', '[Full Access]', { mustChange: true });
  const page = await open();
  try {
    await tryToSignIn(page, 'Cal', 'cal-temp-1');
    await page.getByRole('heading', { name: 'New password' }).waitFor();
    assert.equal(await opened(page), false);
    // The two have to match.
    await page.locator('input[name="new"]').fill('cal-new-pass-1');
    await page.locator('input[name="confirm"]').fill('cal-new-pass-2');
    await page.getByRole('button', { name: 'Change password' }).click();
    await until(() => said(page), (t) => /do not match/.test(t));
    await page.locator('input[name="confirm"]').fill('cal-new-pass-1');
    await page.getByRole('button', { name: 'Change password' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
    assert.equal(store.accounts().find((a) => a.name === 'Cal')?.mustChange, undefined);

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.locator('select[name="db"]').waitFor();
    await tryToSignIn(page, 'Cal', 'cal-temp-1');
    await until(() => said(page), (t) => /account name or password is wrong/.test(t));
    await signIn(page, hosted.url, 'Shop', 'Cal', 'cal-new-pass-1');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
    assert.deepEqual(page.errors, []);
  } finally {
    store.unlock('Cal');
    await page.context().close();
  }
});

test('Log out goes back to the sign-in screen, and reloading the page doesn\'t sign back in', { skip }, async () => {
  const page = await open();
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.locator('select[name="db"]').waitFor();
    // The account is remembered for next time; the password isn't.
    assert.equal(await page.locator('input[name="account"]').inputValue(), 'Ann');
    assert.equal(await page.locator('input[name="password"]').inputValue(), '');
    await page.reload();
    await page.locator('select[name="db"]').waitFor();
    assert.equal(await opened(page), false);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('an account turned off can\'t sign in, and a window it has open goes back to the sign-in screen', { skip }, async () => {
  const store = hosted.store('Shop');
  store.setPassword('Dot', 'dot-secret-1', '[Full Access]');
  const page = await open();
  try {
    await signIn(page, hosted.url, 'Shop', 'Dot', 'dot-secret-1');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
    store.setAccountActive('Dot', false);
    // Nothing need be clicked: the window learns its session ended, as soon as there is a change it would have been
    // told about (and else within the stream's heartbeat), and isn't told about the change.
    store.create('Customers', { Id: 2, Name: 'Eve' });
    await page.locator('select[name="db"]').waitFor();
    await until(() => said(page), (t) => /session ended/.test(t));
    await tryToSignIn(page, 'Dot', 'dot-secret-1');
    await until(() => said(page), (t) => /account name or password is wrong/.test(t));
    assert.equal(await opened(page), false);
    assert.deepEqual(page.errors, []);
  } finally {
    store.setAccountActive('Dot', true);
    store.unlock('Dot');
    await page.context().close();
  }
});
