import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Route } from 'playwright-core';
import { until } from './harness.ts';
import { hosted, formula, debugRoute, open, addWatch, saved } from './watch-recovery-helpers.ts';

for (const failure of ['abort', 500, 404] as const) {
  const fail = (route: Route) => failure === 'abort' ? route.abort('failed')
    : route.fulfill({ status: failure, json: { error: { code: failure, message: `Synthetic failure ${failure}` } } });
  for (const tool of ['dataviewer', 'debugger'] as const) {
    test(`${tool} reports ${failure} after opening and keeps watches after reload`, { timeout: 30_000 }, async () => {
      const page = await open();
      try {
        await addWatch(page);
        if (tool === 'debugger') {
          await page.goto(hosted.url + '/app/debugger.html');
          await page.getByRole('cell', { name: formula, exact: true }).waitFor();
        }
        await page.route(debugRoute, fail);
        if (tool === 'dataviewer') await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        else await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
        await page.locator(tool === 'dataviewer' ? '.g-err' : '.toast-error').first().waitFor();
        await saved(page);
        await page.getByRole('cell', { name: formula, exact: true }).waitFor();
        await page.unroute(debugRoute, fail);
        if (tool === 'dataviewer') {
          await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await until(() => page.locator('.g-err').count(), (n) => n === 0, 10_000);
        }
        await page.reload();
        await page.getByRole('cell', { name: formula, exact: true }).waitFor();
        await saved(page);
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });
  }
}
