// A web viewer page with "Allow JavaScript to perform FileMaker scripts" on (a modern layout) in a real browser:
// window.tabularius reads and changes records as the signed-in account, FileMaker.PerformScript runs a script whose
// result the window then shows, and a page without the option gets neither.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let TITLE = 0;

// No double quotes inside: the page is a text literal in the web viewer's address formula.
const PAGE = `<p id='out'>…</p><p id='ctx'></p><p id='api'></p><button id='go' onclick='FileMaker.PerformScript("Mark", "from page")'>Go</button>
<script>
document.getElementById('api').textContent = typeof window.tabularius + ' ' + typeof window.FileMaker;
if (window.tabularius) {
tabularius.records('Notes', { limit: 10 }).then(function (r) { document.getElementById('out').textContent = r.foundCount + ' notes: ' + r.data.map(function (x) { return x.fieldData.Title }).join(', ') });
tabularius.context().then(function (c) { document.getElementById('ctx').textContent = c.layout + ' #' + c.recordNumber });
tabularius.on('refresh', function () { tabularius.context().then(function (c) { document.getElementById('ctx').textContent = c.layout + ' #' + c.recordNumber + ' ' + c.fieldData.Title }) });
}
async function later(t) { await tabularius.performScript('Mark', t) }
</script>`;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Pages'] });
  const store = hosted.store('Pages');
  store.applyDesign([
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] },
    { op: 'createScript', name: 'Js', text: 'Perform JavaScript in Web Viewer [ Object Name: "pv" ; Function Name: "later" ; Parameters: "viaJS" ]' },
    { op: 'createScript', name: 'Js Popover', text: 'Go to Object [ Object Name: "pv2" ]\nPerform JavaScript in Web Viewer [ Object Name: "pv2" ; Function Name: "later" ; Parameters: "viaPopover" ]' },
    { op: 'createScript', name: 'Mark', text: 'Set Field [ Notes::Title ; Get ( ScriptParameter ) ]\nCommit Records/Requests [ With dialog: Off ]' },
  ] as DesignOp[]);
  const design = store.design('Notes')!;
  TITLE = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Title')!.id;
  const viewer = (id: number, top: number, jsBridge: boolean): LayoutObject => ({
    id, ...(id === 950 ? { name: 'pv' } : id === 953 ? { name: 'pv2' } : {}), kind: 'web-viewer', type: 13, external: 'WEBV', style: {}, bounds: { top, left: 20, bottom: top + 160, right: 520 },
    anchors: { left: true, top: true, right: false, bottom: false },
    webUrl: JSON.stringify('data:text/html,' + PAGE).replace(/\\n/g, '\n'),
    webOptions: { interaction: true, findMode: false, progressBar: false, statusMessages: false, encodeUrl: false, jsBridge },
  } as LayoutObject);
  const body = design.parts.find((p) => p.kind === 'body')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: {
    objects: [...design.objects, viewer(950, body.top + 120, true), viewer(951, body.top + 300, false), {
      id: 952, kind: 'button', type: 0, text: 'Js', anchors: { left: true, top: true, right: false, bottom: false }, style: {},
      bounds: { top: body.top + 480, left: 20, bottom: body.top + 504, right: 120 },
      action: { stepId: 1, step: 'Perform Script', scriptId: store.schema.scripts.find((x) => x.name === 'Js')!.id, script: 'Js' },
    } as LayoutObject, {
      id: 954, kind: 'button', type: 0, text: 'Js Popover', anchors: { left: true, top: true, right: false, bottom: false }, style: {},
      bounds: { top: body.top + 510, left: 20, bottom: body.top + 534, right: 140 },
      action: { stepId: 1, step: 'Perform Script', scriptId: store.schema.scripts.find((x) => x.name === 'Js Popover')!.id, script: 'Js Popover' },
    } as LayoutObject, {
      id: 961, kind: 'popover-button', type: 0, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
      bounds: { top: body.top + 10, left: 560, bottom: body.top + 34, right: 640 }, text: 'More', target: 960,
    } as LayoutObject, {
      id: 960, kind: 'popover', type: 0, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
      bounds: { top: body.top + 40, left: 560, bottom: body.top + 240, right: 760 }, titleBar: true, text: 'Viewer',
      children: [viewer(953, body.top + 60, true)],
    } as unknown as LayoutObject],
    parts: design.parts.map((p) => p.kind === 'body' ? { ...p, height: Math.max(p.height, 520) } : p.kind === 'footer' ? { ...p, top: body.top + Math.max(body.height, 520) } : p),
  } }] as DesignOp[]);
  store.create('Notes', { Title: 'Alpha' });
  store.create('Notes', { Title: 'Beta' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('a page reads records and runs scripts through the window; one without the option cannot', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Pages', 'Ann', 'ann-secret-1');
  await until(() => field(page, TITLE).inputValue(), (v) => v === 'Alpha');
  const bridged = page.frameLocator('.fm[data-id="950"] iframe.fm-webviewer');
  const plain = page.frameLocator('.fm[data-id="951"] iframe.fm-webviewer');
  await until(() => bridged.locator('#out').textContent(), (t) => t === '2 notes: Alpha, Beta');
  await until(() => bridged.locator('#ctx').textContent(), (t) => t === 'Notes #1');
  assert.equal(await bridged.locator('#api').textContent(), 'object object');
  assert.equal(await plain.locator('#api').textContent(), 'undefined undefined');

  await bridged.locator('#go').click();
  await until(() => field(page, TITLE).inputValue(), (v) => v === 'from page');
  // The page was kept through the redraw, and told of it.
  await until(() => bridged.locator('#ctx').textContent(), (t) => t === 'Notes #1 from page');
  assert.deepEqual(page.errors, []);
});

test('Perform JavaScript does not wait for a function that waits for a script, and runs the script after', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Pages', 'Ann', 'ann-secret-1');
  await until(() => field(page, TITLE).inputValue(), (v) => v === 'from page');
  const started = Date.now();
  await page.locator('.fm[data-id="952"]').evaluate((el) => (el.querySelector('button') ?? el as HTMLElement).click());
  await until(() => field(page, TITLE).inputValue(), (v) => v === 'viaJS');
  assert.ok(Date.now() - started < 4000, 'the script did not wait out the bridge timeout');
  assert.deepEqual(page.errors, []);
});

test('Perform JavaScript after Go to Object reaches a web viewer in a closed popover', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Pages', 'Ann', 'ann-secret-1');
  await until(() => field(page, TITLE).inputValue(), (v) => v !== '');
  await page.locator('.fm[data-id="954"]').evaluate((el) => (el.querySelector('button') ?? el as HTMLElement).click());
  await until(() => field(page, TITLE).inputValue(), (v) => v === 'viaPopover');
  assert.deepEqual(page.errors, []);
});
