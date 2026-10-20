// Layout objects that are worked out from the record, in a real browser, on a
// small database built here with no .fmp12: a button bar whose labels and
// active segment are calculations, merge fields and calculated merge text,
// tooltips and placeholders, and a repeating field.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// Layout object ids, as laid out below.
const ID = 1;
const NAME = 2;
const NOTE = 3;
const SCORE = 4;
const GREETING = 5;
const SHOUT = 6;
const STATUS = 7;
const BAR = 10;
const OPEN = 11;
const CLOSED = 12;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Desk'] });
  const store = hosted.store('Desk');
  store.applyDesign([
    { op: 'createTable', name: 'Tasks', fields: [
      { name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Note' }, { name: 'Status' },
      { name: 'Score', type: 'number', options: { repetitions: 3 } },
    ] },
    { op: 'createScript', name: 'Open', text: 'Set Field [ Tasks::Status ; "Open" ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'createScript', name: 'Close', text: 'Set Field [ Tasks::Status ; "Closed" ]\nCommit Records/Requests [ With dialog: Off ]' },
  ] as DesignOp[]);

  const design = store.design('Tasks')!;
  const occ = store.schema.tableOccurrences.find((t) => t.name === 'Tasks')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Tasks')!.fields.find((f) => f.name === name)!.id;
  const scriptId = (name: string) => store.schema.scripts.find((s) => s.name === name)!.id;
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const at = (top: number, height: number, left = 20, width = 300) => ({ top, left, bottom: top + height, right: left + width });
  const box = (id: number, name: string, top: number, extra: Partial<LayoutObject> = {}, reps = 1): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: at(top, 22 * reps),
    field: { tableOccurrenceId: occ.id, fieldId: fieldId(name), tableOccurrence: 'Tasks', field: name, display: 'edit', repetitions: reps },
    ...extra,
  } as LayoutObject);
  const segment = (id: number, name: string, left: number, script: string, label: string): LayoutObject => ({
    id, kind: 'button', type: 10, name, anchors, style: {}, bounds: at(240, 24, left, 120), label,
    action: { stepId: 1, step: 'Perform Script', scriptId: scriptId(script), script },
  } as LayoutObject);
  const objects: LayoutObject[] = [
    box(ID, 'Id', 10),
    box(NAME, 'Name', 40, { tooltip: '"Called " & Self' }),
    box(NOTE, 'Note', 70, { placeholder: '"Notes for " & Tasks::Name & If ( IsEmpty ( Self ) ; " (none yet)" )' }),
    box(SCORE, 'Score', 100, {}, 3),
    // Self in a field's own hide condition, tooltip or placeholder is the field.
    box(STATUS, 'Status', 270, { hide: { formula: 'Self = "Closed"', inFind: false } }),
    { id: GREETING, kind: 'text', type: 2, anchors, style: {}, bounds: at(180, 20), text: 'Task <<Name>>: {{RecordNumber}} of {{FoundCount}}' } as LayoutObject,
    { id: SHOUT, kind: 'text', type: 2, anchors, style: {}, bounds: at(205, 20), text: '<<ƒ:Upper ( Tasks::Name ) & " is " & Tasks::Status>>' } as LayoutObject,
    { id: BAR, kind: 'button-bar', type: 18, anchors, style: {}, bounds: at(240, 24, 20, 240),
      activeSegmentFormula: 'If ( Tasks::Status = "Closed" ; "closed" ; "open" )', children: [
        segment(OPEN, 'open', 20, 'Open', '"Open"'),
        segment(CLOSED, 'closed', 140, 'Close', '"Close " & Tasks::Name'),
      ] } as LayoutObject,
  ];
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 320 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Tasks', design: { parts, objects } }] as DesignOp[]);

  store.create('Tasks', { Id: 1, Name: 'Paint', Note: '', Status: 'Open' });
  store.create('Tasks', { Id: 2, Name: 'Sand', Note: 'fine grit', Status: 'Closed' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Record `id`'s fields as the file holds them. */
function task(id: number): Record<string, unknown> {
  return hosted.store('Desk').find('Tasks', { query: [{ Id: `==${id}` }] }).records[0]?.fieldData ?? {};
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Desk', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${ID}"]`).count(), (n) => n === 1);
  await goTo(page, 1);
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

/** Goes to record `n` (the record whose Id is n: they were made in order). */
async function goTo(page: Page, n: number): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Record number' });
  await until(async () => {
    if (await box.inputValue() !== String(n)) {
      await box.fill(String(n));
      await box.press('Enter');
    }
    return field(page, ID).inputValue();
  }, (v) => v === String(n));
}

const object = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`);
const segment = (page: Page, id: number) => object(page, id).getByRole('button');

test('a button bar labels its segments and shows the active one from calculations, and its segments run their scripts', { skip }, async () => {
  const page = await open();
  try {
    await until(() => segment(page, CLOSED).textContent(), (t) => t === 'Close Paint');
    assert.equal(await segment(page, OPEN).getAttribute('aria-pressed'), 'true');
    assert.equal(await segment(page, CLOSED).getAttribute('aria-pressed'), 'false');
    await until(() => object(page, STATUS).count(), (n) => n === 1);

    await segment(page, CLOSED).click();
    await until(async () => task(1).Status, (s) => s === 'Closed');
    await until(() => segment(page, CLOSED).getAttribute('aria-pressed'), (p) => p === 'true');
    assert.equal(await segment(page, OPEN).getAttribute('aria-pressed'), 'false');
    await until(() => object(page, STATUS).count(), (n) => n === 0);

    // The next record has its own label and its own active segment.
    await goTo(page, 2);
    await until(() => segment(page, CLOSED).textContent(), (t) => t === 'Close Sand');
    await segment(page, OPEN).click();
    await until(async () => task(2).Status, (s) => s === 'Open');
    await until(() => segment(page, OPEN).getAttribute('aria-pressed'), (p) => p === 'true');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('merge fields, symbols and calculated merge text show the record\'s values, and follow an edit', { skip }, async () => {
  const page = await open();
  try {
    await until(() => object(page, GREETING).textContent(), (t) => t === 'Task Paint: 1 of 2');
    await until(() => object(page, SHOUT).textContent(), (t) => /^PAINT is (Open|Closed)$/.test(t ?? ''));
    await goTo(page, 2);
    await until(() => object(page, GREETING).textContent(), (t) => t === 'Task Sand: 2 of 2');

    await field(page, NAME).fill('Varnish');
    await field(page, NAME).press('Enter');
    await until(async () => task(2).Name, (n) => n === 'Varnish');
    await until(() => object(page, GREETING).textContent(), (t) => t === 'Task Varnish: 2 of 2');
    await until(() => object(page, SHOUT).textContent(), (t) => t?.startsWith('VARNISH is ') ?? false);

    // Find mode shows no values in merge text.
    await page.locator('button.tb', { hasText: 'Find' }).first().click();
    await until(() => object(page, GREETING).textContent(), (t) => (t ?? '').startsWith('Task : '));
    await until(() => object(page, SHOUT).textContent(), (t) => t === '');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a tooltip and a placeholder are worked out for each record', { skip }, async () => {
  const page = await open();
  try {
    await until(() => object(page, NAME).getAttribute('title'), (t) => t === 'Called Paint');
    await until(() => field(page, NOTE).getAttribute('placeholder'), (p) => p === 'Notes for Paint (none yet)');
    assert.equal(await field(page, NOTE).inputValue(), '');
    await goTo(page, 2);
    await until(() => object(page, NAME).getAttribute('title'), (t) => t === 'Called Sand' || t === 'Called Varnish');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a repeating field shows each repetition, and a value typed in one is saved in it', { skip }, async () => {
  const page = await open();
  try {
    const reps = object(page, SCORE).locator('input');
    await until(() => reps.count(), (n) => n === 3);
    await reps.nth(1).fill('42');
    await reps.nth(1).press('Tab');
    await until(async () => task(1)['Score(2)'], (v) => Number(v) === 42);
    assert.ok(!task(1).Score, 'the first repetition is left empty');
    await until(() => reps.nth(1).inputValue(), (v) => v === '42');
    assert.equal(await reps.nth(0).inputValue(), '');
    assert.equal(await found(page).locator('b').textContent(), '2');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});
