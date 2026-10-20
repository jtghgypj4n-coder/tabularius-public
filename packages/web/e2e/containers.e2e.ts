// Container fields and object script triggers in a real browser, on a small
// database built here with no .fmp12: a picture and a file put in a container
// through its menu, downloaded and cleared again; a field's OnObjectEnter,
// OnObjectModify and OnObjectExit; and a tab control's OnPanelSwitch keeping a
// panel shut.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Browser, Page, Route } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// Layout object ids, as laid out below.
const ID = 1;
const NAME = 2;
const PHOTO = 3;
const LOG = 4;
const TABS = 10;
const OPEN_TAB = 11;
const LOCKED_TAB = 12;
const BEHIND = 13;

// A 2×2 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Desk'] });
  const store = hosted.store('Desk');
  store.applyDesign([
    { op: 'createTable', name: 'Things', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Photo', type: 'container' }] },
    { op: 'createScript', name: 'Note', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & " " ]' },
    { op: 'createScript', name: 'Guard', text: [
      // Get ( TriggerTargetPanel ) is "panel number;object name".
      'Set Variable [ $target ; Value: Let ( p = Get ( TriggerTargetPanel ) ; Middle ( p ; Position ( p ; ";" ; 1 ; 1 ) + 1 ; 100 ) ) ]',
      'Set Variable [ $$log ; Value: $$log & "switch:" & $target & " " ]',
      'If [ $target = "Locked" ]',
      'Exit Script [ Text Result: False ]',
      'End If',
    ].join('\n') },
  ] as DesignOp[]);

  const design = store.design('Things')!;
  const occ = store.schema.tableOccurrences.find((t) => t.name === 'Things')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Things')!.fields.find((f) => f.name === name)!.id;
  const scriptId = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const at = (top: number, height: number, left = 20, width = 300) => ({ top, left, bottom: top + height, right: left + width });
  const box = (id: number, name: string, top: number, height = 22, extra: Partial<LayoutObject> = {}): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: at(top, height),
    field: { tableOccurrenceId: occ.id, fieldId: fieldId(name), tableOccurrence: 'Things', field: name, display: 'edit', repetitions: 1 },
    ...extra,
  } as LayoutObject);
  const note = (event: string) => ({ event, scriptId: scriptId('Note'), script: 'Note', parameter: `"${event.slice(8).toLowerCase()}"` });
  const tabs = at(240, 80);
  const panel = (id: number, name: string, children: LayoutObject[] = []): LayoutObject =>
    ({ id, kind: 'tab-panel', type: 12, name, anchors, style: {}, bounds: tabs, text: name, children } as LayoutObject);
  const objects: LayoutObject[] = [
    box(ID, 'Id', 10),
    box(NAME, 'Name', 40, 22, { triggers: [note('OnObjectEnter'), note('OnObjectModify'), note('OnObjectExit')] }),
    box(PHOTO, 'Photo', 70, 120),
    { id: LOG, kind: 'text', type: 2, anchors, style: {}, bounds: at(200, 20, 20, 500), text: 'Log: <<$$log>>' } as LayoutObject,
    { id: TABS, kind: 'tab-control', type: 11, anchors, style: {}, bounds: tabs, triggers: [{ event: 'OnPanelSwitch', scriptId: scriptId('Guard'), script: 'Guard' }], children: [
      panel(OPEN_TAB, 'Open'),
      panel(LOCKED_TAB, 'Locked', [{ id: BEHIND, kind: 'text', type: 2, anchors, style: {}, bounds: at(280, 20), text: 'Behind the lock' } as LayoutObject]),
    ] } as LayoutObject,
  ];
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 340 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Things', design: { parts, objects } }] as DesignOp[]);

  store.create('Things', { Id: 1, Name: 'Kettle' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext({ acceptDownloads: true }));
  await signIn(page, hosted.url, 'Desk', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${ID}"]`).count(), (n) => n === 1);
  await until(() => field(page, ID).inputValue(), (v) => v === '1');
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

const object = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`);
/** The record's Photo field as the Data API reads it (a URL to its file, or ''). */
const photo = () => String(hosted.store('Desk').find('Things', { query: [{ Id: '==1' }] }).records[0].fieldData.Photo ?? '');

/** Opens the container's menu and picks `item`, answering the file picker with `file` when it asks. */
async function menu(page: Page, item: string, file?: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await object(page, PHOTO).getByRole('button').click();
  const choice = page.getByRole('menuitem', { name: item });
  if (!file) return choice.click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), choice.click()]);
  await chooser.setFiles(file);
}

test('a container takes a picture from its menu, shows it, downloads it and clears it', { skip }, async () => {
  const page = await open();
  try {
    const container = object(page, PHOTO).getByRole('button');
    assert.equal(await container.getAttribute('aria-label'), 'Photo: empty');
    await menu(page, 'Insert Picture…', { name: 'red.png', mimeType: 'image/png', buffer: PNG });
    await until(async () => photo(), (p) => p !== '');
    await until(() => container.getAttribute('aria-label'), (l) => l === 'Photo: red.png');
    await until(() => container.locator('img').evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), (ok) => ok);

    // Download gives back the file as it was put in.
    await object(page, PHOTO).getByRole('button').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download' }).click()]);
    assert.equal(download.suggestedFilename(), 'red.png');
    assert.deepEqual(readFileSync(await download.path()), PNG);

    // A file that isn't a picture shows as its name.
    await menu(page, 'Replace with File…', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await until(() => container.getAttribute('aria-label'), (l) => l === 'Photo: notes.txt');
    assert.equal(await container.locator('.fm-file-name').textContent(), 'notes.txt');

    await menu(page, 'Clear');
    await until(() => container.getAttribute('aria-label'), (l) => l === 'Photo: empty');
    await until(async () => photo(), (p) => p === '');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a file of 10 MB goes up in pieces with a progress bar, and can be cancelled', { skip }, async () => {
  const page = await open();
  try {
    const container = object(page, PHOTO).getByRole('button');
    const big = Buffer.alloc(10 * 1024 * 1024, 7);
    const toasts = page.locator('.toast');
    // Slow each piece down so the bar is there to be seen, and the Cancel in time.
    let pieces = 0;
    const slowly = /container-uploads\/[^/]+\?offset=/;
    const handler = async (route: Route) => {
      pieces++;
      await new Promise((r) => setTimeout(r, 400));
      await route.continue().catch(() => {});
    };
    await page.route(slowly, handler);
    await menu(page, 'File…', { name: 'big.bin', mimeType: 'application/octet-stream', buffer: big });
    await toasts.filter({ hasText: 'Uploading big.bin' }).waitFor();
    await toasts.getByRole('button', { name: 'Cancel' }).click();
    await toasts.filter({ hasText: 'Cancelled the upload of big.bin' }).waitFor();
    assert.equal(await toasts.filter({ hasText: 'Uploading big.bin' }).count(), 0, 'the bar is gone');
    assert.equal(await container.getAttribute('aria-label'), 'Photo: empty');
    assert.equal(photo(), '');
    assert.ok(pieces < 5, 'it stopped before the last piece');

    await page.unroute(slowly, handler);
    await menu(page, 'File…', { name: 'big.bin', mimeType: 'application/octet-stream', buffer: big });
    await toasts.filter({ hasText: 'Uploaded big.bin' }).waitFor();
    await until(() => container.getAttribute('aria-label'), (l) => l === 'Photo: big.bin');
    const store = hosted.store('Desk');
    const id = store.containerId('Things', Number(store.find('Things', { query: [{ Id: '==1' }] }).records[0].recordId), 'Photo')!;
    assert.equal(store.containerInfo(id)!.size, big.length);
    await object(page, PHOTO).getByRole('button').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download' }).click()]);
    assert.deepEqual(readFileSync(await download.path()), big);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a connection that drops in the middle of a big file is waited out and the upload goes on from where it stopped', { skip }, async () => {
  const page = await open();
  try {
    const container = object(page, PHOTO).getByRole('button');
    const big = Buffer.alloc(9 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 12)) & 0xff;
    const offsets: string[] = [];
    let dropped = false;
    await page.route(/container-uploads\/[^/]+\?offset=/, async (route) => {
      const offset = new URL(route.request().url()).searchParams.get('offset')!;
      offsets.push(offset);
      if (offset === String(4 * 1024 * 1024) && !dropped) {
        dropped = true;
        return route.abort('connectionreset');
      }
      await route.continue().catch(() => {});
    });
    await menu(page, 'File…', { name: 'film.bin', mimeType: 'application/octet-stream', buffer: big });
    await page.locator('.toast').filter({ hasText: 'Uploaded film.bin' }).waitFor();
    await until(() => container.getAttribute('aria-label'), (l) => l === 'Photo: film.bin');
    assert.ok(dropped, 'a piece was dropped');
    assert.deepEqual(offsets.slice(0, 4), ['0', String(2 * 1024 * 1024), String(4 * 1024 * 1024), String(4 * 1024 * 1024)], 'the dropped piece is sent again from where the server says it stands');
    const store = hosted.store('Desk');
    const id = store.containerId('Things', Number(store.find('Things', { query: [{ Id: '==1' }] }).records[0].recordId), 'Photo')!;
    assert.equal(store.containerInfo(id)!.size, big.length);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a field\'s OnObjectEnter, OnObjectModify and OnObjectExit run as the field is entered, typed in and left', { skip }, async () => {
  const page = await open();
  try {
    const log = () => object(page, LOG).textContent();
    await field(page, NAME).click();
    await until(log, (t) => t === 'Log: enter ');
    // The cursor stays in the field after its OnObjectEnter script.
    assert.equal(await page.evaluate(() => document.activeElement?.closest<HTMLElement>('.fm[data-id]')?.dataset.id), String(NAME));
    await page.keyboard.press('End');
    await page.keyboard.type('s');
    await field(page, NAME).press('Tab');
    // OnObjectModify runs as the changed value is saved, before OnObjectExit.
    await until(log, (t) => t === 'Log: enter modify exit ');
    await until(async () => hosted.store('Desk').find('Things', { query: [{ Id: '==1' }] }).records[0].fieldData.Name, (n) => n === 'Kettles');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('OnPanelSwitch runs before a tab comes to the front, and a False result keeps it behind', { skip }, async () => {
  const page = await open();
  try {
    const tab = (name: string) => object(page, TABS).locator('.fm-tab', { hasText: name });
    await tab('Locked').click();
    await until(() => object(page, LOG).textContent(), (t) => (t ?? '').includes('switch:Locked'));
    assert.equal(await object(page, BEHIND).isVisible(), false);
    assert.equal(await tab('Open').getAttribute('aria-selected'), 'true');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
