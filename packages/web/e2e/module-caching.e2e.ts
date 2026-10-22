// The web client's scripts and styles are kept by the browser: a second visit asks the server for the page and
// nothing else it names, and still starts and signs in. A changed file gets new URLs, fetched once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { host, launch, signIn, window } from './harness.ts';
import { countRequests } from './request-counter.ts';
import type { DesignOp } from '../../store/src/index.ts';

test('a second visit fetches no script or style again, and the app still signs in', async () => {
  const hosted = await host({ stores: ['Cache'] });
  const store = hosted.store('Cache');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }] as DesignOp[]);
  store.create('Items', { Name: 'First item' });
  store.setPassword('Reader', 'cache-test-password', '[Full Access]');
  const proxy = await countRequests(hosted.url);
  const browser = await launch();
  // The service worker answers from its own copy; this test is about what the server is asked for.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const first = await window(context);
    await first.goto(`${proxy.url}/app/`);
    await first.locator('select[name="db"]').waitFor();
    const modules = proxy.seen.filter((r) => /\/app\/src\/.+\.ts\?v=[0-9a-f]{16}$/.test(r.path));
    assert.ok(modules.length > 20, `the first visit fetched the modules (${modules.length})`);
    assert.ok(modules.every((r) => r.status === 200));
    assert.equal(new Set(modules.map((r) => r.path)).size, modules.length, 'each module is fetched once, not twice');
    await first.close();

    proxy.seen.length = 0;
    const second = await window(context);
    await signIn(second, proxy.url, 'Cache', 'Reader', 'cache-test-password');
    const app = proxy.seen.filter((r) => r.path.startsWith('/app/'));
    assert.deepEqual(app.filter((r) => /\.(ts|css)\?v=/.test(r.path)), [], 'no script or style is asked for again');
    assert.ok(app.length <= 3, `only the page itself is revalidated: ${app.map((r) => `${r.status} ${r.path}`).join(', ')}`);
    assert.deepEqual(second.errors, []);
    await second.close();
  } finally {
    await browser.close();
    proxy.close();
    await hosted.close();
  }
});
