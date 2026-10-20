// Review changes in design mode, in a real browser: design edits generated here are staged by two people, looked over
// (grouped by what they change, a calculation and a script before and after, what a rename or delete would break, who
// staged them), one is made to conflict by a third edit, and they are applied by keyboard: the ticked ones, then the
// one in conflict once it is chosen anyway. A change the design refuses is reported with its reason and kept.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { axeViolations, host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

const LONG = Array.from({ length: 300 }, (_, i) => `# Step ${i + 1}`).join('\n');

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Qty', type: 'number' }, { name: 'Price', type: 'number' }, { name: 'Total', kind: 'calculation', calculation: 'Qty * Price' }] },
    { op: 'createTable', name: 'Scratch', fields: [{ name: 'Note' }] },
    { op: 'createScript', name: 'Tidy', text: 'Show Custom Dialog [ "Tidying" ]\nBeep' },
    { op: 'createScript', name: 'Long', text: LONG },
  ] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.setPassword('Sam', 'sam-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(account: string, password: string): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', account, password);
  await page.goto(`${hosted.url}/app/design.html#review`);
  await page.getByRole('heading', { name: 'Review changes' }).waitFor();
  return page;
}

/** The staged change with exactly this title. */
const row = (page: Page, title: string) => page.locator('.rv-change').filter({ has: page.locator('.rv-title', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

async function stage(page: Page, changes: DesignOp[]): Promise<void> {
  await page.getByText('Stage changes', { exact: true }).click();
  await page.getByLabel('Changes (JSON)').fill(JSON.stringify(changes));
  await page.getByRole('button', { name: 'Stage', exact: true }).click();
  await page.getByRole('status').getByText(/^Staged \d+ change/).waitFor();
}

test('staged design edits are reviewed, one conflicts, and they apply from the keyboard', { skip }, async () => {
  const store = hosted.store('Shop');
  const ann = await open('Ann', 'ann-secret-1');
  const sam = await open('Sam', 'sam-secret-1');
  try {
    await ann.getByText('Nothing is waiting for review').waitFor();

    // Ann stages generated edits: a calculation, a rename, a long script rewrite, a delete, and one the design refuses.
    await stage(ann, [
      { op: 'updateField', table: 'Orders', field: 'Total', calculation: 'Qty * Price * 1.2' },
      { op: 'updateField', table: 'Orders', field: 'Qty', name: 'Quantity' },
      { op: 'updateScript', script: 'Long', text: LONG.replace('# Step 150', '# Step 150 changed').replace('# Step 290', '# Step 290 changed').concat('\n# Step 301 new') },
      { op: 'deleteTable', table: 'Scratch' },
      { op: 'createField', table: 'Nowhere', name: 'X' },
    ] as DesignOp[]);
    // Sam stages a change to a script Ann has not touched.
    await stage(sam, [{ op: 'updateScript', script: 'Tidy', text: 'Show Custom Dialog [ "Tidying" ]\nBeep\nBeep' }] as DesignOp[]);

    await ann.getByRole('button', { name: 'Refresh' }).click();
    await ann.getByText('6 staged: 5 ready, 1 cannot apply').waitFor();
    // Grouped by what they change, and who staged each.
    const groups = await ann.locator('.rv-group h3').allTextContents();
    assert.deepEqual(groups.map((g) => g.replace(/\d+$/, '').trim()), ['Field Orders::Total', 'Field Orders::Qty', 'Script Long', 'Table Scratch', 'Field Nowhere::X', 'Script Tidy']);
    const tidy = row(ann, 'Change script Tidy');
    assert.ok((await tidy.textContent())!.includes('Staged by Sam'), 'who staged it');
    assert.ok((await row(ann, 'Change field Orders::Total').textContent())!.includes('Staged by Ann'));
    // The calculation, before and after.
    const calc = row(ann, 'Change field Orders::Total');
    assert.equal((await calc.locator('.se-diff-del').innerText()).trim(), '− Qty * Price');
    assert.equal((await calc.locator('.se-diff-add').innerText()).trim(), '+ Qty * Price * 1.2');
    // What the rename and the delete put at risk.
    const rename = row(ann, 'Rename field Orders::Qty to Quantity');
    await rename.locator('.rv-impact summary').waitFor();
    assert.match(await rename.locator('.rv-impact summary').innerText(), /^Rename: /);
    assert.match(await row(ann, 'Delete table Scratch').locator('.rv-impact summary').innerText(), /^Delete: /);
    // A long script: the changed lines with a little around them, and no more than a page of them at once.
    const long = row(ann, 'Change script Long');
    assert.ok((await long.locator('.se-diff-add').count()) >= 3);
    // The refused one says why.
    const refused = row(ann, 'Add field Nowhere::X');
    assert.equal(await refused.locator('.rv-status').innerText(), 'Cannot apply');
    assert.match(await refused.locator('.rv-why').innerText(), /^Cannot apply: .*Nowhere/);

    // Sam's script is changed under him by a direct edit: a conflict, named.
    store.applyDesign([{ op: 'updateScript', script: 'Tidy', text: 'Exit Script' }] as DesignOp[], { account: 'Ann' });
    await ann.getByRole('button', { name: 'Refresh' }).click();
    await tidy.locator('.rv-status', { hasText: 'Conflict' }).waitFor();
    assert.match(await tidy.locator('.rv-conflict-note').innerText(), /Ann changed this since it was staged \(change script tidy/);
    // The diff is against the script as it is now, so the conflict can be seen in it.
    assert.equal((await tidy.locator('.se-diff-del').innerText()).trim(), '− Exit Script');
    await ann.getByText('6 staged: 4 ready, 1 cannot apply, 1 in conflict').waitFor();

    // By keyboard: tick the calculation and the rename with the space bar, then press Apply selected.
    await ann.getByLabel('Change field Orders::Total').focus();
    await ann.keyboard.press('Space');
    await ann.getByLabel('Rename field Orders::Qty to Quantity').focus();
    await ann.keyboard.press('Space');
    const applySelected = ann.getByRole('button', { name: 'Apply selected (2)' });
    await applySelected.focus();
    assert.equal(await applySelected.evaluate((el) => document.activeElement === el), true, 'ticking boxes keeps the keyboard where it was');
    await ann.keyboard.press('Enter');
    const result = ann.getByRole('status').filter({ hasText: 'Applied 2 changes.' });
    await result.waitFor();
    assert.ok((await result.textContent())!.includes('3 changes still waiting') || (await result.textContent())!.includes('4 changes still waiting'));
    const fields = store.schema.tables.find((t) => t.name === 'Orders')!.fields;
    assert.equal(fields.find((f) => f.name === 'Total')!.calculation, 'Quantity * Price * 1.2');
    assert.ok(fields.some((f) => f.name === 'Quantity'), 'renamed');
    assert.equal(await row(ann, 'Change field Orders::Total').count(), 0, 'applied changes leave the list');

    // Apply all: the ready ones go, the refused one is reported with its reason, the one in conflict is left alone.
    await ann.getByRole('button', { name: 'Apply all' }).click();
    const second = ann.getByRole('status').filter({ hasText: 'Applied 2 changes.' });
    await second.waitFor();
    const text = (await second.textContent())!;
    assert.match(text, /Could not apply: Add field Nowhere::X\./);
    assert.match(text, /Left alone, Ann changed it since it was staged: Change script Tidy\./);
    assert.equal(store.schema.tables.some((t) => t.name === 'Scratch'), false);
    assert.ok(store.schema.scripts.find((s) => s.name === 'Long')!.steps.length > 300);
    assert.equal(store.schema.scripts.find((s) => s.name === 'Tidy')!.steps.length, 1, 'the script is as the other edit left it');

    // Choosing the one in conflict anyway puts it on top.
    await ann.getByLabel('Apply it anyway when I apply').check();
    await ann.getByRole('button', { name: 'Apply all' }).click();
    await ann.getByRole('status').filter({ hasText: 'Applied 1 change.' }).waitFor();
    assert.equal(store.schema.scripts.find((s) => s.name === 'Tidy')!.steps.length, 3);

    // The refused change is still there; discarding it empties the list.
    await ann.getByText('1 staged: 0 ready, 1 cannot apply').waitFor();
    ann.once('dialog', (d) => void d.accept());
    await ann.getByLabel('Add field Nowhere::X').check();
    await ann.getByRole('button', { name: 'Discard selected (1)' }).or(ann.getByRole('button', { name: 'Discard selected' })).click();
    await ann.getByText('Nothing is waiting for review').waitFor();
    assert.deepEqual(await axeViolations(ann), []);
    assert.deepEqual([...ann.errors, ...sam.errors], []);
  } finally {
    await ann.close();
    await sam.close();
  }
});

test('a long diff shows its first lines and the rest on request', { skip }, async () => {
  const page = await open('Ann', 'ann-secret-1');
  try {
    const lines = Array.from({ length: 400 }, (_, i) => `# Row ${i}`).join('\n');
    const rewritten = Array.from({ length: 400 }, (_, i) => `# Changed ${i}`).join('\n');
    hosted.store('Shop').applyDesign([{ op: 'createScript', name: 'Wide', text: lines }] as DesignOp[]);
    await stage(page, [{ op: 'updateScript', script: 'Wide', text: rewritten }] as DesignOp[]);
    const change = row(page, 'Change script Wide');
    const more = change.getByRole('button', { name: /^Show \d+ more lines$/ });
    await more.waitFor();
    const shown = await change.locator('.se-diff span').count();
    assert.ok(shown <= 125 + 5, `a page of lines, not ${shown}`);
    await more.click();
    assert.ok((await change.locator('.se-diff span').count()) >= 800, 'every line once asked');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Discard selected' }).waitFor();
    await page.getByLabel('Change script Wide').check();
    await page.getByRole('button', { name: /^Discard selected/ }).click();
    await page.getByText('Nothing is waiting for review').waitFor();
  } finally {
    await page.close();
  }
});
