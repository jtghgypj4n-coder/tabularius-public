// The dashboard template in the states the figures test doesn't reach: a table with no records yet, and a table with
// more groups than the donut shows (the rest are folded into Other). The page says what is missing rather than
// drawing an empty chart or throwing.
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
const fields = [{ name: 'Customer', type: 'text' }, { name: 'Status', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'Issued', type: 'date' }];

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['States'] });
  const store = hosted.store('States');
  store.applyDesign(['Invoices', 'Quotes'].map((name) => ({ op: 'createTable', name, fields: fields.map((f) => ({ name: f.name, ...(f.type === 'text' ? {} : { type: f.type }) })) })) as DesignOp[]);
  const board = (table: string, layout: string) => {
    const t = { id: 1, name: table, records: 0, fields: fields.map((f, i) => ({ id: i + 1, name: f.name, kind: 'normal', type: f.type })) };
    return { op: 'createLayout', name: layout, occurrence: store.schema.tableOccurrences.find((o) => o.name === table)!.id, design: modernDesign(layout, layout, dashboardPage(layout, layout, planDashboard(t as never))) };
  };
  store.applyDesign([board('Invoices', 'Invoice board'), board('Quotes', 'Quote board')] as DesignOp[]);
  // Eight groups of one record each, totals 10 to 80.
  for (let i = 1; i <= 8; i++) store.create('Invoices', { Customer: `C${i}`, Status: `Stage ${i}`, Total: i * 10, Issued: '2026-02-11' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const frameOf = (page: Awaited<ReturnType<typeof window>>) => page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');

test('a table with no records says so instead of drawing empty charts', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'States', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Quote board');
  const frame = frameOf(page);
  await until(() => frame.locator('#count').textContent(), (t) => t === '0');
  await until(() => frame.locator('#share').textContent(), (t) => /No figures to share out yet/.test(t ?? ''));
  await until(() => frame.locator('#latest').textContent(), (t) => /No records yet/.test(t ?? ''));
  assert.equal(await frame.locator('#share svg').count(), 0);
  assert.equal(await frame.locator('.err').count(), 0);
  assert.deepEqual(page.errors, []);
});

test('the donut shows the six biggest groups and folds the rest into Other, with shares that add up', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'States', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Invoice board');
  const frame = frameOf(page);
  await until(() => frame.locator('#share li').count(), (n) => n === 7);
  const names = (await frame.locator('#share li > span:first-child').allTextContents()).map((t) => t.trim());
  assert.deepEqual(names, ['Stage 8', 'Stage 7', 'Stage 6', 'Stage 5', 'Stage 4', 'Stage 3', 'Other']);
  const shares = (await frame.locator('#share li > span:last-child').allTextContents()).map((t) => Number(t.replace('%', '')));
  // 80, 70, 60, 50, 40, 30 and 30 (20 + 10) of 360.
  assert.deepEqual(shares, [22, 19, 17, 14, 11, 8, 8]);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 100) <= 2);
  assert.equal(await frame.locator('#share circle.arc').count(), 7);
  assert.equal(await frame.locator('.err').count(), 0);
  assert.deepEqual(page.errors, []);
});
