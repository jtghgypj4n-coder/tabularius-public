// Freeze Window in a real browser: while a script is frozen, a dialog it asks for opens over the screen as it was
// before the script changed anything; Refresh Window (or the end of the script) then shows the change. Without
// Freeze Window the dialog opens over the changed screen.
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
const PLAIN = 930;
const FROZEN = 931;
let TITLE = 0;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Desk'] });
  const store = hosted.store('Desk');
  const ask = 'Show Custom Dialog [ "Hold" ; "Look at the screen" ; Button 1: "OK" ]';
  const commit = 'Commit Records/Requests [ With dialog: Off ]';
  store.applyDesign([
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] },
    { op: 'createScript', name: 'Plain', text: `Set Field [ Notes::Title ; "Plain" ]\n${commit}\n${ask}` },
    { op: 'createScript', name: 'Frozen', text: `Set Field [ Notes::Title ; "Frozen" ]\n${commit}\nFreeze Window\n${ask}\nRefresh Window` },
  ] as DesignOp[]);
  const design = store.design('Notes')!;
  TITLE = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Title')!.id;
  const scriptId = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const button = (id: number, left: number, text: string, script: string): LayoutObject => ({
    id, kind: 'button', type: 0, text, anchors, style: {}, bounds: { top: 200, left, bottom: 224, right: left + 110 },
    action: { stepId: 1, step: 'Perform Script', scriptId: scriptId(script), script },
  } as LayoutObject);
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 240 } : p.kind === 'footer' ? { ...p, top: 300 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: {
    parts, objects: [...design.objects, button(PLAIN, 20, 'Plain', 'Plain'), button(FROZEN, 140, 'Frozen', 'Frozen')],
  } }] as DesignOp[]);
  store.create('Notes', { Title: 'Alpha' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Desk', 'Ann', PASSWORD);
  await until(() => field(page, TITLE).inputValue(), (v) => v !== '');
  return page;
}

const press = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`).click();

test('Freeze Window: the dialog opens over the screen as it was, and Refresh Window then shows the change', { skip }, async () => {
  const page = await open();
  try {
    await press(page, FROZEN);
    const dialog = page.getByRole('dialog', { name: 'Hold' });
    await dialog.waitFor();
    // Let the browser paint twice while the dialog is open; the frozen screen must still be intact.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await field(page, TITLE).inputValue(), 'Alpha', 'the screen is held while the script asks');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await until(() => field(page, TITLE).inputValue(), (v) => v === 'Frozen');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('without Freeze Window the dialog opens over the changed screen', { skip }, async () => {
  hosted.store('Desk').update('Notes', 1, { Title: 'Alpha' });
  const page = await open();
  try {
    await press(page, PLAIN);
    const dialog = page.getByRole('dialog', { name: 'Hold' });
    await dialog.waitFor();
    await until(() => field(page, TITLE).inputValue(), (v) => v === 'Plain');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
