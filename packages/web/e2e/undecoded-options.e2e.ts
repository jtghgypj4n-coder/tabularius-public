import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Browser } from 'playwright-core';
import { decodeStepParams, type ParamContext } from '../../fmp12/src/index.ts';
import { host, launch, signIn, until, window } from './harness.ts';

const ctx: ParamContext = {
  formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined,
  tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined,
};

test('Design shows binary option warnings before running and retains them after save/reopen', async () => {
  const hosted = await host({ stores: ['Options'] });
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const store = hosted.store('Options');
    const rec = new Uint8Array(28); rec[26] = 1;
    store.applyDesign([
      { op: 'createTable', name: 'Rows', fields: [{ name: 'Name' }] },
      { op: 'createScript', name: 'Imported', steps: [
        { name: 'Revert Transaction', params: decodeStepParams(207, rec, undefined, ctx) },
        { name: 'Set Revert Transaction on Error', params: decodeStepParams(223, rec, undefined, ctx) },
        { name: 'Import Records', params: decodeStepParams(35, rec, undefined, ctx) },
      ] },
    ]);
    store.create('Rows', { Name: 'unchanged' });
    store.setPassword('Admin', 'option-check-secret', '[Full Access]');
    const page = await window(browser);
    await signIn(page, hosted.url, 'Options', 'Admin', 'option-check-secret');
    await page.goto(hosted.url + '/app/design.html#scripts=Imported');
    const editor = page.getByRole('textbox', { name: 'Steps of Imported' });
    const shown = await until(() => editor.inputValue(), (text) => text.includes('Mode: Undecoded'));
    assert.match(shown, /Undecoded options: Condition/);
    assert.match(shown, /Undecoded options: On\/Off/);
    await until(() => page.locator('.se-lint-error').count(), (n) => n === 3);
    assert.match(await page.locator('.se-lint-list').innerText(), /This step did not revert the transaction/);
    assert.match(await page.locator('.se-lint-list').innerText(), /No records were imported/);
    await editor.fill(shown + '\n# unrelated edit');
    await page.getByRole('button', { name: 'Save script', exact: true }).click();
    await until(() => editor.inputValue(), (text) => text.includes('# unrelated edit'));
    await page.reload();
    await until(() => editor.inputValue(), (text) => text.includes('# unrelated edit') && text.includes('Mode: Undecoded'));
    await until(() => page.locator('.se-lint-error').count(), (n) => n === 3);
    assert.deepEqual(page.errors, []);
    await page.screenshot({ path: join(tmpdir(), 's-failsafe-design-options.png'), fullPage: true });
    assert.equal(store.findIds('Rows').length, 1);
  } finally { await browser?.close(); await hosted.close(); }
});
