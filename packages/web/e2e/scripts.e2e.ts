// Scripts that stop to ask the person at the browser, in a real browser: a
// button runs a script, the script waits on the server, the web client draws
// the dialog the step asks for (View Index, Show Custom Dialog, Sort Records),
// and what the person picks there reaches the file. The database is built here
// with no .fmp12, like shop.e2e.ts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';

// Layout object ids of the buttons added below; the fields' ids are looked up by name.
const PICK = 910;
const ASK = 911;
const SORT = 912;
const WAIT = 913;
const PASTE = 914;
let ID = 0;
let TAG = 0;
let TITLE = 0;

const step = (stepId: number, name: string, params: Record<string, unknown> = {}) => ({ stepId, name, params });
const tagField = { tableOccurrence: { id: 0, name: 'Notes' }, field: { id: 0, name: 'Tag' } };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Desk'] });
  const store = hosted.store('Desk');
  store.applyDesign([
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Id', type: 'number' }, { name: 'Tag' }, { name: 'Title' }] },
    { op: 'createScript', name: 'Pick Tag', steps: [
      step(11, 'Insert from Index', { selectEntireContents: true, field: tagField }),
      step(75, 'Commit Records/Requests', { noDialog: true }),
    ] },
    { op: 'createScript', name: 'Ask Title', steps: [
      step(141, 'Set Variable', { variable: '$title', value: 'Notes::Title' }),
      step(87, 'Show Custom Dialog', { title: '"Rename"', message: '"New title?"', buttons: ['"OK"', '"Cancel"'], inputs: [{ variable: '$title', label: '"Title"' }] }),
      step(76, 'Set Field', { field: { tableOccurrence: { id: 0, name: 'Notes' }, field: { id: 0, name: 'Title' } }, calculation: 'Get ( LastMessageChoice ) & "/" & $title' }),
      step(75, 'Commit Records/Requests', { noDialog: true }),
    ] },
    { op: 'createScript', name: 'Wait', text: [
      'Allow User Abort [ On ]',
      'Pause/Resume Script [ Duration (seconds): 30 ]',
      'Set Field [ Notes::Title ; "waited" ]',
      'Commit Records/Requests [ With dialog: Off ]',
    ].join('\n') },
    { op: 'createScript', name: 'Paste Title', text: 'Paste [ Select ; Notes::Title ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'createScript', name: 'Sort Notes', steps: [
      step(86, 'Set Error Capture', { on: true }),
      step(39, 'Sort Records', { noDialog: false }),
    ] },
  ] as DesignOp[]);

  // The generated Notes form, with a button for each script along the bottom of the body.
  const design = store.design('Notes')!;
  const idOf = (name: string) => design.objects.find((o) => o.kind === 'field' && o.field?.field === name)!.id;
  ID = idOf('Id');
  TAG = idOf('Tag');
  TITLE = idOf('Title');
  const scriptId = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const button = (id: number, left: number, text: string, script: string): LayoutObject => ({
    id, kind: 'button', type: 0, text, anchors, style: {}, bounds: { top: 200, left, bottom: 224, right: left + 110 },
    action: { stepId: 1, step: 'Perform Script', scriptId: scriptId(script), script },
  } as LayoutObject);
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 240 } : p.kind === 'footer' ? { ...p, top: 300 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: {
    parts, objects: [...design.objects, button(PICK, 20, 'Pick tag', 'Pick Tag'), button(ASK, 140, 'Rename', 'Ask Title'), button(SORT, 260, 'Sort', 'Sort Notes'), button(WAIT, 380, 'Wait', 'Wait'), button(PASTE, 500, 'Paste', 'Paste Title')],
  } }] as DesignOp[]);

  store.create('Notes', { Id: 1, Tag: 'Green', Title: 'Alpha' });
  store.create('Notes', { Id: 2, Tag: 'Blue', Title: 'Bravo' });
  store.create('Notes', { Id: 3, Tag: 'Red', Title: 'Charlie' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** A Notes field of record `id`, as the file holds it. */
function note(id: number, name: string): string {
  const r = hosted.store('Desk').find('Notes', { query: [{ Id: `==${id}` }] }).records[0];
  return String(r.fieldData[name]);
}

/** A window signed in to Desk, on the first note. */
async function open(context?: BrowserContext): Promise<Page & { errors: string[] }> {
  const page = await window(context ?? await browser.newContext());
  await signIn(page, hosted.url, 'Desk', 'Ann', PASSWORD);
  await until(() => field(page, TITLE).inputValue(), (v) => v !== '');
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

const press = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`).click();

test('Insert from Index: View Index lists the field\'s values, and the one picked goes in the field', { skip }, async () => {
  const page = await open();
  try {
    await press(page, PICK);
    const dialog = page.getByRole('dialog', { name: 'View Index' });
    await dialog.waitFor();
    const values = page.getByRole('listbox', { name: 'Index values' });
    assert.deepEqual(await values.locator('option').allTextContents(), ['Blue', 'Green', 'Red']);
    // Typing narrows the list to the values that start with it; Enter pastes the first.
    await dialog.getByRole('searchbox', { name: 'Find in index' }).fill('r');
    await until(() => values.locator('option').allTextContents(), (v) => JSON.stringify(v) === '["Red"]');
    await dialog.getByRole('searchbox', { name: 'Find in index' }).press('Enter');
    await until(async () => note(1, 'Tag'), (v) => v === 'Red');
    await until(() => field(page, TAG).inputValue(), (v) => v === 'Red');

    // Cancel leaves the field as it was.
    await press(page, PICK);
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(note(1, 'Tag'), 'Red');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Show Custom Dialog: its input and the button pressed reach the script', { skip }, async () => {
  const page = await open();
  try {
    await press(page, ASK);
    const dialog = page.getByRole('dialog', { name: 'Rename' });
    await dialog.waitFor();
    assert.equal(await dialog.locator('.message').textContent(), 'New title?');
    const input = dialog.getByRole('textbox');
    assert.equal(await input.inputValue(), 'Alpha', 'the input starts with the variable\'s value');
    await input.fill('Apex');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await until(async () => note(1, 'Title'), (v) => v === '1/Apex');
    await until(() => field(page, TITLE).inputValue(), (v) => v === '1/Apex');

    // The second button is reported as button 2, with what was typed.
    await press(page, ASK);
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await until(async () => note(1, 'Title'), (v) => v === '2/1/Apex');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Sort Records with its dialog sorts by the order picked there', { skip }, async () => {
  const page = await open();
  try {
    await press(page, SORT);
    const dialog = page.getByRole('dialog', { name: 'Sort records' });
    await dialog.waitFor();
    await dialog.getByRole('listbox', { name: 'Fields' }).selectOption('Id');
    await dialog.getByRole('button', { name: 'Add →' }).click();
    await dialog.getByRole('combobox', { name: 'Order for Id' }).selectOption('descend');
    await dialog.getByRole('button', { name: 'Sort', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    // Sorted by Id, highest first. The window stays on the record it was on, now the last;
    // the ones before it are the second note, then the third.
    await until(() => field(page, ID).inputValue(), (v) => v === '1');
    await page.getByRole('button', { name: 'Previous record' }).click();
    await until(() => field(page, ID).inputValue(), (v) => v === '2');
    await page.getByRole('button', { name: 'Previous record' }).click();
    await until(() => field(page, ID).inputValue(), (v) => v === '3');
    await until(() => page.getByRole('button', { name: 'Previous record' }).isDisabled(), (d) => d); // the third note is first

    // Cancel keeps the order the records are in.
    await press(page, SORT);
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    await until(() => field(page, ID).inputValue(), (v) => v === '3');
    await until(() => page.getByRole('button', { name: 'Previous record' }).isDisabled(), (d) => d);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

// A script that runs on gets a note after a moment with a Stop button; Stop, or Esc, halts it
// (Allow User Abort is on) before it gets to its next step.
for (const how of ['the Stop button', 'Esc'] as const) {
  test(`a long script can be stopped with ${how}`, { skip }, async () => {
    const page = await open();
    try {
      const before = note(1, 'Title');
      const started = Date.now();
      await press(page, WAIT);
      const running = page.getByRole('status').filter({ hasText: 'Running a script…' });
      await running.waitFor();
      if (how === 'Esc') await page.keyboard.press('Escape');
      else await running.getByRole('button', { name: 'Stop' }).click();
      await running.waitFor({ state: 'detached' });
      assert.ok(Date.now() - started < 10_000, 'stopped well before its 30-second pause ends');
      assert.equal(note(1, 'Title'), before, 'the steps after the pause never ran');
      assert.deepEqual(page.errors, []);
    } finally {
      await close(page);
    }
  });
}

test("Paste in a script with nothing copied pastes the person's clipboard, or what they paste into a box when the browser won't share it", { skip }, async () => {
  // A browser that lets the page read the clipboard.
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  let page = await open(context);
  try {
    await page.evaluate(() => navigator.clipboard.writeText('From the clipboard'));
    await press(page, PASTE);
    await until(async () => note(1, 'Title'), (v) => v === 'From the clipboard');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
  // One that won't: the person pastes into a box instead, or cancels and nothing changes.
  const refusing = await browser.newContext();
  await refusing.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'readText', { value: () => Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError')) });
  });
  page = await open(refusing);
  try {
    await press(page, PASTE);
    const dialog = page.getByRole('dialog', { name: 'Paste' });
    await dialog.waitFor();
    await dialog.getByRole('textbox', { name: 'Text to paste' }).fill('Typed in the box');
    await dialog.getByRole('button', { name: 'Paste' }).click();
    await until(async () => note(1, 'Title'), (v) => v === 'Typed in the box');
    await press(page, PASTE);
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    await until(() => field(page, TITLE).inputValue(), (v) => v === 'Typed in the box');
    assert.equal(note(1, 'Title'), 'Typed in the box');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
