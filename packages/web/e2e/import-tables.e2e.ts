// File > Import Tables… from the web client, in a real browser, on a small database built here with no .fmp12: an account
// with Full Access picks two CSV files, reads the plan, changes a column's type, imports, and the tables are in the file.
// An account without Full Access is not offered the entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { axeViolations, host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

const CLIENTS = 'Name,Notes\r\nAcme,first\r\nBeta,second\r\nGamma,third\r\n';
const ORDERS = 'Order,Client,Total\r\n1,Acme,10.5\r\n2,"Acme, Beta",20\r\n3,Gamma,1000\r\n';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Planner'] });
  const store = hosted.store('Planner');
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Title' }] }] as DesignOp[]);
  store.create('Events', { Title: 'Standup' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmwebdirect', 'fmrest'] });
  store.setPassword('Sam', 'sam-secret-1', 'Staff');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(account: string, password: string): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Planner', account, password);
  await page.getByRole('button', { name: 'View as Form' }).click();
  return page;
}

test('Full Access reads the plan of two CSV files, changes a column, and imports the tables', { skip }, async () => {
  const page = await open('Ann', 'ann-secret-1');
  try {
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import Tables…', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'Import Tables' });
    // Nothing chosen: it says so.
    await d.getByRole('button', { name: 'Preview' }).click();
    await d.getByText('Choose the files to import').waitFor();
    await d.getByLabel('Files', { exact: true }).setInputFiles([
      { name: 'Clients-Grid view.csv', mimeType: 'text/csv', buffer: Buffer.from(CLIENTS) },
      { name: 'Orders-Grid view.csv', mimeType: 'text/csv', buffer: Buffer.from(ORDERS) },
    ]);
    await d.getByRole('button', { name: 'Preview' }).click();
    const kind = d.getByLabel('Type of Client in Orders');
    await kind.waitFor();
    assert.equal(await kind.inputValue(), 'link:Clients', 'the column naming clients is a link to the Clients sheet');
    assert.ok((await d.textContent())!.includes('Acme · Acme, Beta · Gamma'), 'the first rows are shown');
    assert.equal(hosted.store('Planner').schema.tables.length, 1, 'a preview writes nothing');
    // Leave the column as plain text: the plan changes, the choice stays on the select.
    await kind.selectOption('text');
    await d.getByLabel('Type of Client in Orders').waitFor();
    await page.waitForFunction(() => (document.querySelector('[aria-label="Type of Client in Orders"]') as HTMLSelectElement | null)?.value === 'text');
    assert.match(await d.locator('.import-tables-line').nth(1).textContent() ?? '', /Orders: table Orders, 3 rows, 3 fields$/);
    assert.deepEqual(await axeViolations(page, 'dialog.import-tables-dialog'), []);
    await d.getByRole('button', { name: 'Import', exact: true }).click();
    await d.getByText(/^Imported\. 2 tables/).waitFor();
    assert.deepEqual(hosted.store('Planner').schema.tables.map((t) => t.name), ['Events', 'Clients', 'Orders']);
    assert.equal(hosted.store('Planner').query('SELECT count(*) AS n FROM "Orders"')[0].n, 3);
    assert.ok(await d.getByRole('button', { name: 'Import', exact: true }).isDisabled(), 'it cannot be imported twice');
    await d.getByRole('button', { name: 'Done' }).click();
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('an account without Full Access is not offered Import Tables', { skip }, async () => {
  const page = await open('Sam', 'sam-secret-1');
  try {
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import Records…' }).first().waitFor();
    assert.equal(await page.getByRole('menuitem', { name: /Import Tables/ }).count(), 0);
  } finally {
    await page.context().close();
  }
});
