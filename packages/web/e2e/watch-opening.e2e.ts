import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Route } from 'playwright-core';
import { until } from './harness.ts';
import { hosted, formula, debugRoute, open, addWatch, saved } from './watch-recovery-helpers.ts';

for (const failure of ['abort', 500, 404] as const) {
  const fail = (route: Route) => failure === 'abort' ? route.abort('failed')
    : route.fulfill({ status: failure, json: { error: { code: failure, message: `Synthetic failure ${failure}` } } });
  for (const tool of ['dataviewer', 'debugger'] as const) {
    test(`${tool} preserves watches when opening fails with ${failure}`, { timeout: 30_000 }, async () => {
      const page = await open();
      try {
        await addWatch(page);
        await page.route(debugRoute, fail);
        await page.goto(hosted.url + `/app/${tool}.html`);
        await until(() => page.locator('#app').textContent(), (s) => /Synthetic failure|Failed to fetch/.test(s ?? ''), 10_000);
        await saved(page);
        assert.ok(!(await page.locator('#app').textContent())?.includes(formula));
        await page.unroute(debugRoute, fail);
        await page.reload();
        await page.getByRole('cell', { name: formula, exact: true }).waitFor();
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });
  }
}
