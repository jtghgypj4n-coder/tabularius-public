// One toast for every page: two showing at once stack instead of overlapping, errors are alerts, and a toast stays
// while the pointer or keyboard focus is on it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

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

async function open(): Promise<Page> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  return page;
}

/** Calls the page's own toast module, the one the web client and the design pages share. */
const say = (page: Page, message: string, kind: 'error' | 'info') =>
  page.evaluate(async ([m, k]) => {
    const { toast } = await import(/* the page's own module */ '/app/src/' + 'toast.ts');
    toast(m, k as 'error' | 'info');
  }, [message, kind]);

test('two toasts at once stack: neither covers the other', { skip }, async () => {
  const page = await open();
  await say(page, 'First message', 'info');
  await say(page, 'Second message, a little longer than the first', 'error');
  const boxes = await page.locator('.toast').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })));
  assert.equal(boxes.length, 2);
  const [a, b] = boxes;
  assert.ok(a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5, `toasts overlap: ${JSON.stringify(boxes)}`);
  await page.close();
});

test('an error toast is an alert and an info toast is not; both sit in the one status region', { skip }, async () => {
  const page = await open();
  await say(page, 'Something failed', 'error');
  await say(page, 'FYI', 'info');
  assert.equal(await page.locator('.toasts[role=status] > .toast-error[role=alert]').count(), 1);
  assert.equal(await page.locator('.toasts > .toast-info').count(), 1);
  assert.equal(await page.locator('.toast-info[role=alert]').count(), 0);
  assert.equal(await page.locator('.toasts').count(), 1);
  await page.close();
});

test('an old-client address error links to the cached-version troubleshooting entry', { skip }, async () => {
  const page = await open();
  await say(page, 'The server has nothing at that address. If Tabularius was just updated, reload the page.', 'error');
  await page.getByRole('button', { name: 'Updated client help' }).click();
  await page.waitForURL('**/docs/troubleshooting-web-client#the-client-looks-like-an-old-version-after-an-update');
  await page.getByRole('heading', { name: 'The client looks like an old version after an update' }).waitFor();
  await page.close();
});

test('a toast stays while the pointer is over it, and goes after it leaves', { skip }, async () => {
  const page = await open();
  await page.clock.install();
  await say(page, 'Stay a while', 'info');
  await page.locator('.toast').hover();
  await page.clock.fastForward(20000);
  assert.equal(await page.locator('.toast').count(), 1, 'still there under the pointer');
  await page.mouse.move(0, 0);
  await page.clock.fastForward(4000);
  await until(() => page.locator('.toast').count(), (n) => n === 0);
  await page.close();
});

test('the design pages\' toast is the shared one: an error there is an alert in the stacking region', { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.goto(`${hosted.url}/app/design.html`);
  await page.evaluate(async () => {
    const { toast } = await import('/app/src/' + 'design/dom.ts');
    toast('Design says no', 'error');
    toast('And again', 'error');
  });
  assert.equal(await page.locator('.toasts[role=status] > .toast-error[role=alert]').count(), 2);
  await page.close();
});
