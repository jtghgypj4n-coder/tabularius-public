import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { interfacePage, planInterface } from '../src/modernize.ts';
import type { Mode } from '../src/modernize.ts';
import { launch, skipUnless, window as browserWindow } from './harness.ts';

const skip = skipUnless();
let browser: Browser;
let page: Page & { errors: string[] };
const plan = planInterface({ name: 'People', fields: [
  { name: 'Name', type: 'text', kind: 'normal' },
  { name: 'Notes', type: 'text', kind: 'normal' },
  { name: 'Status', type: 'text', kind: 'normal', values: ['New', 'Active'] },
  { name: 'Since', type: 'date', kind: 'normal' },
] });
const rows = ['Ada', 'Grace', 'Hedy'].map((Name, i) => ({ recordId: String(i + 1), fieldData: { Name, Notes: '', Status: 'New', Since: '3/5/2024' } }));

before(async () => {
  if (skip) return;
  browser = await launch();
  page = await browserWindow(browser);
});

after(async () => { await browser?.close(); });

async function open(mode: Mode): Promise<void> {
  const bootstrap = `<script>
    window.testState = { allow: false, prompts: [], fail: false, reads: 0 };
    var data = ${JSON.stringify(rows)};
    window.tabularius = {
      context: async () => ({ recordNumber: 2 }),
      records: async (_layout, options) => { window.testState.reads++; return { data: data.slice(options.offset - 1, options.offset - 1 + options.limit), foundCount: data.length }; },
      record: async (_layout, id) => ({ data: data.filter((r) => r.recordId === id) }),
      update: async (_layout, id, changes) => { if (window.testState.fail) throw new Error('Save failed'); Object.assign(data.find((r) => r.recordId === id).fieldData, changes); return {}; },
      create: async (_layout, changes) => { if (window.testState.fail) throw new Error('Save failed'); const row = { recordId: String(data.length + 1), fieldData: { Name: '', Notes: '', Status: '', Since: '', ...changes } }; data.push(row); return { recordId: row.recordId }; },
      on: () => {},
    };
    window.confirm = (message) => { window.testState.prompts.push(String(message)); return window.testState.allow; };
  </script>`;
  await page.setContent(interfacePage('People', plan, mode).replace('<script>', `${bootstrap}<script>`));
  if (mode !== 'detail') await page.locator('tr[data-id="2"]').click();
  await page.waitForFunction(() => !!document.querySelector('#form input'));
  await page.evaluate(() => {
    const s = (window as any).testState;
    s.allow = false;
    s.prompts.length = 0;
    s.fail = false;
    s.reads = 0;
  });
}

async function edit(value: string, name = 'Name', event = 'input'): Promise<void> {
  await page.locator(`#form [data-field="${name}"]`).evaluate((element, args) => {
    const field = element as HTMLInputElement;
    field.value = args.value;
    field.dispatchEvent(new Event(args.event, { bubbles: true }));
  }, { value, event });
}

for (const [mode, action, selector, expected] of [
  ['detail', 'Previous', '#first', 'Ada'],
  ['detail', 'Next', '#form .bar button:nth-of-type(2)', 'Hedy'],
  ['detail', 'New', '#new', ''],
  ['list', 'New', '#new', ''],
  ['list', 'Close', '#back', null],
  ['split', 'record selection', 'tr[data-id="1"]', 'Ada'],
] as const) {
  test(`modernize: ${mode} ${action} asks before discarding edits`, { skip }, async () => {
    await open(mode);
    await edit('Draft');
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true, 'dirty forms register a beforeunload guard');
    const reads = await page.evaluate(() => (window as any).testState.reads);
    await page.locator(selector).click();
    assert.equal(await page.evaluate(() => (window as any).testState.prompts.length), 1);
    assert.match(await page.evaluate(() => (window as any).testState.prompts[0]), /unsaved/i);
    assert.equal(await page.locator('#form [data-field="Name"]').inputValue(), 'Draft');
    assert.equal(await page.evaluate(() => (window as any).testState.reads), reads, 'cancel does not load another record');
    await page.evaluate(() => { (window as any).testState.allow = true; });
    await page.locator(selector).click();
    await page.waitForFunction((wanted) => {
      const field = document.querySelector('#form [data-field="Name"]') as HTMLInputElement | null;
      return (window as any).testState.prompts.length === 2 && (field?.value ?? null) === wanted;
    }, expected);
    const nameField = page.locator('#form [data-field="Name"]');
    assert.equal(await nameField.count() ? await nameField.inputValue() : null, expected);
    assert.equal(await page.evaluate(() => (window as any).testState.prompts.length), 2);
    await open(mode);
    await page.locator(selector).click();
    assert.equal(await page.evaluate(() => (window as any).testState.prompts.length), 0, 'clean forms navigate freely');
  });
}

test('modernize: reverted edits clear the unload guard and failed saves stay dirty', { skip }, async () => {
  await open('list');
  for (const [name, changed, event] of [['Name', 'Draft', 'input'], ['Notes', 'Draft notes', 'input'], ['Status', 'Active', 'change'], ['Since', '2025-01-01', 'change']]) {
    const field = page.locator(`#form [data-field="${name}"]`);
    const saved = await field.inputValue().catch(async () => (await field.locator('option:checked').textContent()) ?? '');
    await edit(changed, name, event);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#form input,#form select,#form textarea')].some((c) => (c as HTMLInputElement).value !== (c as HTMLElement).dataset.saved)), true, name);
    await edit(saved, name, event);
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), false, name);
    assert.equal(await page.evaluate(() => (window as any).testState.prompts.length), 0);
  }
  await edit('Changed');
  await page.evaluate(() => { (window as any).testState.fail = true; });
  await page.locator('#save').click();
  await page.getByText('Save failed').waitFor();
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#form input,#form select,#form textarea')].some((c) => (c as HTMLInputElement).value !== (c as HTMLElement).dataset.saved)), true);
  await page.evaluate(() => { (window as any).testState.fail = false; });
  await page.locator('#save').click();
  await page.getByText('Saved.').waitFor();
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#form input,#form select,#form textarea')].some((c) => (c as HTMLInputElement).value !== (c as HTMLElement).dataset.saved)), false);
  assert.deepEqual(page.errors, []);
});
