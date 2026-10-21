// Regression cases for the second admin-console review: pending credentials,
// create-only security forms, retained privilege drafts and deletion confirms.
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
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Owner' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Owner: 'Ann', Name: 'Ada' });
  store.create('Customers', { Id: 2, Owner: 'Bea', Name: 'Grace' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.setPassword('Reader', 'reader-secret-1', '[Full Access]');
  store.savePrivilegeSet({ name: 'Limited', records: { view: false, edit: false, create: false, delete: false }, tables: { Customers: { view: true, edit: false, create: false, delete: false } }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function security(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  page.setDefaultTimeout(15_000);
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.goto(hosted.url + '/app/security.html');
  await page.getByRole('tab', { name: 'Accounts' }).waitFor();
  return page;
}

const account = (name: string) => hosted.store('Shop').accounts().find((a) => a.name.toLowerCase() === name.toLowerCase());

test('AR-web-admin-console-01 password reset serializes rapid clicks and clears only after success; AR-web-admin-console-03 creation rejects existing identities', { skip }, async () => {
  const page = await security();
  try {
    await page.locator('.d-side li button').filter({ hasText: 'Reader' }).click();
    await page.getByLabel('New password', { exact: true }).fill('reader-secret-2');
    let requests = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/tabularius/security/v1/databases/Shop', async (route) => {
      if (route.request().method() === 'POST') { requests++; await held; }
      await route.continue();
    });
    const reset = page.getByRole('button', { name: 'Set password' });
    await reset.click();
    await until(async () => requests, (n) => n === 1);
    await reset.click({ force: true });
    assert.equal(requests, 1);
    assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), 'reader-secret-2');
    release();
    await until(async () => hosted.store('Shop').verify('Reader', 'reader-secret-2', ''), Boolean);

    await page.getByLabel('Account name', { exact: true }).fill('rEaDeR');
    await page.getByLabel('Password', { exact: true }).first().fill('replacement-password');
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.getByText(/already exists/i).first().waitFor();
    assert.equal(hosted.store('Shop').verify('Reader', 'reader-secret-2', ''), true);

    await page.getByRole('tab', { name: 'Privilege sets' }).click();
    await page.getByLabel('New set name', { exact: true }).fill('lImItEd');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByText(/already exists/i).last().waitFor();
    assert.equal(hosted.store('Shop').privilegeSets().find((p) => p.name === 'Limited')?.tables?.Customers?.view, true);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('AR-web-admin-console-02 using a previewed view rule updates the control and saved privilege draft', { skip }, async () => {
  const page = await security();
  try {
    await page.getByRole('tab', { name: 'Privilege sets' }).click();
    await page.locator('.d-side li button').filter({ hasText: 'Limited' }).click();
    const table = page.locator('details.sec-tbl', { hasText: 'Customers' });
    await table.locator(':scope > summary').click();
    await table.getByLabel('Custom privileges for this table').check();
    await table.getByText('Describe & preview a view rule').click();
    await table.getByLabel('Customers view rule').fill('Owner = Get ( AccountName )');
    await table.getByRole('button', { name: 'Preview', exact: true }).click();
    await table.getByRole('button', { name: 'Use as the View rule' }).waitFor();
    await table.getByRole('button', { name: 'Use as the View rule' }).click();
    assert.equal(await table.getByLabel('View', { exact: true }).inputValue(), 'limited');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => hosted.store('Shop').privilegeSets().find((p) => p.name === 'Limited')?.tables?.Customers?.view, (v) => v === 'Owner = Get ( AccountName )');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('AR-web-admin-console-04 switching dashboards cannot retarget an active draft', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    const created = await page.evaluate(async () => {
      const session = JSON.parse(sessionStorage.getItem('tabularius.session')!);
      const base = `/tabularius/dashboards/v1/databases/${encodeURIComponent(session.db)}`;
      const make = async (name: string, titles: string[]) => {
        const response = await fetch(base, { method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name, widgets: titles.map((title) => ({ title, kind: 'number', layout: 'Customers' })) }) });
        return response.json();
      };
      return { a: await make('Dashboard A', ['A1', 'A2']), b: await make('Dashboard B', ['B1', 'B2']) };
    });
    const idA = created.a.dashboard.id as string;
    const idB = created.b.dashboard.id as string;
    await page.goto(`${hosted.url}/app/dashboard.html?id=${idA}`);
    await page.getByRole('heading', { name: 'Dashboard A' }).waitFor();
    let requestedB!: () => void;
    let releaseB!: () => void;
    const requestB = new Promise<void>((resolve) => { requestedB = resolve; });
    const gateB = new Promise<void>((resolve) => { releaseB = resolve; });
    await page.route(`**/tabularius/dashboards/v1/databases/Shop/${idB}`, async (route) => {
      if (route.request().method() === 'GET') { requestedB(); await gateB; }
      await route.continue();
    });
    const picker = page.getByLabel('Dashboard', { exact: true });
    await picker.selectOption(idB);
    await requestB;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    releaseB();
    await until(() => picker.inputValue(), (id) => id === idA);
    assert.equal(await picker.isDisabled(), true);
    await picker.evaluate((el: HTMLSelectElement, other) => { el.value = other; el.dispatchEvent(new Event('change', { bubbles: true })); }, idB);
    assert.equal(await picker.inputValue(), idA);
    await page.locator('.dash-cell').first().getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(() => page.locator('h1').innerText(), (title) => title === 'Dashboard A');
    const dashboards = await page.evaluate(async (ids) => {
      const session = JSON.parse(sessionStorage.getItem('tabularius.session')!);
      const base = `/tabularius/dashboards/v1/databases/${encodeURIComponent(session.db)}`;
      return Promise.all(ids.map(async (id) => fetch(`${base}/${id}`, { headers: { authorization: `Bearer ${session.token}` } }).then((r) => r.json())));
    }, [idA, idB]);
    assert.deepEqual(dashboards[0].dashboard.widgets.map((w: { title: string }) => w.title), ['A2']);
    assert.deepEqual(dashboards[1].dashboard.widgets.map((w: { title: string }) => w.title), ['B1', 'B2']);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('AR-web-admin-console-08 removing an enrolled second factor asks first and cancellation does not mutate it', { skip }, async () => {
  const store = hosted.store('Shop');
  const enrollment = store.enrollTotp('Reader');
  const { totpCode } = await import('../../store/src/index.ts');
  assert.equal(store.confirmTotp('Reader', totpCode(enrollment.secret)), true);
  const page = await security();
  try {
    await page.locator('.d-side li button').filter({ hasText: 'Reader' }).click();
    assert.match(await page.locator('.d-main').innerText(), /Two-factor[\s\S]*On[\s\S]*Turn off/);
    const turnOff = page.locator('.d-main button').filter({ hasText: 'Turn off' });
    page.once('dialog', (dialog) => void dialog.dismiss());
    await turnOff.click();
    assert.equal(store.hasTotp('Reader'), true);
    page.once('dialog', (dialog) => void dialog.accept());
    await turnOff.click();
    await until(async () => store.hasTotp('Reader'), (v) => v === false);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('AR-web-admin-console-05 overlapping token and recovery-code submissions mint one displayed credential set', { skip }, async () => {
  const page = await security();
  try {
    await page.getByRole('tab', { name: 'API tokens' }).click();
    let tokenRequests = 0;
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve; });
    await page.route('**/tabularius/security/v1/databases/Shop/tokens', async (route) => {
      tokenRequests++;
      await tokenGate;
      await route.continue();
    });
    await page.getByLabel('Label', { exact: true }).fill('one-time-test');
    const create = page.getByRole('button', { name: 'Create token' });
    await create.click();
    await until(async () => tokenRequests, (n) => n === 1);
    await create.click({ force: true });
    assert.equal(tokenRequests, 1);
    releaseToken();
    await page.locator('.sec-minted .sec-secret').waitFor();
    const minted = (await page.locator('.sec-minted .sec-secret').innerText()).trim();
    assert.match(minted, /^ohbt_[a-f0-9]+\./);
    assert.equal(hosted.store('Shop').apiTokens().filter((token) => token.label === 'one-time-test').length, 1);

    await page.getByRole('tab', { name: 'My sign-in' }).click();
    let codeRequests = 0;
    let releaseCodes!: () => void;
    const codeGate = new Promise<void>((resolve) => { releaseCodes = resolve; });
    await page.route('**/fmi/data/vLatest/databases/Shop/recovery-codes', async (route) => {
      codeRequests++;
      await codeGate;
      await route.continue();
    });
    const generate = page.getByRole('button', { name: 'Generate recovery codes' });
    page.once('dialog', (dialog) => void dialog.accept());
    await generate.click();
    await until(async () => codeRequests, (n) => n === 1);
    await generate.click({ force: true });
    assert.equal(codeRequests, 1);
    releaseCodes();
    await page.locator('.signin-code-list li').first().waitFor();
    assert.equal(hosted.store('Shop').recoveryCodesRemaining('Ann'), 10);
    await page.getByRole('tab', { name: 'API tokens' }).click();
    await page.getByRole('tab', { name: 'My sign-in' }).click();
    assert.equal(await page.locator('.signin-code-list').count(), 0);
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});
