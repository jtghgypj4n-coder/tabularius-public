import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, findChromium, host, launch, signIn, until, window, type Hosted } from './harness.ts';

let browser: Browser;
before(async () => {
  assert.ok(findChromium(), 'Chromium must execute these acceptance tests');
  browser = await launch();
});
after(async () => { await browser?.close(); });

type Mode = 'window' | 'plain' | 'tabs' | 'nested-tabs' | 'nested-popovers';
type FixturePage = Page & { errors: string[] };
async function fixture(text: string, mode: Mode, check: (page: FixturePage, hosted: Hosted) => Promise<void>) {
  const hosted = await host({ stores: ['A'] });
  let page: FixturePage | undefined;
  try {
    const store = hosted.store('A');
    store.applyDesign([
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] },
      { op: 'createScript', name: 'Run', text },
      { op: 'createScript', name: 'Prepare B', text: 'New Window [ "B" ]' },
      { op: 'createScript', name: 'Select A', text: 'Select Window [ Name: "A" ]' },
      { op: 'createScript', name: 'Open Card', text: 'Set Zoom Level [ 100% ]\nNew Window [ Style: Card ; "Card" ; 300 ; 400 ]' },
    ] as DesignOp[]);
    const design = store.design('Notes')!;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const at = (top: number, left: number, width: number, height: number) => ({ top, left, right: left + width, bottom: top + height });
    const obj = (id: number, kind: LayoutObject['kind'], bounds: LayoutObject['bounds'], extra: Partial<LayoutObject> = {}): LayoutObject =>
      ({ id, kind, type: 0, anchors, style: {}, bounds, ...extra } as LayoutObject);
    const button = (id: number, left: number, script: string) => obj(id, 'button', at(400, left, 120, 24), {
      text: script, action: { stepId: 1, step: 'Perform Script', scriptId: store.schema.scripts.find((s) => s.name === script)!.id, script },
    });
    const outside = { ...design.objects.find((o) => o.kind === 'field')!, id: 970, name: 'outside', bounds: at(10, 20, 200, 24) };
    // probe tells its parent it ran (see observeProbe); it is synchronous and changes no application state.
    const viewer = obj(953, 'web-viewer', at(160, 80, 260, 100), {
      name: 'viewer', type: 13, external: 'WEBV', webUrl: JSON.stringify('data:text/html,<script>function probe() { parent.postMessage({ probed: 1 }, \'*\'); return true; }</script>'),
      webOptions: { interaction: true, findMode: false, progressBar: false, statusMessages: false, encodeUrl: false, jsBridge: true },
    });
    const tabs = (id: number, child: LayoutObject) => obj(id, 'tab-control', at(id === 100 ? 80 : 120, 40, 460, 240), {
      type: 11, target: id + 1, children: [
        obj(id + 1, 'tab-panel', at(80, 40, 460, 240), { type: 12, text: `${id} A` }),
        obj(id + 2, 'tab-panel', at(80, 40, 460, 240), { type: 12, text: `${id} B`, children: [child] }),
      ],
    });
    const child = mode === 'tabs' ? tabs(100, viewer) : mode === 'nested-tabs' ? tabs(100, tabs(200, viewer)) : viewer;
    const popover = obj(960, 'popover', at(60, 20, 540, 300), { type: 15, text: 'Outer', titleBar: true,
      children: mode === 'nested-popovers' ? [
        { ...outside, id: 971, name: 'outerField', bounds: at(310, 40, 120, 24) },
        obj(962, 'popover-button', at(90, 40, 100, 24), { type: 14, text: 'Inner', target: 963 }),
        obj(963, 'popover', at(130, 60, 350, 160), { type: 15, text: 'Inner viewer', titleBar: true, children: [viewer] }),
      ] : [child] });
    store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: { view: 'form', width: 600,
      parts: [{ kind: 'body', kindId: 4, top: 0, height: 450, style: {} }], objects: [
        outside, button(980, 20, 'Run'), button(981, 160, 'Prepare B'), button(982, 300, 'Open Card'), button(983, 440, 'Select A'),
        ...(mode === 'window' ? [] : [obj(961, 'popover-button', at(40, 20, 100, 20), { type: 14, text: 'Outer', target: 960 }), popover]),
      ],
    } }] as DesignOp[]);
    store.create('Notes', { Title: 'record one' });
    store.create('Notes', { Title: 'record two' });
    store.setPassword('Admin', 'pw');
    page = await window(browser);
    await signIn(page, hosted.url, 'A', 'Admin', 'pw');
    await until(() => field(page!, 970).inputValue(), (v) => v === 'record one');
    await check(page, hosted);
    assert.deepEqual(page.errors, []);
  } finally {
    await page?.close();
    await hosted.close();
  }
}

