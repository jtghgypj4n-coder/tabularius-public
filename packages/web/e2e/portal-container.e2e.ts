// A container field in a portal row, in a real browser: a file put in through its menu goes to the related record
// (not the one on screen), is shown in the row, and is cleared again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
const ID = 1;
const FILE = 21;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Desk'] });
  const store = hosted.store('Desk');
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Docs', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Title' }, { name: 'File', type: 'container' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Docs', predicates: [{ left: 'Id', right: 'ContactId' }], allowCreation: true },
  ] as DesignOp[]);
  const design = store.design('Contacts')!;
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const box = (id: number, table: string, name: string, top: number, left: number, width: number, height = 22): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: { top, left, bottom: top + height, right: left + width },
    field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table, field: name, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const objects: LayoutObject[] = [
    box(ID, 'Contacts', 'Id', 10, 20, 100),
    { id: 900, kind: 'portal', type: 9, name: 'Docs', anchors, style: {}, bounds: { top: 150, left: 160, bottom: 300, right: 520 },
      portal: { tableOccurrenceId: occ('Docs').id, tableOccurrence: 'Docs', rows: 3, initialRow: 1 },
      children: [box(20, 'Docs', 'Title', 154, 164, 120), box(FILE, 'Docs', 'File', 154, 300, 120, 40)] } as unknown as LayoutObject,
  ];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { parts: design.parts.map((x) => x.kind === 'body' ? { ...x, height: 320 } : x.kind === 'footer' ? { ...x, top: 380 } : x), objects } }] as DesignOp[]);
  store.create('Contacts', { Id: 1 });
  store.create('Docs', { ContactId: 1, Title: 'Manual' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The related record's File field as the Data API reads it (a URL to its file, or ''). */
const stored = () => String(hosted.store('Desk').find('Docs', { query: [{ ContactId: '==1' }] }).records[0].fieldData.File ?? '');

test('a portal row\'s container takes a file from its menu, and is cleared again', { skip }, async () => {
  const page: Page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Desk', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, ID).inputValue(), (v) => v === '1');
  const container = page.locator(`.fm-portal-row[data-row] .fm[data-id="${FILE}"]`).first().getByRole('button');
  await container.click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Insert Picture…' }).click()]);
  await chooser.setFiles({ name: 'red.png', mimeType: 'image/png', buffer: PNG });
  await until(async () => stored(), (v) => v !== '');
  assert.match(stored(), /red\.png/);
  await until(() => container.getAttribute('aria-label'), (l) => /red\.png/.test(l ?? ''));
  await container.click();
  await page.getByRole('menuitem', { name: 'Clear' }).click();
  await until(async () => stored(), (v) => v === '');
  await page.context().close();
});
