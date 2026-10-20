// A browser that refuses the page any storage (Safari's private windows in older versions, "block all cookies and site data",
// a managed browser): docs/troubleshooting.md says the web client still signs in and works, and only forgets things. Here every
// read and write of localStorage and sessionStorage throws, as it does there, and a person still gets in and sees a layout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Jo Smith' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('with localStorage and sessionStorage refusing every call, the web client still signs in and shows a layout', { skip }, async () => {
  const page = await window(await browser.newContext());
  await page.addInitScript(() => {
    const refuse = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    // Some browsers throw on reaching window.localStorage at all; others on each call. Both, here.
    for (const name of ['localStorage', 'sessionStorage'] as const) Object.defineProperty(window, name, { configurable: true, get: refuse });
  });
  try {
    await page.goto(hosted.url + '/app/');
    assert.equal(await page.evaluate(() => { try { void localStorage; void sessionStorage; return 'reachable'; } catch { return 'blocked'; } }), 'blocked', 'the browser really refuses');
    await page.locator('select[name="db"]').selectOption('Shop');
    await page.locator('input[name="account"]').fill('Ann');
    await page.locator('input[name="password"]').fill('ann-secret-1');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('select.layout-menu').waitFor({ state: 'attached' });
    await until(() => page.locator('.found').first().innerText(), (t) => /1/.test(t));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});
