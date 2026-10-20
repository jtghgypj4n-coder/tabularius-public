// Modernize interfaces: a table with a container field shows its picture on cards and in the form, and says so when the
// file is not a picture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { modernizeChange } from '../../server/src/modernize.ts';
import { goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');
const frameOf = (page: Awaited<ReturnType<typeof window>>) => page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Gallery'] });
  const store = hosted.store('Gallery');
  store.applyDesign([{ op: 'createTable', name: 'Pics', fields: [{ name: 'Title' }, { name: 'Place' }, { name: 'Photo', type: 'container' }] }] as DesignOp[]);
  for (const [title, file] of [['Sky', { filename: 'a.png', mime: 'image/png', data: PNG }], ['Report', { filename: 'r.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\n') }]] as const) {
    const { recordId } = store.create('Pics', { Title: title, Place: 'Oslo' });
    store.setContainer('Pics', Number(recordId), 'Photo', 1, file);
  }
  store.applyDesign(modernizeChange(store, { styles: ['modern-list'] }).changes);
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('cards and the form show a container as a picture, and a file that is not a picture says it has one', { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Gallery', 'Ann', PASSWORD);
  await goToLayout(page, 'Pics - Modern list');
  const frame = frameOf(page);
  await until(() => frame.locator('tbody tr').count(), (n) => n === 2);
  await frame.getByRole('button', { name: 'Cards', exact: true }).click();
  await until(() => frame.locator('button.card').count(), (n) => n === 2);
  const loaded = (card: string) => frame.locator('button.card', { hasText: card }).locator('.thumb img').evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0));
  await until(() => loaded('Sky'), (w) => w > 0);
  await until(() => frame.locator('button.card', { hasText: 'Report' }).locator('.thumb').innerText(), (t) => t === 'Has a file');
  // The form shows the picture too.
  await frame.locator('button.card', { hasText: 'Sky' }).click();
  await until(() => frame.locator('#form .pic img').evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)), (w) => w > 0);
  // Saving a change leaves the container alone.
  await frame.locator('input[data-field="Place"]').fill('Bergen');
  await frame.locator('#save').click();
  await until(() => frame.locator('#status').textContent(), (t) => /Saved/.test(t ?? ''));
  assert.deepEqual(page.errors, []);
});