async function start(page: Page, name = 'Run') {
  const response = page.waitForResponse((r) => r.url().includes('/button') && r.request().method() === 'POST');
  // No outside pointer press: an already-open popover must survive until the script itself changes it.
  await page.locator(`.window-frame:not(.window-backdrop .window-frame) .fm[data-id="${name === 'Run' ? 980 : name === 'Prepare B' ? 981 : name === 'Open Card' ? 982 : 983}"] button`).evaluate((b: HTMLButtonElement) => b.click());
  return (await response).json();
}
async function finished(page: Page) {
  await until(() => page.locator('.window-frame:not(.window-backdrop .window-frame) .content').getAttribute('aria-busy'), (v) => v !== 'true');
}
const frontField = (page: Page) => field(page.locator('.window-frame:not(.window-backdrop .window-frame)'), 970);

for (const step of ['Pause', 'Sort']) test(`finding 1: Freeze, Next, ${step} displays record two while waiting`, async () => {
  await fixture(`Freeze Window\nGo to Record/Request/Page [ Next ]\n${step === 'Pause' ? 'Pause/Resume Script [ Indefinitely ]' : 'Sort Records [ With dialog: On ]'}`, 'window', async (page) => {
    await start(page);
    if (step === 'Pause') await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
    else await page.locator('dialog[open]').waitFor();
    // Assert the form underneath while paused / while the sort dialog is open.
    assert.equal(await frontField(page).inputValue(), 'record two');
    if (step === 'Pause') await page.getByRole('button', { name: 'Continue', exact: true }).click();
    else await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await finished(page);
  });
});

test('finding 2: the single error-105 dialog displays B record two and leaves A frozen', async () => {
  await fixture('Set Error Capture [ Off ]\nFreeze Window\nSelect Window [ Name: "B" ]\nGo to Record/Request/Page [ Next ]\nGo to Layout [ Layout Name: "Nowhere" ]', 'window', async (page) => {
    await start(page, 'Prepare B');
    await finished(page);
    await start(page, 'Select A');
    await finished(page);
    assert.equal(await frontField(page).inputValue(), 'record one');
    const responses: unknown[] = [];
    page.on('response', async (r) => {
      if (r.url().includes('/runs/') && r.request().method() === 'POST') responses.push(await r.json());
    });
    const waiting = page.waitForResponse(async (r) =>
      /\/(button|runs\/)/.test(r.url()) && r.request().method() === 'POST' && (await r.json()).waiting?.step === 'Dialog');
    await start(page);
    const r = await (await waiting).json();
    assert.equal(r.waiting.step, 'Dialog');
    assert.equal(r.window.name, 'B');
    const dialog = page.locator('dialog[open].custom-dialog');
    await dialog.waitFor();
    assert.equal(await dialog.count(), 1);
    assert.match(await dialog.textContent() ?? '', /error 105/);
    assert.equal(await frontField(page).inputValue(), 'record two');
    assert.equal(await field(page.locator('.window-backdrop'), 970).inputValue(), 'record one', 'A retains its frozen DOM');
    assert.equal(await page.locator('.window-backdrop').count(), 1);
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await finished(page);
    assert.equal(await dialog.count(), 0);
    assert.equal(responses.filter((v: any) => v.waiting?.step === 'Dialog').length, 1, 'the error is delivered only once');
  });
});

for (const freeze of [true, false]) test(`finding 3: already-open 400x300 card fits its 600x450 layout${freeze ? ' after Freeze / Adjust / Refresh' : ' after Adjust alone'}`, async () => {
  await fixture(freeze ? 'Freeze Window\nAdjust Window [ Resize to Fit ]\nRefresh Window' : 'Adjust Window [ Resize to Fit ]', 'window', async (page) => {
    await start(page, 'Open Card');
    await finished(page);
    const size = () => page.locator('.window-frame.window-card').evaluate((el: HTMLElement) => [el.style.width, el.style.height]);
    assert.deepEqual(await size(), ['400px', '300px']);
    await start(page);
    await finished(page);
    assert.deepEqual(await size(), ['600px', '450px']);
  });
});

