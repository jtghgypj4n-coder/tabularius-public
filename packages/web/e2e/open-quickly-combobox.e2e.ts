import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['QuickOpen'] });
  const store = hosted.store('QuickOpen');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as DesignOp[]);
  store.create('People', { Name: 'Ada' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('Open Quickly exposes its highlighted result through combobox semantics', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'QuickOpen', 'Ann', PASSWORD);
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: 'Open Quickly' });
    await input.fill('a');
    assert.equal(await input.getAttribute('aria-expanded'), 'true');
    assert.equal(await input.getAttribute('aria-autocomplete'), 'list');
    assert.equal(await page.locator('#quick-open-list').getAttribute('role'), 'listbox');

    for (let i = 0; i < 2; i++) {
      await input.press('ArrowDown');
      const activeId = await input.getAttribute('aria-activedescendant');
      assert.ok(activeId, 'the input names an active option');
      const active = page.locator(`#${activeId}`);
      assert.equal(await active.getAttribute('role'), 'option');
      assert.equal(await active.getAttribute('aria-selected'), 'true');
    }

    await input.press('Escape');
    await page.locator('dialog.quick-open').waitFor({ state: 'detached' });
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
