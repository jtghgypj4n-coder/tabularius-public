// The Format menu in a related field outside a portal, in a real browser: the first related record keeps the
// formatting, as FileMaker writes the field's value there.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let tea = 0;

// The generated Customers form's Name field, and the related Orders::Item field added below it.
const NAME = 5;
const ITEM = 950;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
  ] as DesignOp[]);
  const design = store.design('Customers')!;
  const orders = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const item = store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === 'Item')!.id;
  const related = {
    id: ITEM, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, style: design.objects.find((o) => o.id === NAME)!.style,
    bounds: { top: 182, left: 160, bottom: 204, right: 400 },
    field: { tableOccurrenceId: orders.id, fieldId: item, tableOccurrence: 'Orders', field: 'Item', display: 'edit', repetitions: 1 },
  } as LayoutObject;
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 240 } : p.kind === 'footer' ? { ...p, top: 300 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { parts, objects: [...design.objects, related] } }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  tea = store.create('Orders', { CustomerId: 1, Item: 'Teapot' }).recordId;
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('Format > Style > Bold on a related field formats the related record', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  const box = field(page, ITEM);
  await until(() => box.inputValue(), (v) => v === 'Teapot');
  await box.click();
  await box.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 3));
  await page.keyboard.press('ControlOrMeta+Shift+b');
  const styles = await until(async () => hosted.store('Shop').get('Orders', tea).styles?.Item, (v) => !!v?.length);
  assert.deepEqual(styles, [{ start: 0, end: 3, style: 256 }]); // bold
  // The value is unchanged, and the customer's own fields keep no formatting for it.
  assert.equal(hosted.store('Shop').get('Orders', tea).fieldData.Item, 'Teapot');
  assert.deepEqual(page.errors, []);
  await page.close();
});
