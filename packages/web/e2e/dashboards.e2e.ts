// The Dashboards page, in a real browser, on a small database built here with
// no .fmp12: a saved dashboard drawn from the records, then Edit (rename it, a
// widget's title changed, one duplicated and one removed) saved, Cancel putting
// everything back, and Delete asking first and landing on the other dashboard.
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
  store.applyDesign([{ op: 'createTable', name: 'Invoices', fields: [{ name: 'Customer' }, { name: 'Amount', type: 'number' }] }] as DesignOp[]);
  for (const [c, a] of [['Ada', 100], ['Grace', 250], ['Ada', 50]] as const) store.create('Invoices', { Customer: c, Amount: a });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const TOTAL = { title: 'Total billed', kind: 'number', layout: 'Invoices', measure: { field: 'Amount', fn: 'sum' } };
const BY_CUSTOMER = { title: 'By customer', kind: 'table', layout: 'Invoices', groupBy: ['Customer'], measure: { field: 'Amount', fn: 'sum' } };

/** Signed in, two dashboards saved through the page's own API, and the Dashboards page open on "Billing". */
async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.goto(hosted.url + '/app/dashboard.html');
  const made = await page.evaluate(async ([a, b]) => {
    const s = JSON.parse(sessionStorage.getItem('tabularius.session')!);
    const base = `/tabularius/dashboards/v1/databases/${encodeURIComponent(s.db)}`;
    const out: number[] = [];
    const headers = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' };
    // Each test starts from the same two dashboards.
    for (const old of (await (await fetch(base, { headers })).json()).dashboards as { id: string }[]) await fetch(`${base}/${old.id}`, { method: 'DELETE', headers });
    for (const body of [{ name: 'Billing', widgets: [a, b] }, { name: 'Spare', widgets: [a] }]) {
      const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
      out.push(r.status);
      await r.text();
    }
    return out;
  }, [TOTAL, BY_CUSTOMER]);
  assert.deepEqual(made.map((n) => n < 300), [true, true]);
  await page.reload();
  await page.getByRole('heading', { name: 'Billing' }).waitFor();
  return page;
}

/** What the file has saved for the dashboard with this name. */
async function saved(page: Page, name: string): Promise<{ name: string; widgets: { title: string }[] } | undefined> {
  return page.evaluate(async (wanted) => {
    const s = JSON.parse(sessionStorage.getItem('tabularius.session')!);
    const base = `/tabularius/dashboards/v1/databases/${encodeURIComponent(s.db)}`;
    const headers = { authorization: `Bearer ${s.token}` };
    const list = (await (await fetch(base, { headers })).json()).dashboards as { id: string; name: string }[];
    const one = list.find((d) => d.name === wanted);
    return one ? (await (await fetch(`${base}/${one.id}`, { headers })).json()).dashboard : undefined;
  }, name);
}

test('a saved dashboard is drawn from the records, and Edit renames it, changes, duplicates and removes widgets, and Save keeps them', { skip }, async () => {
  const page = await open();
  try {
    await page.locator('.dash-number').getByText('400').waitFor();
    await page.locator('.dash-table').getByText('Grace').waitFor();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Dashboard name').fill('Billing 2026');
    await page.getByLabel('Title', { exact: true }).first().fill('Everything billed');
    // The second widget is duplicated, and the copy is the one removed again after the first is kept.
    await page.getByRole('button', { name: 'Duplicate' }).nth(1).click();
    await until(() => page.locator('.dash-cell').count(), (n) => n === 3);
    await page.getByRole('button', { name: 'Remove' }).nth(2).click();
    await until(() => page.locator('.dash-cell').count(), (n) => n === 2);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('heading', { name: 'Billing 2026' }).waitFor();
    await page.getByText('Everything billed').first().waitFor();

    const now = await saved(page, 'Billing 2026');
    assert.deepEqual(now?.widgets.map((w) => w.title), ['Everything billed', 'By customer']);
    assert.equal(await saved(page, 'Billing'), undefined);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a preview that comes back after Save has nothing to draw, and breaks nothing', { skip }, async () => {
  const page = await open();
  let release: (() => void) | undefined;
  try {
    await page.locator('.dash-table').getByText('Grace').waitFor();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    // The server answers the preview of the duplicated widget only once Save has finished.
    const held = new Promise<void>((resolve) => { release = resolve; });
    let settled!: () => void;
    const previewSettled = new Promise<void>((resolve) => { settled = resolve; });
    await page.route('**?preview=1', async (route) => {
      await held;
      try {
        await route.continue().catch(() => undefined);
        const response = await route.request().response().catch(() => null);
        await response?.finished().catch(() => null);
      }
      finally { settled(); }
    });
    await page.getByRole('button', { name: 'Duplicate' }).nth(1).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('heading', { name: 'Billing' }).waitFor();
    await page.getByRole('button', { name: 'Edit', exact: true }).waitFor();
    release?.();
    await previewSettled;
    assert.deepEqual(page.errors, []);
    assert.equal(await page.locator('.dash-cell').count(), 3, 'the saved dashboard shows its three widgets');
  } finally {
    release?.();
    await page.context().close();
  }
});

test('a preview that comes back after a widget was removed is worked out again, and breaks nothing', { skip }, async () => {
  const page = await open();
  let release: (() => void) | undefined;
  try {
    await page.locator('.dash-table').getByText('Grace').waitFor();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Duplicate' }).nth(1).click();
    await until(() => page.locator('.dash-cell').count(), (n) => n === 3);
    // The preview of a typed title is answered, for three widgets, only after the third was removed.
    const held = new Promise<void>((resolve) => { release = resolve; });
    let held1 = false;
    await page.route('**?preview=1', async (route) => {
      if (held1) return void route.continue().catch(() => undefined);
      held1 = true;
      await held;
      await route.continue().catch(() => undefined);
    });
    await page.getByLabel('Title', { exact: true }).first().fill('Everything billed');
    await until(async () => held1, (v) => v);
    await page.getByRole('button', { name: 'Remove' }).nth(2).click();
    await until(() => page.locator('.dash-cell').count(), (n) => n === 2);
    release?.();
    await page.getByText('Everything billed').first().waitFor();
    await page.waitForTimeout(500);
    assert.deepEqual(page.errors, []);
    assert.equal(await page.locator('.dash-cell').count(), 2);
  } finally {
    release?.();
    await page.context().close();
  }
});

test('Cancel puts back what Edit changed', { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Dashboard name').fill('Not this');
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await until(() => page.locator('.dash-cell').count(), (n) => n === 1);
    // Drawing the page again for the removed widget keeps the name typed.
    assert.equal(await page.getByLabel('Dashboard name').inputValue(), 'Not this');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('heading', { name: 'Billing' }).waitFor();
    await until(() => page.locator('.dash-cell').count(), (n) => n === 2);
    assert.equal((await saved(page, 'Billing'))?.widgets.length, 2);
    assert.equal(await saved(page, 'Not this'), undefined);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('Delete asks first, and the other dashboard is shown after', { skip }, async () => {
  const page = await open();
  try {
    const answer = (accept: boolean) => new Promise<string>((resolve) => page.once('dialog', (d) => { resolve(d.message()); void (accept ? d.accept() : d.dismiss()); }));
    const dismissed = answer(false);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.match(await dismissed, /Delete the dashboard "Billing"/);
    assert.ok(await saved(page, 'Billing'));
    const accepted = answer(true);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await accepted;
    await until(async () => saved(page, 'Billing'), (d) => d === undefined);
    await page.getByRole('heading', { name: 'Spare' }).waitFor();
    assert.ok(await saved(page, 'Spare'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
