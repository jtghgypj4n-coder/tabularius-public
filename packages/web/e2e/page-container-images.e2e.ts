// A modern layout's page shows container pictures: the links the server gives with a record's container fields are
// pointed at the window's own address, which the page's image policy allows, and nothing else loads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { modernDesign } from '../src/page-source.ts';
import { goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');

const PAGE = `<!doctype html><body>
<img id="photo" alt=""><img id="thumb" alt=""><img id="outside" alt="" src="https://example.com/x.png">
<script>
  tabularius.records('Pics', { limit: 1 }).then(function (r) {
    var url = r.data[0].fieldData.Photo;
    document.getElementById('photo').src = url;
    document.getElementById('thumb').src = tabularius.image(url, 32);
    document.body.dataset.url = url;
    document.body.dataset.helper = tabularius.image('https://elsewhere.test/x.png') === '' ? 'refused' : 'allowed';
  });
</script></body>`;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Gallery'] });
  const store = hosted.store('Gallery');
  store.applyDesign([{ op: 'createTable', name: 'Pics', fields: [{ name: 'Title' }, { name: 'Photo', type: 'container' }] }] as DesignOp[]);
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === 'Pics')!.id;
  store.applyDesign([{ op: 'createLayout', name: 'Show', occurrence, design: modernDesign('Show', 'Pics', PAGE) }] as DesignOp[]);
  const { recordId } = store.create('Pics', { Title: 'One' });
  store.setContainer('Pics', Number(recordId), 'Photo', 1, { filename: 'a.png', mime: 'image/png', data: PNG });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('a page shows a record\'s container picture and its thumbnail, and loads nothing from outside', { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Gallery', 'Ann', PASSWORD);
  await goToLayout(page, 'Show');
  const frame = page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');
  const loaded = (id: string) => frame.locator(id).evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0));
  await until(() => loaded('#photo'), (w) => w === 2);
  await until(() => loaded('#thumb'), (w) => w > 0);
  // The link points at the address the window was opened from, whatever address the server knows itself by.
  assert.ok((await frame.locator('body').getAttribute('data-url'))!.startsWith(new URL(hosted.url).origin + '/tabularius/containers/'));
  assert.equal(await frame.locator('body').getAttribute('data-helper'), 'refused');
  assert.equal(await frame.locator('#outside').evaluate((i: HTMLImageElement) => i.naturalWidth), 0);
});
