import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { host, launch, until, window, type Hosted } from './harness.ts';
let hosted: Hosted;
let browser: Browser;
const formula = '"SYNTHETIC_ADMIN_FORMULA"';
before(async () => {
  hosted = await host({ stores: ['Synthetic'] });
  const store = hosted.store('Synthetic');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value' }] }, { op: 'createScript', name: 'Main', text: 'Exit Script' }]);
  store.create('Items', { Value: 'Sample' });
  store.setPassword('Admin', 'synthetic-password', '[Full Access]');
  store.setPassword('Other', 'synthetic-password', '[Full Access]');
  store.savePrivilegeSet({ name: 'Readers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly', extendedPrivileges: ['fmwebdirect'] });
  store.setPassword('Reader', 'synthetic-password', 'Readers');
  browser = await launch();
});
after(async () => { await browser?.close(); await hosted?.close(); });
async function login(page: Page, account: string) {
  await page.evaluate(async (account) => {
    const { Api } = await import('/app/src/' + 'api.ts');
    const api = await Api.login('Synthetic', account, 'synthetic-password');
    sessionStorage.setItem('tabularius.session', JSON.stringify({ db: api.db, token: api.token }));
    sessionStorage.setItem('tabularius.layout.Synthetic', 'Items');
  }, account);
}
async function open() {
  const page = await window(browser);
  page.setDefaultTimeout(10_000);
  await page.route('**/synthetic.html', (r) => r.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
  await page.goto(hosted.url + '/synthetic.html');
  return page;
}

test('AR-web-admin-console-06 account and shared editors', { timeout: 30_000 }, async () => {
  const page = await open();
  try {
    await login(page, 'Admin');
    await page.goto(hosted.url + '/app/dataviewer.html');
    await page.getByLabel('Expression', { exact: true }).fill(formula);
    await page.getByRole('button', { name: 'Add to Watch', exact: true }).click();
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    await page.goto(hosted.url + '/app/debugger.html');
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    await page.getByLabel('Formula to watch').fill('1 + 2');
    await page.getByRole('button', { name: 'Watch', exact: true }).click();
    await page.getByRole('cell', { name: '1 + 2', exact: true }).waitFor();
    await login(page, 'Other');
    await page.goto(hosted.url + '/app/dataviewer.html');
    await page.getByLabel('Expression', { exact: true }).waitFor();
    assert.ok(!(await page.locator('#app').textContent())?.includes(formula));
    assert.ok(!(await page.locator('#app').textContent())?.includes('1 + 2'));
    await login(page, 'Admin');
    await page.goto(hosted.url + '/app/dataviewer.html');
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    await page.getByRole('cell', { name: '1 + 2', exact: true }).waitFor();
    await page.route('**/tabularius/debug/**', (r) => r.fulfill({ status: 403, json: { error: { code: 9, message: 'Access denied' } } }));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.ok(!(await page.locator('#app').textContent())?.includes(formula));
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(formula.slice(1, -1)));
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

for (const tool of ['dataviewer', 'debugger']) {
  test(`AR-web-admin-console-06 ${tool} initial denial`, { timeout: 20_000 }, async () => {
    const page = await open();
    try {
      await login(page, 'Reader');
      await page.evaluate((formula) => {
        localStorage.setItem('tabularius.dataviewer.watch.account.' + JSON.stringify(['Synthetic', 'Reader']), JSON.stringify([formula]));
      }, formula);
      await page.goto(hosted.url + `/app/${tool}.html`);
      await until(() => page.locator('#app').textContent(), (s) => !!s?.includes('full access'), 10_000);
      assert.ok(!(await page.locator('#app').textContent())?.includes(formula));
      assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(formula.slice(1, -1)));
    } finally { await page.close(); }
  });
}

test('AR-web-admin-console-06 pending evaluation and account change', { timeout: 20_000 }, async () => {
  const page = await open();
  let release: (() => void) | undefined;
  try {
    await login(page, 'Admin');
    await page.goto(hosted.url + '/app/dataviewer.html');
    await page.getByLabel('Expression', { exact: true }).fill(formula);
    await page.getByRole('button', { name: 'Add to Watch', exact: true }).click();
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { started = resolve; });
    await page.route('**/tabularius/debug/**/evaluate', async (route) => {
      await new Promise<void>((resolve) => { release = resolve; started(); });
      await route.fulfill({ json: { results: [{ value: 'SYNTHETIC_LATE_RESULT' }] } });
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await pending;
    await login(page, 'Other');
    await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').waitFor();
    release!();
    await page.waitForTimeout(150);
    const text = await page.locator('#app').textContent();
    assert.ok(!text?.includes(formula));
    assert.ok(!text?.includes('SYNTHETIC_LATE_RESULT'));
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(formula.slice(1, -1)));
    assert.deepEqual(page.errors, []);
  } finally { release?.(); await page.close(); }
});

test('AR-web-admin-console-06 debugger revocation', { timeout: 20_000 }, async () => {
  const page = await open();
  try {
    await login(page, 'Admin');
    await page.goto(hosted.url + '/app/debugger.html');
    await page.getByLabel('Formula to watch').fill(formula);
    await page.getByRole('button', { name: 'Watch', exact: true }).click();
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    await page.route('**/tabularius/debug/**', (r) => r.fulfill({ status: 403, json: { error: { code: 9, message: 'Access denied' } } }));
    await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').waitFor();
    assert.ok(!(await page.locator('#app').textContent())?.includes(formula));
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(formula.slice(1, -1)));
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('AR-web-admin-console-06 logout', { timeout: 20_000 }, async () => {
  const page = await open();
  try {
    await login(page, 'Admin');
    await page.goto(hosted.url + '/app/dataviewer.html');
    await page.getByLabel('Expression', { exact: true }).fill(formula);
    await page.getByRole('button', { name: 'Add to Watch', exact: true }).click();
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    await page.goto(hosted.url + '/app/');
    await page.locator('select.layout-menu').waitFor();
    await page.getByRole('button', { name: /^Log out$/i }).click();
    await page.locator('select[name="db"]').waitFor();
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(formula.slice(1, -1)));
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
