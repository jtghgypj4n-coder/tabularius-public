// File Options' OnWindowOpen and OnWindowClose in a real browser: every window the file opens runs OnWindowOpen (the
// first after OnFirstWindowOpen, a Window > New Window one on its own), and File > Close on a window runs OnWindowClose,
// whose script exiting False keeps the window open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Win'] });
  const store = hosted.store('Win');
  store.applyDesign([
    { op: 'createTable', name: 'Things', fields: [{ name: 'Name' }] },
    { op: 'createLayout', name: 'Opened', occurrence: store.schema.tableOccurrences[0]?.name ?? 'Things' },
    { op: 'createLayout', name: 'Closing', occurrence: store.schema.tableOccurrences[0]?.name ?? 'Things' },
    { op: 'createScript', name: 'When a window opens', text: 'Go to Layout [ "Opened" ]' },
    { op: 'createScript', name: 'When a window closes', text: 'Go to Layout [ "Closing" ]\nExit Script [ Text Result: 0 ]' },
    { op: 'setFileOptions', onWindowOpen: 'When a window opens', onWindowClose: 'When a window closes' },
  ] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('OnWindowOpen runs in the first window and in a New Window; OnWindowClose exiting False keeps a window open', { skip }, async () => {
  const context = await browser.newContext();
  const a = await window(context);
  try {
    await signIn(a, hosted.url, 'Win', 'Ann', 'ann-secret-1');
    await until(() => a.locator('select.layout-menu').inputValue(), (v) => v === 'Opened');

    // The new window copies the layout this one is on, so leave Opened first: only the trigger can bring it back.
    await a.locator('select.layout-menu').selectOption('Things');
    await until(() => a.locator('select.layout-menu').inputValue(), (v) => v === 'Things');
    await a.locator('.menubar').getByRole('button', { name: 'Window', exact: true }).click();
    const [b] = await Promise.all([context.waitForEvent('page'), a.getByRole('menuitem', { name: 'New Window' }).click()]);
    const errors: string[] = [];
    b.on('pageerror', (e) => errors.push(e.message));
    await b.locator('select.layout-menu').waitFor();
    await until(() => b.locator('select.layout-menu').inputValue(), (v) => v === 'Opened');

    // File > Close: OnWindowClose goes to Closing and exits False, so the window stays.
    await b.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    await b.getByRole('menuitem', { name: /^Close/ }).first().click();
    await until(() => b.locator('select.layout-menu').inputValue(), (v) => v === 'Closing');
    assert.equal(b.isClosed(), false);
    assert.deepEqual(a.errors, []);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
