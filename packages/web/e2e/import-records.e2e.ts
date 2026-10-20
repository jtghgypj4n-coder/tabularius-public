// File > Import Records in a real browser: a workbook with several sheets offers a Worksheet choice, a semicolon
// file comes in as columns, and a quote that is never closed is reported with its row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { workbook } from '../../scripts/test/workbook-parts.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Town'] });
  const store = hosted.store('Town');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  store.create('People', { Name: 'Ada', City: 'Leeds' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const names = () => hosted.store('Town').find('People', { limit: 100 }).records.map((r) => String(r.fieldData['Name']));

const rows = (...table: string[][]) => table.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('');

/** Picks a file in File > Import Records…; the dialog it opens. */
async function pick(page: Page, name: string, data: Buffer | string) {
  await page.locator('.menubar').getByRole('button', { name: 'File' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /^Import Records/ }).click()]);
  await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(data) });
  const dialog = page.getByRole('dialog', { name: 'Import Records' });
  await dialog.waitFor();
  return dialog;
}

test('a workbook with several sheets offers a Worksheet choice, and the sheet picked is the one imported', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
    const book = workbook([
      { name: 'Roster', rows: rows(['Name', 'City'], ['Grace', 'York']) },
      { name: 'Other', rows: rows(['Name', 'City'], ['Zed', 'Oslo']) },
    ]);
    const dialog = await pick(page, 'people.xlsx', Buffer.from(book));
    const sheet = dialog.getByRole('combobox', { name: 'Worksheet' });
    assert.deepEqual(await sheet.locator('option').allTextContents(), ['Roster', 'Other']);
    await dialog.getByText('Grace').first().waitFor();
    await sheet.selectOption('Other');
    await dialog.getByText('Zed').first().waitFor();
    assert.equal(await dialog.getByText('Grace').count(), 0);
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await until(async () => names(), (n) => n.includes('Zed'));
    assert.ok(!names().includes('Grace'), 'only the sheet picked was imported');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('a semicolon file comes in as columns, and a quote that is never closed is reported', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
    const open = await pick(page, 'broken.csv', 'Name,City\r\nBo,"Hull\r\nCy,Bath\r\n');
    await open.getByText(/row 2 is never closed/).waitFor();
    await open.getByRole('button', { name: 'Cancel' }).click();
    await open.waitFor({ state: 'detached' });
    const semi = await pick(page, 'semi.csv', 'Name;City\r\nSemi;Hull\r\n');
    assert.equal(await semi.getByLabel('Field for Name').inputValue(), 'Name');
    assert.equal(await semi.getByLabel('Field for City').inputValue(), 'City');
    await semi.getByRole('button', { name: 'Import', exact: true }).click();
    await semi.waitFor({ state: 'detached' });
    await until(async () => names(), (n) => n.includes('Semi'));
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

// AR-web-client-05: Import applies only a preview the server has confirmed for what the controls show.
test('a mapping or worksheet changed while its preview is still loading cannot be imported from the old plan', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
    const book = workbook([
      { name: 'Roster', rows: rows(['Name', 'City'], ['Pat', 'Rome']) },
      { name: 'Other', rows: rows(['Name', 'City'], ['Quinn', 'Lima']) },
    ]);
    const dialog = await pick(page, 'held.xlsx', Buffer.from(book));
    await dialog.getByText('Pat').first().waitFor();
    const importButton = dialog.getByRole('button', { name: 'Import', exact: true });
    // Hold every preview the dialog asks for until the test lets it go.
    const held: (() => Promise<void>)[] = [];
    let holding = true;
    await page.route(/\/import\?[^#]*plan=1/, (route) => { if (holding) held.push(() => route.continue()); else return route.continue(); });
    await dialog.getByLabel('Field for Name').selectOption('City');
    await until(async () => held.length, (n) => n === 1);
    assert.equal(await importButton.isDisabled(), true, 'Import waits for the preview of the new mapping');
    await dialog.getByRole('combobox', { name: 'Worksheet' }).selectOption('Other');
    await until(async () => held.length, (n) => n === 2);
    assert.equal(await importButton.isDisabled(), true, 'and for the new worksheet');
    holding = false;
    for (const release of held) await release();
    await dialog.getByText('Quinn').first().waitFor();
    await until(async () => importButton.isDisabled(), (disabled) => !disabled);
    await importButton.click();
    await dialog.waitFor({ state: 'detached' });
    const imported = hosted.store('Town').find('People', { limit: 100 }).records.map((r) => `${r.fieldData['Name']}|${r.fieldData['City']}`);
    assert.ok(!imported.some((r) => r.includes('Pat')), 'nothing came from the first worksheet');
    assert.ok(imported.some((r) => r.includes('Quinn') || r.includes('Lima')), 'the worksheet shown is the one imported');
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

test('a preview that fails puts the controls back to the plan Import will apply', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
    const dialog = await pick(page, 'failing.csv', 'Name,City\r\nRuth,Kiev\r\n');
    await dialog.getByText('Ruth').first().waitFor();
    const field = dialog.getByLabel('Field for Name');
    assert.equal(await field.inputValue(), 'Name');
    let failing = true;
    await page.route(/\/import\?[^#]*plan=1/, (route) => failing ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"messages":[{"message":"Preview failed"}]}' }) : route.continue());
    await field.selectOption('City');
    await until(async () => field.inputValue(), (v) => v === 'Name');
    const importButton = dialog.getByRole('button', { name: 'Import', exact: true });
    assert.equal(await importButton.isDisabled(), false);
    failing = false;
    await importButton.click();
    await dialog.waitFor({ state: 'detached' });
    await until(async () => names(), (n) => n.includes('Ruth'));
    assert.deepEqual(page.errors.filter((e) => !/500|Preview failed|Failed to load resource/.test(String(e))), []);
  } finally { await page.context().close(); }
});

test('a control changed while Import is still running cannot turn Import back on or import twice', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
    const dialog = await pick(page, 'twice.csv', 'Name,City\r\nTess,Oslo\r\n');
    await dialog.getByText('Tess').first().waitFor();
    const importButton = dialog.getByRole('button', { name: 'Import', exact: true });
    // Hold the import itself, and count the previews and imports the dialog asks for.
    let release: (() => Promise<void>) | undefined;
    let applies = 0;
    let previews = 0;
    await page.route(/\/import\?columns=/, (route) => { applies++; release = () => route.continue(); });
    await page.route(/\/import\?[^#]*plan=1/, (route) => { previews++; return route.continue(); });
    await importButton.click();
    await until(async () => applies, (n) => n === 1);
    // A change to a mapping now (as a script or a keystroke already on its way could make) is ignored while the import runs.
    await dialog.getByLabel('Field for Name').evaluate((el) => { (el as HTMLSelectElement).value = 'City'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(500);
    assert.equal(previews, 0, 'no preview is asked for during the import');
    assert.equal(await importButton.isDisabled(), true, 'Import stays off until the import is over');
    await importButton.click({ force: true }).catch(() => {});
    await release!();
    await dialog.waitFor({ state: 'detached' });
    await until(async () => names(), (n) => n.includes('Tess'));
    assert.equal(applies, 1, 'the file was imported once');
    assert.equal(names().filter((n) => n === 'Tess').length, 1);
  } finally { await page.context().close(); }
});
