import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { host, launch, window as browserWindow } from './harness.ts';

// Fresh local database, no FileMaker fixtures and no optional/disabled test path.
test('Manage Security uploads, previews, applies and reports CSV account changes safely on desktop and mobile', async () => {
  const hosted = await host({ stores: ['Local'] });
  const store = hosted.store('Local');
  store.setPassword('Admin', 'admin-secret', '[Full Access]');
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  let browser;
  try {
    browser = await launch();
    const page = await browserWindow(browser);
    const response = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Local/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('Admin:admin-secret').toString('base64') }, body: '{}' });
    assert.equal(response.status, 200);
    const token = (await response.json()).response.token;
    await page.addInitScript(({ token }) => sessionStorage.setItem('tabularius.session', JSON.stringify({ db: 'Local', token })), { token });
    await page.goto(hosted.url + '/app/security.html');
    await page.getByText('Import local accounts', { exact: true }).click();
    const preview = page.getByRole('button', { name: 'Preview import', exact: true });
    const apply = page.getByRole('button', { name: 'Apply import', exact: true });
    assert.equal(await preview.isDisabled(), true);
    assert.equal(await apply.isDisabled(), true);
    await page.getByLabel('Account CSV').setInputFiles({ name: 'accounts.csv', mimeType: 'text/csv', buffer: Buffer.from('account,privilegeSet,active\n"<b>new,account</b>",Staff,true') });
    await preview.click();
    await page.getByRole('heading', { name: 'Review account changes' }).waitFor();
    assert.equal(store.accounts().some((a) => a.name === '<b>new,account</b>'), false);
    assert.equal(await page.locator('.sec-import-rows b').count(), 0, 'CSV text is never interpreted as HTML');
    assert.equal(await apply.isDisabled(), false);
    await page.getByText('New accounts cannot password-sign-in yet.', { exact: false }).waitFor();
    const screenshots = process.env.TABULARIUS_IMPORT_SCREENSHOTS;
    if (screenshots) {
      mkdirSync(screenshots, { recursive: true });
      await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.getByRole('button', { name: 'Apply import', exact: true }).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile page has no horizontal overflow');
    if (screenshots) await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
    await apply.click();
    await page.getByRole('heading', { name: 'Import complete' }).waitFor();
    assert.equal(store.verify('<b>new,account</b>', '', ''), false);
    assert.equal(store.mustChangePassword('<b>new,account</b>'), true);
    assert.equal(await page.getByRole('button', { name: 'Apply import', exact: true }).isDisabled(), true);
    await page.getByLabel('Account CSV').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('account,privilegeSet,active\nGood,Staff,true\nBad,Unknown,false') });
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await page.getByText('Row 3: Choose a privilege set already in this file.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Apply import', exact: true }).isDisabled(), true);
    assert.equal(store.accounts().some((a) => a.name === 'Good'), false);
    await page.getByLabel('Account CSV').setInputFiles({ name: 'same.csv', mimeType: 'text/csv', buffer: Buffer.from('account,privilegeSet,active\n"<b>new,account</b>",Staff,true') });
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await page.getByRole('cell', { name: 'no-op', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Apply import', exact: true }).click();
    await page.getByRole('heading', { name: 'Import complete' }).waitFor();
    assert.equal(store.auditLog({ kind: 'account-added', security: true }).filter((e) => e.target === '<b>new,account</b>').length, 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await browser?.close();
    await hosted.close();
  }
});