const goViewer = 'Go to Object [ Object Name: "viewer" ]\nPerform JavaScript in Web Viewer [ Object Name: "viewer" ; Function Name: "probe" ]';
interface Invocation {
  frames: number;
  visible: boolean;
  popovers: number;
  expanded: (string | null)[];
  panels: { id: number; hidden: boolean | null; pressed: string | null }[];
}
/**
 * Watches the viewer's probe() run. The probe tells its parent it ran (a message, sent before it returns), and the
 * page, on receiving that, records what it shows: the viewer, popovers, tabs. The script is waiting for the viewer's
 * answer, which comes only after the probe returns, so the page is as the call found it. (An earlier version paused the
 * viewer's own process with the DevTools protocol; the viewer lives in a process of its own, and on a Mac the pause
 * of a viewer made during the script never arrived.)
 */
async function observeProbe(page: Page, check: (call: Invocation) => void, visible = true) {
  await page.evaluate(`(() => {
    const seen = window.__probes = [];
    addEventListener('message', (e) => {
      if (!e.data || e.data.probed !== 1) return;
      const viewer = document.querySelector('.fm[data-id="953"] iframe');
      seen.push({
        frames: document.querySelectorAll('.fm[data-id="953"] iframe').length,
        visible: !!viewer && viewer.getClientRects().length > 0 && !viewer.closest('[hidden]'),
        popovers: document.querySelectorAll('.fm-popover-open').length,
        expanded: [961, 962].map(id => document.querySelector('[data-id="' + id + '"] button')?.getAttribute('aria-expanded') ?? null),
        panels: [101, 102, 201, 202].map(id => {
          const panel = document.querySelector('[data-panel="' + id + '"]');
          const control = panel?.parentElement;
          const index = id % 100 - 1;
          const tab = control?.querySelectorAll(':scope > .fm-tabs > button')[index];
          return { id, hidden: panel ? panel.hidden : null, pressed: tab?.getAttribute('aria-selected') ?? tab?.getAttribute('aria-pressed') ?? null };
        }),
      });
    }, true);
  })()`);
  const calls: Invocation[] = [];
  const errors: unknown[] = [];
  return {
    calls,
    errors,
    /** Takes what the page recorded since the last time, and checks each. */
    settle: async () => {
      const recorded = await page.evaluate(() => (window as unknown as { __probes: unknown[] }).__probes.splice(0)) as Invocation[];
      for (const call of recorded) {
        calls.push(call);
        try {
          assert.equal(call.frames, 1);
          assert.equal(call.visible, visible, 'viewer visibility inside probe');
          check(call);
        } catch (error) { errors.push(error); }
      }
    },
    close: async () => {},
  };
}
async function invoke(page: Page, check: (call: Invocation) => void) {
  const observation = await observeProbe(page, check);
  try {
    await start(page);
    await finished(page);
    await observation.settle();
    assert.deepEqual(observation.errors, []);
    assert.equal(observation.calls.length, 1, 'probe must actually be invoked once');
  } finally { await observation.close(); }
}
const expanded = (page: Page) => page.locator('[data-id="961"] button').getAttribute('aria-expanded');

test('finding 4: Go to Object outside after JavaScript focuses field 970 and closes popover 960', async () => {
  await fixture(goViewer + '\nGo to Object [ Object Name: "outside" ]', 'plain', async (page) => {
    assert.equal(await page.locator('.fm-popover-open').count(), 0);
    await invoke(page, (call) => { assert.equal(call.popovers, 1); assert.equal(call.expanded[0], 'true'); });
    assert.equal(await field(page, 970).evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator('.fm-popover-open').count(), 0);
    assert.equal(await expanded(page), 'false');
  });
});

