// A dashboard template in a real browser: the page worked out from a table's fields shows live figures, a chart by
// category, a chart by month and the latest records, as the signed-in account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { modernDesign } from '../src/page-source.ts';
import { dashboardPage, planDashboard } from '../src/page-templates.ts';
import { goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Dash'] });
  const store = hosted.store('Dash');
  store.applyDesign([{ op: 'createTable', name: 'Invoices', fields: [{ name: 'Customer' }, { name: 'Status' }, { name: 'Total', type: 'number' }, { name: 'Issued', type: 'date' }] }] as DesignOp[]);
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === 'Invoices')!.id;
  const table = { id: 1, name: 'Invoices', records: 4, fields: [
    { id: 1, name: 'Customer', kind: 'normal', type: 'text' }, { id: 2, name: 'Status', kind: 'normal', type: 'text' },
    { id: 3, name: 'Total', kind: 'normal', type: 'number' }, { id: 4, name: 'Issued', kind: 'normal', type: 'date' }] };
  store.applyDesign([{ op: 'createLayout', name: 'Overview', occurrence, design: modernDesign('Overview', 'Overview', dashboardPage('Overview', 'Overview', planDashboard(table as never))) }] as DesignOp[]);
  for (const [c, s, t, d] of [['Ada', 'Paid', 100, '2026-01-10'], ['Grace', 'Open', 250, '2026-02-11'], ['Linus', 'Paid', 50, '2026-02-20'], ['Hedy', 'Late', 200, '2026-03-05']] as const) {
    store.create('Invoices', { Customer: c, Status: s, Total: t, Issued: d });
  }
  const tableOf = (name: string, fields: { name: string; type: string }[]) => ({ id: 1, name, records: 3, fields: fields.map((f, i) => ({ id: i + 1, name: f.name, kind: 'normal', type: f.type })) });
  const billing = tableOf('Invoices', [{ name: 'Customer', type: 'text' }, { name: 'Status', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'Issued', type: 'date' }]);
  store.applyDesign([{ op: 'createLayout', name: 'Billing', occurrence, design: modernDesign('Billing', 'Billing', dashboardPage('Billing', 'Billing', planDashboard(billing as never, 'invoicing'))) }] as DesignOp[]);
  store.applyDesign([{ op: 'createTable', name: 'Stock', fields: [{ name: 'Item' }, { name: 'Qty', type: 'number' }] }, { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }, { name: 'Source' }, { name: 'Added', type: 'date' }] }] as DesignOp[]);
  const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
  const stock = tableOf('Stock', [{ name: 'Item', type: 'text' }, { name: 'Qty', type: 'number' }]);
  const contacts = tableOf('Contacts', [{ name: 'Name', type: 'text' }, { name: 'Source', type: 'text' }, { name: 'Added', type: 'date' }]);
  store.applyDesign([
    { op: 'createLayout', name: 'Levels', occurrence: occ('Stock'), design: modernDesign('Levels', 'Levels', dashboardPage('Levels', 'Levels', planDashboard(stock as never, 'inventory'))) },
    { op: 'createLayout', name: 'People', occurrence: occ('Contacts'), design: modernDesign('People', 'People', dashboardPage('People', 'People', planDashboard(contacts as never, 'crm'))) },
  ] as DesignOp[]);
  for (const [i, q] of [['Bolt', 50], ['Nut', 4], ['Washer', 0], ['Screw', 10]] as const) store.create('Stock', { Item: i, Qty: q });
  const today = new Date().toISOString().slice(0, 10);
  for (const [n, d] of [['Ann', today], ['Bo', today], ['Cy', '2020-01-01']] as const) store.create('Contacts', { Name: n, Source: 'Web', Added: d });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('the dashboard template shows live tiles, both charts and the latest records', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Dash', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Overview');
  const frame = page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');
  await until(() => frame.locator('#count').textContent(), (t) => t === '4');
  await until(() => frame.locator('#sum').textContent(), (t) => t === '600');
  await until(() => frame.locator('#avg').textContent(), (t) => t === '150');
  await until(() => frame.locator('#by-category rect').count(), (n) => n === 3);
  await until(() => frame.locator('#by-month path.line').count(), (n) => n === 1);
  await until(() => frame.locator('#latest li').count(), (n) => n === 4);
  assert.deepEqual((await frame.locator('#by-category text').allTextContents()).sort(), ['Late', 'Open', 'Paid']);
  // The donut shares the same figures out: Open 250, Late 200, Paid 150 of 600.
  await until(() => frame.locator('#share circle.arc').count(), (n) => n === 3);
  assert.deepEqual(await frame.locator('#share li').allTextContents(), ['Open42%', 'Late33%', 'Paid25%']);
  // The period narrows the figures: nothing was issued last year; this year to date holds all four (dates are in January to March).
  await frame.locator('#period').selectOption('last year');
  await until(() => frame.locator('#count').textContent(), (t) => t === '0');
  // A chosen period also says how the figures moved from the one before it.
  await frame.locator('#period').selectOption('year to date');
  await until(() => frame.locator('#count-trend').textContent(), (t) => /vs the same days last year$/.test(t ?? ''));
  await until(() => frame.locator('#sum-trend').textContent(), (t) => /vs the same days last year$/.test(t ?? ''));
  await frame.locator('#period').selectOption('');
  await until(() => frame.locator('#count').textContent(), (t) => t === '4');
  assert.equal(await frame.locator('#count-trend').textContent(), '');
  // Choosing a bar narrows the figures to that group (Paid: Ada 100 and Linus 50), the charts still show every group, and Clear undoes it.
  await frame.locator('#by-category rect[aria-label^="Paid"]').click();
  await until(() => frame.locator('#count').textContent(), (t) => t === '2');
  await until(() => frame.locator('#sum').textContent(), (t) => t === '150');
  assert.equal(await frame.locator('#by-category rect').count(), 3);
  assert.match((await frame.locator('#picked').textContent())!, /Status = Paid/);
  await frame.locator('#picked button').click();
  await until(() => frame.locator('#count').textContent(), (t) => t === '4');
  assert.equal(await frame.locator('#picked').isHidden(), true);
  // Print / Save as PDF asks the window for its print dialog (stood in for here, which a headless browser can't show).
  await page.evaluate(() => { const g = globalThis as unknown as { printed: number; print: () => void }; g.printed = 0; g.print = () => { g.printed++; }; });
  await frame.locator('#print').click();
  await until(() => page.evaluate(() => (globalThis as unknown as { printed: number }).printed), (n) => n === 1);
  assert.equal(await frame.locator('.err').count(), 0);
  assert.deepEqual(page.errors, []);
});

test('flavoured templates add the figures their kind of solution needs', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Dash', 'Ann', 'ann-secret-1');
  const frame = page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');
  await goToLayout(page, 'Billing');
  await until(() => frame.locator('#owed').textContent(), (t) => t === '450');
  await until(() => frame.locator('#paid').textContent(), (t) => t === '150');
  await goToLayout(page, 'Levels');
  await until(() => frame.locator('#low').textContent(), (t) => t === '3');
  await until(() => frame.locator('#none').textContent(), (t) => t === '1');
  await goToLayout(page, 'People');
  await until(() => frame.locator('#fresh').textContent(), (t) => t === '2');
  assert.equal(await frame.locator('.err').count(), 0);
  assert.deepEqual(page.errors, []);
});
