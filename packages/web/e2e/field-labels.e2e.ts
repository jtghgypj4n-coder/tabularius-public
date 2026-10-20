// What a screen reader calls a field, in a real browser: the label drawn
// beside or above it on the layout, else the field's name. Built here, with
// no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Labels'] });
  const store = hosted.store('Labels');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'nm' }, { name: 'tel' }, { name: 'Notes' }] }] as DesignOp[]);
  const design = store.design('People')!;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const people = store.schema.tableOccurrences.find((t) => t.name === 'People')!;
  const table = store.schema.tables.find((t) => t.name === 'People')!;
  const field = (id: number, name: string, top: number, left: number): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style: {}, bounds: { top, left, bottom: top + 20, right: left + 200 },
    field: { tableOccurrenceId: people.id, fieldId: table.fields.find((f) => f.name === name)!.id, tableOccurrence: 'People', field: name, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const text = (id: number, words: string, top: number, left: number, right: number): LayoutObject => ({ id, kind: 'text', type: 0, anchors, style: {}, bounds: { top, left, bottom: top + 18, right }, text: words } as LayoutObject);
  const body = design.parts.find((p) => p.kind === 'body')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: {
    parts: [{ ...body, top: 0, height: 300 }],
    objects: [
      // A label to the left, one above, and a field with none.
      text(1, 'Full name:', 20, 10, 110), field(2, 'nm', 20, 120),
      text(3, 'Phone', 60, 120, 200), field(4, 'tel', 80, 120),
      field(5, 'Notes', 160, 120),
    ],
  } }] as DesignOp[]);
  store.create('People', { nm: 'Ada' });
  store.setPassword('Admin', 'admin-secret-1', '[Full Access]');
  browser = await launch();
  page = await window(browser);
  await signIn(page, hosted.url, 'Labels', 'Admin', 'admin-secret-1');
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('a field is named by the label drawn beside or above it, else by its name', { skip }, async () => {
  await page.getByRole('textbox', { name: 'Full name' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Full name' }).inputValue(), 'Ada');
  assert.equal(await page.getByRole('textbox', { name: 'Phone' }).count(), 1);
  assert.equal(await page.getByRole('textbox', { name: 'Notes' }).count(), 1);
  assert.deepEqual(page.errors, []);
});