for (const mode of ['tabs', 'nested-tabs'] as const) test(`finding 5: already-open popover switches ${mode === 'tabs' ? 'A to B' : 'every nested tab ancestor'} inside JavaScript invocation`, async () => {
  await fixture(goViewer, mode, async (page) => {
    await page.locator('[data-id="961"] button').click();
    assert.equal(await expanded(page), 'true');
    assert.equal(await page.locator('[data-panel="101"]').evaluate((p: HTMLElement) => p.hidden), false);
    assert.equal(await page.locator('[data-panel="102"]').evaluate((p: HTMLElement) => p.hidden), true);
    if (mode === 'nested-tabs') {
      assert.equal(await page.locator('[data-panel="201"]').evaluate((p: HTMLElement) => p.hidden), false);
      assert.equal(await page.locator('[data-panel="202"]').evaluate((p: HTMLElement) => p.hidden), true);
    }
    await invoke(page, (call) => {
      const expected = [{ id: 101, hidden: true, pressed: 'false' }, { id: 102, hidden: false, pressed: 'true' }];
      if (mode === 'nested-tabs') expected.push({ id: 201, hidden: true, pressed: 'false' }, { id: 202, hidden: false, pressed: 'true' });
      assert.deepEqual(call.panels.filter((p) => p.hidden !== null), expected);
      assert.equal(call.popovers, 1);
    });
  });
});

test('finding 6: Close Popover after viewer JavaScript clears pending focus and leaves opener collapsed', async () => {
  await fixture(goViewer + '\nClose Popover', 'plain', async (page) => {
    assert.equal(await page.locator('.fm-popover-open').count(), 0);
    await invoke(page, (call) => assert.equal(call.popovers, 1));
    assert.equal(await page.locator('.fm-popover-open').count(), 0);
    assert.equal(await expanded(page), 'false');
  });
});

test('finding 7: both closed popover ancestors open and viewer iframe exists when JavaScript runs', async () => {
  await fixture(goViewer, 'nested-popovers', async (page) => {
    assert.equal(await page.locator('.fm-popover-open').count(), 0);
    assert.equal(await expanded(page), 'false');
    await invoke(page, (call) => { assert.equal(call.popovers, 2); assert.deepEqual(call.expanded, ['true', 'true']); });
  });
});

for (const refresh of [false, true]) test(`round 3 finding 1: frozen Go to Object outside preserves the popover until ${refresh ? 'Refresh Window' : 'completion'}`, async () => {
  await fixture('Freeze Window\nGo to Object [ Object Name: "outside" ]\nShow Custom Dialog [ "Frozen" ; "Inspect" ; Button 1: "OK" ]' +
    (refresh ? '\nRefresh Window\nShow Custom Dialog [ "Thawed" ; "Inspect" ; Button 1: "OK" ]' : ''), 'plain', async (page) => {
    await page.locator('[data-id="961"] button').click();
    await start(page);
    const dialog = page.locator('dialog[open].custom-dialog');
    await dialog.waitFor();
    assert.match(await dialog.textContent() ?? '', /Frozen/);
    assert.equal(await page.locator('.fm-popover-open').count(), 1);
    assert.equal(await expanded(page), 'true');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    if (refresh) {
      await until(() => dialog.textContent(), (text) => !!text?.includes('Thawed'));
      assert.equal(await page.locator('.fm-popover-open').count(), 0);
      assert.equal(await expanded(page), 'false');
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    }
    await finished(page);
    assert.equal(await page.locator('.fm-popover-open').count(), 0);
    assert.equal(await expanded(page), 'false');
    assert.equal(await field(page, 970).evaluate((el) => el === document.activeElement), true);
  });
});

