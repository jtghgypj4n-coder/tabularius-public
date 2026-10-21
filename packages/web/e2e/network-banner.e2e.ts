// The web client says scripts can't reach the network while a file's Script network switch is off (a new file has it
// off), above everything but the skip link, and stops saying so when an administrator turns it on, on a small database
// built here with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'], scriptNetworkOff: true });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] }] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('the banner shows while Script network is off, can be dismissed, and is absent once it is on', { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.getByRole('button', { name: 'View as Form' }).click();
  const banner = page.locator('.network-banner');
  await banner.waitFor();
  assert.match(await banner.innerText(), /can't reach the network/);
  assert.equal(await page.evaluate(() => document.querySelector('.shell')?.firstElementChild?.className), 'skip', 'the skip link stays first');
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  assert.equal(await banner.count(), 0);
  assert.deepEqual(page.errors, []);

  hosted.store('Shop').setScriptNetwork(true, { account: 'test' });
  const again = await window(await browser.newContext());
  await signIn(again, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await again.getByRole('button', { name: 'View as Form' }).click();
  await again.locator('.menubar').waitFor();
  assert.equal(await again.locator('.network-banner').count(), 0);
});
