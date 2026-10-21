import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, window } from './harness.ts';

test('browse first usable layout under a throttled local network stays within the startup budget', async () => {
  const hosted = await host({ stores: ['Budget'] });
  const store = hosted.store('Budget');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }] as DesignOp[]);
  store.create('Items', { Name: 'First item' });
  store.setPassword('Reader', 'budget-test-password', '[Full Access]');
  const browser = await launch();
  const page = await window(await browser.newContext());
  const responses: Promise<{ url: string; raw: number; gzip: number; type: string } | undefined>[] = [];
  const started = Date.now();
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: 1_500_000 / 8, uploadThroughput: 750_000 / 8, connectionType: 'cellular3g',
    });
    page.on('response', (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (!/(?:javascript|text\/css)/i.test(type)) return;
      responses.push((async () => {
        try {
          const body = await response.body();
          return { url: response.url(), raw: body.byteLength, gzip: gzipSync(body, { level: 9 }).byteLength, type };
        } catch { return undefined; }
      })());
    });
    await page.goto(`${hosted.url}/app/`);
    await page.locator('select[name="db"]').selectOption('Budget');
    await page.locator('input[name="account"]').fill('Reader');
    await page.locator('input[name="password"]').fill('budget-test-password');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('.fm-part').first().waitFor({ timeout: 45_000 });
    const elapsed = Date.now() - started;
    await page.waitForTimeout(250);
    const loaded = (await Promise.all(responses)).filter((item): item is NonNullable<typeof item> => !!item);
    const totals = loaded.reduce((sum, item) => ({ raw: sum.raw + item.raw, gzip: sum.gzip + item.gzip }), { raw: 0, gzip: 0 });
    const urls = loaded.map((item) => item.url);
    assert.ok(!urls.some((url) => /(?:design\.html|design\/main|debugger\.html|debugger\/main|dashboard\.html|dashboards\/main|dashboard-view|chart\.ts|\/admin\/)/.test(url)), `browse-only requests included a deferred view: ${urls.join(', ')}`);
    assert.ok(elapsed < 45_000, `first usable layout took ${elapsed} ms; budget 45000 ms`);
    console.log(`throttled browse startup: ${elapsed} ms; ${totals.raw} raw JS/CSS bytes (${totals.gzip} gzip); ${loaded.length} JS/CSS resources`);
    assert.deepEqual(page.errors, []);
  } finally {
    await browser.close();
    await hosted.close();
  }
});
