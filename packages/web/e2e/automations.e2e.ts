// The Automations page, in a real browser, on a small database built here with
// no .fmp12: a rule saved through the page's own API, a change to a record
// setting it off on the server, its run listed, and the
// rule turned off, on again, and deleted after asking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }, { name: 'Memo' }] },
    { op: 'createScript', name: 'Stamp', text: 'Set Field [ Customers::Memo ; "Moved to " & Customers::City ]\nCommit Records/Requests [ With dialog: Off ]' },
  ] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'London' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const memo = () => String(hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData.Memo);

test('a saved automation runs when a record is changed, shows its run, and is turned off, on and deleted', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.goto(hosted.url + '/app/automations.html');
    await page.getByText('No automations yet').waitFor();

    // A rule is saved through the page's API, as the assistant's Turn on does.
    const saved = await page.evaluate(async () => {
      const s = JSON.parse(sessionStorage.getItem('tabularius.session')!);
      const r = await fetch(`/tabularius/automations/v1/databases/${encodeURIComponent(s.db)}`, {
        method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ automation: { name: 'Stamp the move', enabled: true, layout: 'Customers', on: 'update', fields: ['City'], script: 'Stamp', account: 'Ann' } }),
      });
      return { status: r.status, text: await r.text() };
    });
    assert.equal(saved.status, 201, saved.text);
    await page.getByRole('button', { name: 'Refresh' }).click();
    const rule = page.locator('section.automation', { hasText: 'Stamp the move' });
    await rule.waitFor();
    await rule.getByText('Not run yet').waitFor();

    // A record changed through the Data API (as any app does) sets it off on the server.
    const patched = await page.evaluate(async () => {
      const s = JSON.parse(sessionStorage.getItem('tabularius.session')!);
      const r = await fetch(`/fmi/data/vLatest/databases/${encodeURIComponent(s.db)}/layouts/Customers/records/1`, {
        method: 'PATCH', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { City: 'Oslo' } }),
      });
      return r.status;
    });
    assert.equal(patched, 200);
    await until(async () => memo(), (v) => v === 'Moved to Oslo');
    await until(async () => { await page.getByRole('button', { name: 'Refresh' }).click(); return rule.locator('tbody tr').count(); }, (n) => n === 1);
    assert.equal(await rule.locator('tbody td').nth(2).textContent(), 'OK');

    // Off and on again.
    await rule.getByRole('button', { name: 'Turn off' }).click();
    await page.locator('section.automation', { hasText: 'Stamp the move (off)' }).waitFor();
    await page.locator('section.automation').getByRole('button', { name: 'Turn on' }).click();
    await rule.getByRole('button', { name: 'Turn off' }).waitFor();

    // Delete asks first; its script stays.
    page.once('dialog', (d) => void d.dismiss());
    await rule.getByRole('button', { name: 'Delete' }).click();
    assert.equal(await rule.isVisible(), true);
    page.once('dialog', (d) => void d.accept());
    await rule.getByRole('button', { name: 'Delete' }).click();
    await page.getByText('No automations yet').waitFor();
    assert.ok(hosted.store('Shop').schema.scripts.some((s) => s.name === 'Stamp'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
