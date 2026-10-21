import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { host, launch, until, window, type Hosted } from './harness.ts';

export let hosted: Hosted;
let browser: Browser;
export const formula = '"SYNTHETIC_SAVED_WATCH"';
export const key = 'tabularius.dataviewer.watch.account.' + JSON.stringify(['Synthetic', 'Admin']);
export const debugRoute = '**/tabularius/debug/**';

before(async () => {
  hosted = await host({ stores: ['Synthetic'] });
  const store = hosted.store('Synthetic');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Value' }] },
    { op: 'createScript', name: 'Main', text: 'Exit Script' },
  ]);
  store.create('Items', { Value: 'Sample' });
  store.setPassword('Admin', 'synthetic-password', '[Full Access]');
  browser = await launch();
});
after(async () => { await browser?.close(); await hosted?.close(); });

export async function open() {
  const page = await window(browser);
  page.setDefaultTimeout(10_000);
  await page.route('**/synthetic.html', (r) => r.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
  await page.goto(hosted.url + '/synthetic.html');
  await page.evaluate(async () => {
    const { Api } = await import('/app/src/' + 'api.ts');
    const api = await Api.login('Synthetic', 'Admin', 'synthetic-password');
    sessionStorage.setItem('tabularius.session', JSON.stringify({ db: api.db, token: api.token }));
    sessionStorage.setItem('tabularius.layout.Synthetic', 'Items');
  });
  return page;
}

export async function addWatch(page: Page) {
  await page.goto(hosted.url + '/app/dataviewer.html');
  await page.getByLabel('Expression', { exact: true }).fill(formula);
  await page.getByRole('button', { name: 'Add to Watch', exact: true }).click();
  await page.getByRole('cell', { name: formula, exact: true }).waitFor();
}

export async function saved(page: Page) {
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), JSON.stringify([formula]));
}

