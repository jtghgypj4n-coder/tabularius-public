// A dashboard template for a table with a container field shows the latest pictures, as thumbnails the page may load.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { modernDesign } from '../src/page-source.ts';
import { dashboardPage, planDashboard } from '../src/page-templates.ts';
import { goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Snaps'] });
  const store = hosted.store('Snaps');
  store.applyDesign([{ op: 'createTable', name: 'Photos', fields: [{ name: 'Title' }, { name: 'Photo', type: 'container' }] }] as DesignOp[]);
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === 'Photos')!.id;
  const table = { id: 1, name: 'Photos', records: 3, fields: [{ id: 1, name: 'Title', kind: 'normal', type: 'text' }, { id: 2, name: 'Photo', kind: 'normal', type: 'container' }] };
  store.applyDesign([{ op: 'createLayout', name: 'Gallery', occurrence, design: modernDesign('Gallery', 'Gallery', dashboardPage('Gallery', 'Gallery', planDashboard(table as never))) }] as DesignOp[]);
  for (const title of ['One', 'Two']) {
    const { recordId } = store.create('Photos', { Title: title });
    store.setContainer('Photos', Number(recordId), 'Photo', 1, { filename: `${title}.png`, mime: 'image/png', data: PNG });
  }
  store.create('Photos', { Title: 'Empty' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('the dashboard shows a thumbnail for each record with a picture and none for the rest', { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Snaps', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Gallery');
  const frame = page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');
  await until(() => frame.locator('#pics img').count(), (n) => n === 2);
  const loaded = await frame.locator('#pics img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth));
  assert.ok(loaded.every((w) => w > 0), `thumbnails loaded: ${loaded}`);
  assert.deepEqual((await frame.locator('#pics img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).alt))).sort(), ['One', 'Two']);
});
