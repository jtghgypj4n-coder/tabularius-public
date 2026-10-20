// Two browser windows of one session (Window > New Window share it): an edit in one shows in the other without a
// reload. The server calls both "self" for the session, so the windows tell each other over a BroadcastChannel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
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
  store.create('Customers', { Id: 2, Name: 'Grace' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('an edit in a second window of the same session shows in the first, and the other way', { skip }, async () => {
  const context = await browser.newContext();
  const a = await window(context);
  try {
    await signIn(a, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await a.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(a, NAME).inputValue(), (v) => v === 'Ada');
    // Window > New Window: the same session in another browser window.
    await a.locator('.menubar').getByRole('button', { name: 'Window', exact: true }).click();
    const [b] = await Promise.all([context.waitForEvent('page'), a.getByRole('menuitem', { name: 'New Window' }).click()]);
    const errors: string[] = [];
    b.on('pageerror', (e) => errors.push(e.message));
    await b.locator('.fm-part').first().waitFor();
    await until(() => field(b, NAME).inputValue(), (v) => v === 'Ada');

    await field(b, NAME).fill('Ada Lovelace');
    await field(b, NAME).press('Tab');
    await until(() => field(a, NAME).inputValue(), (v) => v === 'Ada Lovelace');

    // And the other way.
    await field(a, NAME).fill('Ada King');
    await field(a, NAME).press('Tab');
    await until(() => field(b, NAME).inputValue(), (v) => v === 'Ada King');
    assert.deepEqual(a.errors, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a window whose live stream drops says it is reconnecting, then shows what changed meanwhile', { skip }, async () => {
  const ann = await window(await browser.newContext());
  const bob = await window(await browser.newContext());
  try {
    hosted.store('Shop').setPassword('Bob', 'bob-secret-1', '[Full Access]');
    // Ann's live stream can't connect.
    let blocked = true;
    await ann.route('**/tabularius/live/**/events', (route) => (blocked ? route.abort() : route.continue()));
    await signIn(ann, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await ann.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(ann, NAME).inputValue(), (v) => v === 'Ada King' || v === 'Ada');
    const was = await field(ann, NAME).inputValue();
    await signIn(bob, hosted.url, 'Shop', 'Bob', 'bob-secret-1');
    await bob.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(bob, NAME).inputValue(), (v) => v === was);
    await field(bob, NAME).fill('Ada Byron');
    await field(bob, NAME).press('Tab');
    await ann.getByText('Reconnecting to the server').waitFor();
    assert.equal(await field(ann, NAME).inputValue(), was, 'nothing arrived while the stream was down');
    blocked = false;
    await until(() => field(ann, NAME).inputValue(), (v) => v === 'Ada Byron');
    await until(() => ann.getByText('Reconnecting to the server').count(), (n) => n === 0);
    assert.deepEqual(ann.errors, []);
  } finally {
    await ann.context().close();
    await bob.context().close();
  }
});

test('a field save that cannot reach the server is tried again, then the field goes back to what is stored and says so', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v !== '');
    const stored = await field(page, NAME).inputValue();
    let attempts = 0;
    await page.route('**/fmi/data/**/records/*', (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      attempts++;
      return route.abort();
    });
    await field(page, NAME).fill('Never saved');
    await field(page, NAME).press('Tab');
    await page.getByText("Can't reach the server, so Name wasn't saved.").waitFor();
    assert.equal(attempts, 3, 'tried again twice');
    await until(() => field(page, NAME).inputValue(), (v) => v === stored);
    assert.equal(hosted.store('Shop').find('Customers', { query: [{ Name: 'Never saved' }] }).records.length, 0);
    await page.unroute('**/fmi/data/**/records/*');
    // The connection is back: the same edit saves.
    await field(page, NAME).fill('Saved now');
    await field(page, NAME).press('Tab');
    await until(async () => hosted.store('Shop').find('Customers', { query: [{ Name: 'Saved now' }] }).records.length, (n) => n === 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
