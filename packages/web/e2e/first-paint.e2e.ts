// How long a person waits: from pressing Sign in to the first layout drawn with its first record, on the two Beezwax
// demo files, with a limit that is generous on purpose (a slow runner passes, a real slowdown does not). The times go
// into the output and, when TABULARIUS_PERF_OUT is set, a file beside the server's performance numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { host, launch, signIn, skipUnless, until, window } from './harness.ts';

const files = ['BeezwaxSemanticSearch', 'BeezwaxUnifiedSearchActions'];
const skip = skipUnless(...files.map((f) => `${f}.fmp12`));
const PASSWORD = 'paint-secret-1';
const LIMIT_MS = 15_000;
const times: Record<string, number> = {};

for (const name of files) {
  test(`${name}: first layout drawn within ${LIMIT_MS / 1000} s of signing in`, { skip, timeout: 300_000 }, async (t) => {
    const hosted = await host({ fixtures: [`${name}.fmp12`] });
    const browser = await launch();
    try {
      const store = await until(async () => hosted.store(name), Boolean, 180_000);
      const account = store.accounts().find((a) => a.privilegeSet === '[Full Access]' && !a.external && !a.inactive)?.name;
      if (!account) {
        t.skip(`${name} has no full access account to sign in with`);
        return;
      }
      store.setPassword(account, PASSWORD, '[Full Access]');
      const page = await window(await browser.newContext());
      const t0 = Date.now();
      await signIn(page, hosted.url, name, account, PASSWORD);
      await until(() => page.locator('.fm').count(), (n) => n > 0, LIMIT_MS);
      const ms = Date.now() - t0;
      times[name] = ms;
      console.log(`first paint ${name}: ${ms} ms, ${await page.locator('.fm').count()} objects`);
      assert.ok(ms < LIMIT_MS, `${name}: the first layout took ${ms} ms to draw; the limit is ${LIMIT_MS} ms`);
    } finally {
      await browser.close();
      await new Promise((r) => setTimeout(r, 500));
      await hosted.close();
    }
  });
}

test.after(() => {
  const out = process.env.TABULARIUS_PERF_OUT;
  if (!out || !Object.keys(times).length) return;
  const path = out.replace(/(\.json)?$/, '-web.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), firstPaintMs: times }, null, 2));
});
