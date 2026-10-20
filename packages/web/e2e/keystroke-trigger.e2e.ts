// OnObjectKeystroke in a real browser, on a small database built here with no .fmp12: a field whose
// trigger script drops every key but digits and Backspace, so letters typed never reach it, and
// Get ( TriggerKeystroke ) says what was typed.
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
const CODE = 2;
const FREE = 3;
const LOG = 4;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Keys'] });
  const store = hosted.store('Keys');
  store.applyDesign([
    { op: 'createTable', name: 'Parts', fields: [{ name: 'Id', type: 'number' }, { name: 'Code' }, { name: 'Free' }] },
    { op: 'createScript', name: 'DigitsOnly', text: [
      'Set Variable [ $$log ; Value: $$log & "[" & Get ( TriggerKeystroke ) & "]" ]',
      'If [ Get ( TriggerKeystroke ) ≠ Char ( 8 ) and Filter ( Get ( TriggerKeystroke ) ; "0123456789" ) = "" ]',
      'Exit Script [ Text Result: False ]',
      'End If',
    ].join('\n') },
  ] as DesignOp[]);
  const design = store.design('Parts')!;
  const occ = store.schema.tableOccurrences.find((t) => t.name === 'Parts')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Parts')!.fields.find((f) => f.name === name)!.id;
  const scriptId = store.schema.scripts.find((s) => s.name === 'DigitsOnly')!.id;
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const at = (top: number, height: number, width = 300) => ({ top, left: 20, bottom: top + height, right: 20 + width });
  const box = (id: number, name: string, top: number, extra: Partial<LayoutObject> = {}): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: at(top, 22),
    field: { tableOccurrenceId: occ.id, fieldId: fieldId(name), tableOccurrence: 'Parts', field: name, display: 'edit', repetitions: 1 },
    ...extra,
  } as LayoutObject);
  const objects: LayoutObject[] = [
    box(ID, 'Id', 10),
    box(CODE, 'Code', 40, { triggers: [{ event: 'OnObjectKeystroke', scriptId, script: 'DigitsOnly' }] }),
    box(FREE, 'Free', 70),
    { id: LOG, kind: 'text', type: 2, anchors, style: {}, bounds: at(110, 20, 500), text: 'Keys: <<$$log>>' } as LayoutObject,
  ];
  store.applyDesign([{ op: 'updateLayout', layout: 'Parts', design: { objects } }] as DesignOp[]);
  store.create('Parts', { Id: 1 });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Keys', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, ID).inputValue(), (v) => v === '1');
  return page;
}
async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}
const log = (page: Page) => page.locator(`.fm[data-id="${LOG}"]`).textContent();

test('OnObjectKeystroke sees each key typed and a False result drops it', { skip }, async () => {
  const page = await open();
  try {
    await field(page, CODE).click();
    await page.keyboard.type('a4b2');
    await until(() => log(page), (t) => t === 'Keys: [a][4][b][2]');
    // The letters were dropped before they were typed; the digits went in.
    await until(() => field(page, CODE).inputValue(), (v) => v === '42');
    await page.keyboard.press('Backspace');
    await until(() => field(page, CODE).inputValue(), (v) => v === '4');
    await field(page, CODE).press('Tab');
    await until(async () => hosted.store('Keys').find('Parts', { query: [{ Id: '==1' }] }).records[0].fieldData.Code, (c) => String(c) === '4');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a field with no OnObjectKeystroke trigger takes every key and runs no script', { skip }, async () => {
  const page = await open();
  try {
    await field(page, FREE).click();
    await page.keyboard.type('abc');
    await until(() => field(page, FREE).inputValue(), (v) => v === 'abc');
    assert.ok(!(await log(page))!.includes('[a]'), 'no trigger fired');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
