// Editing repetition 2 in a related field and a portal row, in a real browser:
// repetition 1 remains unchanged and both values survive reading the record back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Locator } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let related = 0;
let portal = 0;
let customer = 0;
let order = 0;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Tags', options: { repetitions: 2 } }, { name: 'Notes', options: { repetitions: 2 } }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
  ] as DesignOp[]);
  const design = store.design('Customers')!;
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const table = store.schema.tables.find((t) => t.name === 'Orders')!;
  const ref = (name: string) => ({ tableOccurrenceId: occurrence.id, fieldId: table.fields.find((f) => f.name === name)!.id,
    tableOccurrence: 'Orders', field: name, display: 'edit', repetitions: 2 });
  const style = design.objects.find((o) => o.id === 5)!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  related = 950;
  portal = 960;
  const fieldObject = (id: number, name: string, top: number): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: { top, left: 160, bottom: top + 22, right: 430 }, field: ref(name),
  } as LayoutObject);
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 300 } : p.kind === 'footer' ? { ...p, top: 360 } : p);
  const objects: LayoutObject[] = [
    ...design.objects.filter((o) => o.bounds.top < 140),
    fieldObject(related, 'Tags', 180),
    { id: portal, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 220, left: 150, bottom: 290, right: 440 },
      portal: { tableOccurrenceId: occurrence.id, tableOccurrence: 'Orders', rows: 2, initialRow: 1 },
      children: [fieldObject(961, 'Notes', 222)] } as LayoutObject,
  ];
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { parts, objects } }] as DesignOp[]);
  customer = store.create('Customers', { Id: 1, Name: 'Ada' }).recordId;
  order = store.create('Orders', { CustomerId: 1, 'Tags(1)': 'red', 'Tags(2)': 'green', 'Notes(1)': 'first', 'Notes(2)': 'second' }).recordId;
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

const repetitions = (scope: Locator) => scope.locator('input, textarea');

test('writing repetition 2 in related and portal fields preserves both repetitions after reload', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  const relatedBoxes = repetitions(page.locator(`.fm[data-id="${related}"]`));
  const portalBoxes = repetitions(page.locator(`.fm[data-id="${portal}"] .fm-portal-row`).first().locator(`.fm[data-id="961"]`));
  await until(() => relatedBoxes.nth(1).inputValue(), (v) => v === 'green');
  await until(() => portalBoxes.nth(1).inputValue(), (v) => v === 'second');
  await relatedBoxes.nth(1).fill('blue');
  await relatedBoxes.nth(1).press('Tab');
  await until(async () => hosted.store('Shop').get('Orders', order).fieldData['Tags(2)'], (v) => v === 'blue');
  await portalBoxes.nth(1).fill('changed');
  await portalBoxes.nth(1).press('Tab');
  await until(async () => hosted.store('Shop').get('Orders', order).fieldData['Notes(2)'], (v) => v === 'changed');
  assert.equal(hosted.store('Shop').get('Orders', order).fieldData.Tags, 'red');
  assert.equal(hosted.store('Shop').get('Orders', order).fieldData.Notes, 'first');
  await page.reload();
  const againRelated = repetitions(page.locator(`.fm[data-id="${related}"]`));
  const againPortal = repetitions(page.locator(`.fm[data-id="${portal}"] .fm-portal-row`).first().locator(`.fm[data-id="961"]`));
  await until(() => againRelated.nth(1).inputValue(), (v) => v === 'blue');
  await until(() => againPortal.nth(1).inputValue(), (v) => v === 'changed');
  assert.deepEqual(await Promise.all([againRelated.nth(0).inputValue(), againRelated.nth(1).inputValue()]), ['red', 'blue']);
  assert.deepEqual(await Promise.all([againPortal.nth(0).inputValue(), againPortal.nth(1).inputValue()]), ['first', 'changed']);
  assert.equal(hosted.store('Shop').get('Customers', customer).fieldData.Name, 'Ada');
  assert.deepEqual(page.errors, []);
  await page.close();
});
