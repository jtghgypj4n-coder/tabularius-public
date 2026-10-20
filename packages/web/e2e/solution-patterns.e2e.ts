// The web client's side of the solution-patterns suite (docs/solution-patterns.md): the layout and window patterns whose
// result is what a person sees in a browser. Each test builds the pattern's small solution (the same builders the script
// and Data API checks use, in packages/server/test/patterns), signs in, and holds what the window shows to the result the
// pattern declares for the web client. Skipped, never failed, where there is no Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp, Store } from '../../store/src/index.ts';
import { PATTERNS } from '../../server/test/patterns/index.ts';
import { PNG, pictureSolution, portalSolution } from '../../server/test/patterns/ui-patterns.ts';
import { Workbench } from '../../server/test/patterns/framework.ts';
import { field, launch, signIn, skipUnless, until, window } from './harness.ts';

const skip = skipUnless();
let browser: Browser;
const anchors = { left: true, top: true, right: false, bottom: false };
const at = (top: number, height: number, left = 20, width = 300) => ({ top, left, bottom: top + height, right: left + width });
const object = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`);

before(async () => {
  if (!skip) browser = await launch();
});
after(async () => {
  await browser?.close();
  // Every pattern that declares a web result has a test here.
  if (!skip) for (const p of PATTERNS.filter((x) => x.web)) assert.ok(checked.has(p.id), `${p.id} has no web check`);
});

const checked = new Set<string>();

/** A pattern's web check: runs `body` on a window signed in to `file` of the workbench's solution, and holds the outcome to the declared result. */
function pattern(id: string, file: string, build: (t: Workbench) => Promise<Store | void> | Store | void, body: (page: Page & { errors: string[] }, t: Workbench) => Promise<void>): void {
  const declared = PATTERNS.find((p) => p.id === id)!;
  test(`${declared.title}: web client comes out ${declared.web!.expected}`, { skip }, async () => {
    checked.add(id);
    const t = new Workbench();
    const page = await window(await browser.newContext({ viewport: { width: 1200, height: 900 } }));
    try {
      await build(t);
      await t.api(file);
      await signIn(page, t.url, file, 'Admin', 'pw');
      await body(page, t);
      assert.deepEqual(page.errors, []);
      // What a body proves is that the pattern works in the window; a pattern declared otherwise needs its own outcome.
      assert.equal('pass', declared.web!.expected, 'this check can only show a pass');
    } finally {
      await page.context().close();
      await t.close();
    }
  });
}

const rowsOf = (page: Page, portal: number) => page.locator(`.fm[data-id="${portal}"] .fm-portal-row`);

pattern('portal-filter-sort', 'Shop', portalSolution, async (page) => {
  await page.getByRole('button', { name: 'View as Form' }).click();
  const items = () => rowsOf(page, 900).evaluateAll((rows) => rows
    .map((r) => (r.querySelector('.fm[data-id="901"] input, .fm[data-id="901"] textarea') as HTMLInputElement | null)?.value ?? '')
    .filter(Boolean));
  assert.deepEqual(await until(items, (v) => v.length > 0), ['Bananas', 'Cherries', 'Plums'], 'Apples (quantity 0) is filtered out and the rest sorted by item');
});

pattern('container-storage', 'Pics', (t) => {
  pictureSolution(t);
}, async (page, t) => {
  // The picture goes in through the Data API, as a script or another client would put it.
  const api = await t.api('Pics');
  const rec = (await api.get('/layouts/Pics/records')).response.data[0];
  const form = new FormData();
  form.append('upload', new Blob([PNG], { type: 'image/png' }), 'up.png');
  assert.equal((await api.call('POST', `/layouts/Pics/records/${rec.recordId}/containers/Photo/1`, form)).code, '0');
  await page.reload();
  await signIn(page, t.url, 'Pics', 'Admin', 'pw');
  await page.getByRole('button', { name: 'View as Form' }).click();
  const img = page.locator('.fm img').first();
  await until(() => img.evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), (ok) => ok);
  assert.match(await img.getAttribute('src') ?? '', /thumb=|containers\//, 'the picture is drawn from a container link');
});

pattern('card-windows', 'Cards', (t) => {
  const s = t.file('Cards');
  s.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Open Card', text: 'New Window [ Style: Card ; "Card" ; 200 ; 300 ; 40 ; 60 ]' },
    { op: 'createScript', name: 'Close Card', text: 'Close Window [ Current Window ]' },
  ] as DesignOp[]);
  const design = s.design('Items')!;
  const scriptId = (name: string) => s.schema.scripts.find((x) => x.name === name)!.id;
  const button = (id: number, left: number, text: string, script: string): LayoutObject => ({
    id, kind: 'button', type: 0, text, anchors, style: {}, bounds: { top: 100, left, bottom: 124, right: left + 90 }, action: { stepId: 1, step: 'Perform Script', scriptId: scriptId(script), script },
  } as LayoutObject);
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 140 } : p);
  s.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { view: 'form', parts, objects: [...design.objects, button(920, 20, 'Open', 'Open Card'), button(921, 120, 'Close', 'Close Card')] } }] as DesignOp[]);
  s.create('Items', { Name: 'one' });
}, async (page) => {
  const frame = page.locator('.window-frame.window-card');
  assert.equal(await frame.count(), 0, 'no card until the script opens one');
  await object(page, 920).click();
  await until(() => frame.evaluate((el: HTMLElement) => [el.style.height, el.style.width, el.style.top, el.style.left].join(' ')), (v) => v === '200px 300px 40px 60px');
  await page.locator('.window-frame.window-card .fm[data-id="921"]').click();
  await until(() => frame.count(), (n) => n === 0);
});

pattern('custom-menus', 'Menus', (t) => {
  const s = t.file('Menus');
  s.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Say Home', text: 'Set Field [ Items::Name ; "home" ]' },
    { op: 'createCustomMenu', name: 'Tools', items: [{ script: 'Say Home', title: '"Home"' }, { kind: 'separator' }, { command: 'New Record' }] },
    { op: 'createCustomMenu', name: 'File', basedOn: 1 },
    { op: 'createMenuSet', name: 'Kiosk', menus: ['Tools'] },
    { op: 'setDefaultMenuSet', menuSet: 'Kiosk' },
  ] as DesignOp[]);
  s.create('Items', { Name: 'one' });
}, async (page) => {
  const bar = page.locator('.menubar');
  await bar.getByRole('button', { name: 'Tools', exact: true }).click();

  await page.getByRole('menuitem', { name: 'Home' }).first().click();
  await until(() => page.locator('.fm input, .fm textarea').first().inputValue().catch(() => ''), (v) => v === 'home');
});

pattern('script-triggers', 'Triggers', (t) => {
  const s = t.file('Triggers');
  s.applyDesign([
    { op: 'createTable', name: 'Things', fields: [{ name: 'Name' }] },
    { op: 'createTable', name: 'Places', fields: [{ name: 'City' }] },
    { op: 'createScript', name: 'Note', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & ";" ]' },
  ] as DesignOp[]);
  const id = (name: string) => s.schema.scripts.find((x) => x.name === name)!.id;
  const note = (event: string, parameter: string) => ({ event, scriptId: id('Note'), script: 'Note', parameter: `"${parameter}"` });
  s.create('Things', { Name: 'a' });
  s.create('Places', { City: 'Leeds' });
  const design = s.design('Places')!;
  s.applyDesign([{ op: 'updateLayout', layout: 'Places', design: {
    triggers: [note('OnLayoutEnter', 'enter'), note('OnRecordLoad', 'load')],
    objects: [...design.objects, { id: 800, kind: 'text', type: 2, anchors, style: {}, bounds: at(200, 20, 20, 500), text: 'Log: <<$$log>>' } as LayoutObject],
  } }] as DesignOp[]);
}, async (page) => {
  await page.locator('select.layout-menu').selectOption('Places');
  await until(() => object(page, 800).textContent(), (v) => (v ?? '').includes('enter;load;'));
});

// --- patterns that are about what a layout does on screen ---

/** Items with a quantity that turns red, a tooltip, a note hidden for small quantities, tab controls (one nested in the other) and a popover. */
function gallery(t: Workbench): Store {
  const s = t.file('Gallery');
  s.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Qty', type: 'number' }, { name: 'Note' }, { name: 'Secret' }, { name: 'Deep' }] }] as DesignOp[]);
  const design = s.design('Items')!;
  const occ = s.schema.tableOccurrences.find((o) => o.name === 'Items')!;
  const fieldId = (name: string) => s.schema.tables.find((x) => x.name === 'Items')!.fields.find((f) => f.name === name)!.id;
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const box = (id: number, name: string, top: number, extra: Partial<LayoutObject> = {}): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: at(top, 22),
    field: { tableOccurrenceId: occ.id, fieldId: fieldId(name), tableOccurrence: 'Items', field: name, display: 'edit', repetitions: 1 }, ...extra,
  } as LayoutObject);
  const panel = (id: number, bounds: LayoutObject['bounds'], label: string, children: LayoutObject[]): LayoutObject =>
    ({ id, kind: 'tab-panel', type: 12, anchors, style: {}, bounds, text: label, children } as LayoutObject);
  const outer = at(130, 140);
  const inner = at(160, 90, 30, 280);
  const objects: LayoutObject[] = [
    box(1, 'Id', 10),
    box(2, 'Name', 40, { tooltip: '"Called " & Self' }),
    box(3, 'Qty', 70, { conditions: [{ formula: 'Self > 10', rules: [{ part: 1, state: 1, css: { 'background-color': 'rgb(255, 0, 0)' } }] }] }),
    { id: 4, kind: 'text', type: 2, anchors, style: {}, bounds: at(100, 20), text: 'Big order', hide: { formula: 'Items::Qty <= 10', inFind: false } } as LayoutObject,
    { id: 10, kind: 'tab-control', type: 11, anchors, style: {}, bounds: outer, target: 11, children: [
      panel(11, outer, 'Main', [box(13, 'Note', 165)]),
      panel(12, outer, 'More', [
        { id: 20, kind: 'tab-control', type: 11, anchors, style: {}, bounds: inner, target: 21, children: [
          panel(21, inner, 'First', [box(23, 'Deep', 195)]),
          panel(22, inner, 'Second', [{ id: 24, kind: 'text', type: 2, anchors, style: {}, bounds: at(195, 20, 40, 200), text: 'Second inner tab' } as LayoutObject]),
        ] } as LayoutObject,
      ]),
    ] } as LayoutObject,
    { id: 30, kind: 'popover-button', type: 14, anchors, style: {}, bounds: at(290, 24, 20, 110), text: 'Details', target: 31 } as LayoutObject,
    { id: 31, kind: 'popover', type: 15, anchors, style: {}, bounds: at(330, 60), text: 'Secret details', titleBar: true, children: [box(32, 'Secret', 350)] } as LayoutObject,
  ];
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 420 } : p);
  s.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { parts, objects } }] as DesignOp[]);
  s.create('Items', { Id: 1, Name: 'Tea', Qty: 3, Note: 'green', Secret: 'a', Deep: 'deep' });
  s.create('Items', { Id: 2, Name: 'Cake', Qty: 12, Note: 'lemon', Secret: 'b', Deep: 'deeper' });
  return s;
}

const goToRecord = async (page: Page, n: number) => {
  const box = page.getByRole('textbox', { name: 'Record number' });
  await until(async () => {
    if (await box.inputValue() !== String(n)) { await box.fill(String(n)); await box.press('Enter'); }
    return field(page, 1).inputValue();
  }, (v) => v === String(n));
};

pattern('conditional-formatting-tooltips', 'Gallery', gallery, async (page) => {
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => object(page, 3).count(), (n) => n === 1);
  const fill = () => object(page, 3).evaluate((e) => getComputedStyle(e).backgroundColor);
  const own = await fill();
  assert.notEqual(own, 'rgb(255, 0, 0)');
  assert.equal(await object(page, 4).count(), 0, 'an object hidden by its formula is not drawn');
  await until(() => object(page, 2).getAttribute('title'), (t) => t === 'Called Tea');
  await goToRecord(page, 2);
  await until(fill, (c) => c === 'rgb(255, 0, 0)');
  await until(() => object(page, 4).count(), (n) => n === 1);
  await until(() => object(page, 2).getAttribute('title'), (t) => t === 'Called Cake');
});

pattern('tabs-popovers', 'Gallery', gallery, async (page) => {
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, 13).isVisible(), (v) => v);
  const outer = object(page, 10);
  await outer.locator(':scope > .fm-tabs .fm-tab, :scope .fm-tab', { hasText: 'More' }).first().click();
  await until(() => field(page, 23).isVisible(), (v) => v);
  assert.equal(await field(page, 13).isVisible(), false, 'the first outer panel is behind');
  await object(page, 20).locator('.fm-tab', { hasText: 'Second' }).click();
  await until(() => object(page, 24).isVisible(), (v) => v);
  assert.equal(await field(page, 23).isVisible(), false, 'the inner control switches on its own');
  // A popover from its button.
  const popover = page.getByRole('dialog', { name: 'Secret details' });
  await object(page, 30).getByRole('button').click();
  await popover.waitFor();
  assert.equal(await field(popover, 32).inputValue(), 'a');
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'detached' });
});
