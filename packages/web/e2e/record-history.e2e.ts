// Record History in a real browser, on a small database built here with no .fmp12: edit a field, open Records >
// Record History… to see who changed it and from where, and put the old value back with one click.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
const ids: Record<string, number> = {};

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Code' }, { name: 'Note' }] }] as DesignOp[]);
  for (const o of store.design('Items')!.objects) if (o.kind === 'field' && o.field?.field) ids[o.field.field] = o.id;
  store.create('Items', { Code: 'ab-1', Note: 'first' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, ids.Note).inputValue(), (v) => v !== '');
  return page;
}

test('a changed field shows in Record History with its source, and one click puts it back', { skip }, async () => {
  const page = await open();
  await field(page, ids.Note).fill('second');
  await field(page, ids.Code).focus();
  await until(async () => hosted.store('Shop').find('Items', { limit: 10 }).records[0].fieldData.Note, (v) => v === 'second');

  await page.locator('.menubar').getByRole('button', { name: 'Records' }).click();
  await page.getByRole('menuitem', { name: 'Record History…' }).click();
  const sheet = page.locator('dialog.history-sheet');
  await sheet.waitFor();
  const change = sheet.locator('.history-change', { hasText: 'Note' }).first();
  await change.waitFor();
  assert.match(await sheet.locator('.history-head').first().innerText(), /Changed by Ann/);
  assert.match(await sheet.locator('.history-head').first().innerText(), /via the web client/);
  assert.match(await change.innerText(), /first\s*→\s*second/);

  await change.getByRole('button', { name: 'Put back' }).click();
  await until(async () => hosted.store('Shop').find('Items', { limit: 10 }).records[0].fieldData.Note, (v) => v === 'first');
  // The put-back is logged as a change of its own that names the entry it reverts.
  const last = hosted.store('Shop').auditLog({ table: 'Items' }).at(-1)!;
  assert.equal(last.kind, 'update');
  assert.equal(last.surface, 'web');
  assert.ok(last.revertOf);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await field(page, ids.Note).waitFor();
  await until(() => field(page, ids.Note).inputValue(), (v) => v === 'first');
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.context().close();
});
