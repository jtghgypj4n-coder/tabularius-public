// What a screen reader is told, in a real browser: portal rows' fields say
// their row, a popover button says whether its popover is open, and the
// pages opened from the web client have a heading and a main landmark. The
// database is built here, with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

const PORTAL = 900;
const ITEM = 901;
const OPENER = 910;
const POPOVER = 911;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Names'] });
  const store = hosted.store('Names');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }], allowCreation: 'right' },
  ] as DesignOp[]);
  const design = store.design('Customers')!;
  const orders = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const item = store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === 'Item')!;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const portal = {
    id: PORTAL, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 180, left: 160, bottom: 284, right: 520 },
    portal: { tableOccurrenceId: orders.id, tableOccurrence: 'Orders', rows: 4, initialRow: 1 },
    children: [{
      id: ITEM, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 182, left: 162, bottom: 204, right: 400 },
      field: { tableOccurrenceId: orders.id, fieldId: item.id, tableOccurrence: 'Orders', field: 'Item', display: 'edit', repetitions: 1 },
    }],
  } as LayoutObject;
  const opener = { id: OPENER, kind: 'popover-button', type: 0, anchors, style: {}, bounds: { top: 10, left: 400, bottom: 34, right: 480 }, text: 'More', target: POPOVER } as LayoutObject;
  const popover = { id: POPOVER, kind: 'popover', type: 0, anchors, style: {}, bounds: { top: 40, left: 400, bottom: 120, right: 560 }, titleBar: true, text: 'Details', children: [] } as unknown as LayoutObject;
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 240 } : p.kind === 'footer' ? { ...p, top: 300 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { parts, objects: [...design.objects, portal, opener, popover] } }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.create('Orders', { CustomerId: 1, Item: 'Tea' });
  store.create('Orders', { CustomerId: 1, Item: 'Cake' });
  store.setPassword('Admin', 'admin-secret-1', '[Full Access]');
  browser = await launch();
  page = await window(browser);
  await signIn(page, hosted.url, 'Names', 'Admin', 'admin-secret-1');
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('portal rows\' fields say which row they are in', { skip }, async () => {
  const names = await until(
    () => page.locator(`.fm[data-id="${PORTAL}"] .fm[data-id="${ITEM}"] input, .fm[data-id="${PORTAL}"] .fm[data-id="${ITEM}"] textarea`).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
    (v) => v.length >= 2,
  );
  assert.deepEqual(names.slice(0, 2), ['Item, row 1', 'Item, row 2']);
  if (names.length > 2) assert.equal(names[2], 'Item, new row');
  assert.deepEqual(page.errors, []);
});

test('a popover button says whether its popover is open', { skip }, async () => {
  const button = page.locator(`.fm[data-id="${OPENER}"] button`);
  assert.equal(await button.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(await button.getAttribute('aria-expanded'), 'false');
  await button.click();
  await page.getByRole('dialog', { name: 'Details' }).waitFor();
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await until(() => button.getAttribute('aria-expanded'), (v) => v === 'false');
  assert.deepEqual(page.errors, []);
});

test('Data Viewer and Script Debugger have a heading and a main landmark', { skip }, async () => {
  // In this tab, which holds the sign-in, as the windows the web client opens do.
  const app = page.url();
  for (const [path, title] of [['dataviewer.html', 'Data Viewer'], ['debugger.html', 'Script Debugger']]) {
    await page.goto(new URL(path, app).href);
    await page.getByRole('heading', { level: 1, name: title }).waitFor();
    assert.equal(await page.getByRole('main').count(), 1, path);
  }
});
