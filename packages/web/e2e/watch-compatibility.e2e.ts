import { test } from 'node:test';
import assert from 'node:assert/strict';
import { until } from './harness.ts';
import { hosted, formula, key, debugRoute, open, addWatch, saved } from './watch-recovery-helpers.ts';

test('Data Viewer follows the window and evaluates watches when an older server has no /runs', { timeout: 30_000 }, async () => {
  const page = await open();
  try {
    await addWatch(page);
    await page.route('**/tabularius/debug/**/runs', (r) => r.fulfill({ status: 404, body: 'Not found' }));
    await page.reload();
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    await page.getByRole('cell', { name: 'SYNTHETIC_SAVED_WATCH', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Current', exact: true }).click();
    await page.evaluate(() => {
      const channel = new BroadcastChannel('tabularius.window.Synthetic');
      channel.postMessage({ type: 'window', layout: 'Items', recordId: 1, number: 1, foundCount: 1 });
      channel.close();
    });
    await page.getByRole('cell', { name: 'Sample', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('cell', { name: 'Items::Value', exact: true }).waitFor();
    await saved(page);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('missing /runs never exposes watches when the fallback denies access', { timeout: 30_000 }, async () => {
  const page = await open();
  try {
    await addWatch(page);
    await page.route('**/tabularius/debug/**/runs', (r) => r.fulfill({ status: 404, body: 'Not found' }));
    await page.route('**/tabularius/debug/**/evaluate', (r) => r.fulfill({ status: 403, json: { error: { code: 9, message: 'Synthetic denied' } } }));
    await page.reload();
    await until(() => page.locator('#app').textContent(), (s) => !!s?.includes('Synthetic denied'), 10_000);
    assert.ok(!(await page.locator('#app').textContent())?.includes(formula));
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), null);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

test('Data Viewer rechecks access without a selected layout', { timeout: 30_000 }, async () => {
  const page = await open();
  try {
    await addWatch(page);
    await page.evaluate(() => sessionStorage.removeItem('tabularius.layout.Synthetic'));
    await page.reload();
    await page.getByRole('cell', { name: formula, exact: true }).waitFor();
    await page.route(debugRoute, (r) => r.fulfill({ status: 401, json: { error: { code: -1, message: 'Synthetic session ended' } } }));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.ok(!(await page.locator('#app').textContent())?.includes(formula));
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), null);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
