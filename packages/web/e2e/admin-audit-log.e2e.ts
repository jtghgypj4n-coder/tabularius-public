// The admin console's Audit log in a real browser: record changes show where they came from, Verify says the log
// is intact (and finds one that was edited behind its back), and the settings keep a field's values out of it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Code' }, { name: 'Pin' }] }] as DesignOp[]);
  const { recordId } = store.create('Items', { Code: 'a', Pin: '1234' }, { account: 'Ann' });
  store.update('Items', recordId, { Code: 'b' }, undefined, { account: 'Ann' });
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('the audit log shows the source, verifies, notices tampering and keeps a field out', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#audit-db option').count(), (n) => n > 0);
  await page.locator('#audit-refresh').click();
  await until(() => page.locator('#audit').getByRole('columnheader', { name: 'Source' }).count(), (n) => n === 1);
  await until(() => page.locator('#audit-count').textContent(), (t) => Number(t) >= 2);

  await page.getByRole('button', { name: 'Verify record log' }).click();
  await until(() => page.locator('#audit-verify-result').textContent(), (t) => !!t?.startsWith('Intact'));

  // Someone with the file changes an entry behind the server's back.
  const sql = new DatabaseSync(hosted.store('Shop').path);
  sql.exec("PRAGMA busy_timeout = 5000; UPDATE _fm_audit SET account = 'Mallory' WHERE kind = 'update' AND tbl = 'Items'");
  sql.close();
  await page.getByRole('button', { name: 'Verify record log' }).click();
  await until(() => page.locator('#audit-verify-result').textContent(), (t) => !!t?.startsWith('Not intact'));
  assert.match((await page.locator('#audit-verify-result').textContent()) ?? '', /the entry was changed/);

  await page.locator('#audit-settings summary').click();
  await page.locator('#audit-exclude').fill('Items: Pin');
  await page.locator('#audit-retention').fill('90');
  await page.locator('#audit-settings-save').click();
  await until(async () => hosted.store('Shop').auditSettings(), (s) => s.retentionDays === 90);
  assert.deepEqual(hosted.store('Shop').auditSettings().excludeFields, { Items: ['Pin'] });
  assert.deepEqual(page.errors, []);
});
