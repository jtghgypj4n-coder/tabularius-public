// A web viewer loads an https address only when an administrator listed its host for the file; any other address
// shows as text saying which host to allow. A listed page runs in a frame of its own origin with none of the app's
// bridge, in a real browser, on a small database built here with no .fmp12. The two pages are answered by the test
// (the browser never leaves the machine).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Pages'] });
  const store = hosted.store('Pages');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] }] as DesignOp[]);
  const design = store.design('Notes')!;
  const body = design.parts.find((p) => p.kind === 'body')!;
  const viewer = (id: number, top: number, address: string): LayoutObject => ({
    id, kind: 'web-viewer', type: 13, external: 'WEBV', style: {}, bounds: { top, left: 20, bottom: top + 120, right: 520 },
    anchors: { left: true, top: true, right: false, bottom: false },
    webUrl: JSON.stringify(address),
    webOptions: { interaction: true, findMode: false, progressBar: false, statusMessages: false, encodeUrl: false, jsBridge: true },
  } as LayoutObject);
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: {
    objects: [...design.objects, viewer(950, body.top + 120, 'https://widgets.example.com/chart'), viewer(951, body.top + 260, 'https://other.example.net/page'), viewer(952, body.top + 400, 'http://widgets.example.com/plain')],
    parts: design.parts.map((p) => p.kind === 'body' ? { ...p, height: Math.max(p.height, 540) } : p.kind === 'footer' ? { ...p, top: body.top + Math.max(body.height, 540) } : p),
  } }] as DesignOp[]);
  store.create('Notes', { Title: 'Alpha' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Awaited<ReturnType<typeof window>>> {
  const page = await window(browser);
  await page.route('https://widgets.example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `<p id='who'>widgets page</p><p id='api'></p><script>document.getElementById('api').textContent = typeof window.FileMaker + ' ' + typeof window.tabularius;</script>` }));
  await page.route('https://other.example.net/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>other page</p>' }));
  await signIn(page, hosted.url, 'Pages', 'Ann', 'ann-secret-1');
  return page;
}

test('with no hosts listed, a web address shows as text and names the host to allow', { skip }, async () => {
  const page = await open();
  const box = page.locator('.fm[data-id="950"]');
  await box.waitFor();
  assert.match(await box.innerText(), /widgets\.example\.com isn't on this file's list of web hosts/);
  assert.equal(await page.locator('.fm[data-id="950"] iframe').count(), 0);
  assert.deepEqual(page.errors, []);
});

test('a listed host loads, in a frame with no bridge; an unlisted host and a plain http address do not', { skip }, async () => {
  hosted.store('Pages').setWebViewerHosts(['widgets.example.com'], { account: 'test' });
  const page = await open();
  const frame = page.frameLocator('.fm[data-id="950"] iframe.fm-webviewer');
  await until(() => frame.locator('#who').textContent(), (t) => t === 'widgets page');
  assert.equal(await frame.locator('#api').textContent(), 'undefined undefined', 'the page gets neither FileMaker nor tabularius');
  const sandbox = await page.locator('.fm[data-id="950"] iframe').getAttribute('sandbox');
  assert.equal(sandbox, 'allow-scripts allow-same-origin allow-forms');
  assert.match(await page.locator('.fm[data-id="951"]').innerText(), /other\.example\.net isn't on this file's list/);
  assert.equal(await page.locator('.fm[data-id="951"] iframe').count(), 0);
  assert.equal(await page.locator('.fm[data-id="952"] iframe').count(), 0, 'http is never loaded');
  // The page that holds the frame also allows exactly that host to be framed.
  const csp = (await page.request.get(hosted.url + '/app/')).headers()['content-security-policy'];
  assert.match(csp, /frame-src 'self' about: data: blob: https:\/\/widgets\.example\.com;/);
  assert.deepEqual(page.errors, []);
});