for (const mode of ['tabs', 'nested-tabs'] as const) test(`round 3 finding 1: frozen ${mode} retain their DOM through JavaScript and a dialog, then apply pending navigation`, async () => {
  await fixture('Freeze Window\n' + goViewer + '\nRefresh Object [ Object Name: "outside" ]\nShow Custom Dialog [ "Frozen" ; "Inspect" ; Button 1: "OK" ]', mode, async (page) => {
    await page.locator('[data-id="961"] button').click();
    const expected = [{ id: 101, hidden: false, pressed: 'true' }, { id: 102, hidden: true, pressed: 'false' }];
    if (mode === 'nested-tabs') expected.push({ id: 201, hidden: false, pressed: 'true' }, { id: 202, hidden: true, pressed: 'false' });
    const observation = await observeProbe(page, (call) => {
      assert.equal(call.popovers, 1);
      assert.deepEqual(call.panels.filter((p) => p.hidden !== null), expected);
    }, false);
    try {
      await start(page);
      const dialog = page.locator('dialog[open].custom-dialog');
      await dialog.waitFor();
      await observation.settle();
      assert.deepEqual(observation.errors, []);
      assert.equal(observation.calls.length, 1, 'JavaScript runs while the display stays frozen');
      for (const panel of expected) {
        assert.equal(await page.locator(`[data-panel="${panel.id}"]`).evaluate((p: HTMLElement) => p.hidden), panel.hidden);
      }
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
      await finished(page);
      for (const panel of expected) {
        const el = page.locator(`[data-panel="${panel.id}"]`);
        assert.equal(await el.evaluate((p: HTMLElement) => p.hidden), !panel.hidden);
        assert.equal(await el.evaluate((p: HTMLElement) => p.parentElement!.querySelectorAll(':scope > .fm-tabs > button')[Number(p.dataset.panel) % 100 - 1].getAttribute('aria-selected')), panel.pressed === 'true' ? 'false' : 'true');
      }
      assert.equal(await page.locator('.fm[data-id="953"] iframe').isVisible(), true);
    } finally { await observation.close(); }
  });
});

for (const found of ['query', 'ids']) test(`round 3 finding 2: a deleted background layout with ${found} cannot block a card script or Cancel`, async () => {
  await fixture('Exit Script [ Text Result: "started" ]', 'window', async (page, hosted) => {
    const store = hosted.store('A');
    const notes = store.design('Notes')!;
    store.applyDesign([
      { op: 'createLayout', name: 'Card Notes', occurrence: 'Notes', design: notes },
      { op: 'updateScript', script: 'Open Card', text: 'New Window [ Style: Card ; "Card" ; 300 ; 400 ]\nGo to Layout [ Layout Name: "Card Notes" ]' },
    ]);
    if (found === 'ids') { await start(page); await finished(page); }
    await start(page, 'Open Card');
    await finished(page);
    assert.equal(await page.locator('.window-card').count(), 1);
    store.applyDesign([{ op: 'deleteLayout', layout: 'Notes' }]);
    const request = page.waitForRequest((r) => r.url().includes('/button') && r.method() === 'POST');
    const started = await start(page);
    const background = (await request).postDataJSON().windows.find((w: { layout: string }) => w.layout === 'Notes');
    assert.ok(background, 'the deleted background layout is included in the request');
    assert.equal(Array.isArray(background[found]), true);
    assert.equal(started.error, 0);
    assert.equal(started.result, 'started');
    await finished(page);
    store.applyDesign([{ op: 'updateScript', script: 'Run', text: 'Close Window [ Current Window ]' }]);
    const cancel = await start(page);
    assert.equal(cancel.error, 0);
    assert.deepEqual(cancel.closed, [started.window.id]);
    await finished(page);
    assert.equal(await page.locator('.window-card').count(), 0);
    assert.equal(await page.locator('.window-backdrop').count(), 0);
  });
});

test('round 3 finding 3: clicking the outer field closes only its child and keeps the field interactive', async () => {
  await fixture(goViewer, 'nested-popovers', async (page) => {
    await page.locator('[data-id="961"] button').click();
    await page.locator('[data-id="962"] button').click();
    assert.equal(await page.locator('.fm-popover-open').count(), 2);
    await field(page, 971).click();
    assert.equal(await page.locator('.fm-popover-open[aria-label="Outer"]').count(), 1);
    assert.equal(await page.locator('.fm-popover-open[aria-label="Inner viewer"]').count(), 0);
    assert.equal(await expanded(page), 'true');
    assert.equal(await page.locator('[data-id="962"] button').getAttribute('aria-expanded'), 'false');
    assert.equal(await field(page, 971).evaluate((el) => el === document.activeElement), true);
    await field(page, 971).fill('edited in outer');
    assert.equal(await field(page, 971).inputValue(), 'edited in outer');
    await field(page, 970).click();
    assert.equal(await page.locator('.fm-popover-open').count(), 0);
    assert.equal(await expanded(page), 'false');
  });
});
