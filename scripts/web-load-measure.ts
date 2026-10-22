// Measures how the web client's scripts and styles arrive on a first visit (cold) and on a second visit with the
// browser's cache kept (warm), in a real Chromium: how many requests reach the server, how many of those the
// server answers 200 or 304, and how long until the sign-in form is up. The browser's own cache answers the rest.
//
//   npm run measure:web-load
//
// The service worker is blocked so its own requests (which the network throttle does not reach) do not hide the cost.
// It needs a Chromium (see packages/web/e2e/harness.ts). The numbers depend on the machine, so nothing asserts
// on times; packages/web/e2e/module-caching.e2e.ts asserts on the request counts.
import { host, launch, window } from '../packages/web/e2e/harness.ts';
import { countRequests, type RequestCounter } from '../packages/web/e2e/request-counter.ts';

type Profile = { name: string; latency: number; down: number; up: number };
const PROFILES: Profile[] = [
  { name: 'local network', latency: 0, down: -1, up: -1 },
  { name: 'broadband (40 ms, 10 Mbit/s)', latency: 40, down: 10_000_000 / 8, up: 5_000_000 / 8 },
  { name: 'slow mobile (150 ms, 1.5 Mbit/s)', latency: 150, down: 1_500_000 / 8, up: 750_000 / 8 },
];

interface Visit { ms: number; loaded: number; requests: number; fetched: number; revalidated: number; bytes: number }

async function visit(page: Awaited<ReturnType<typeof window>>, proxy: RequestCounter, profile: Profile): Promise<Visit> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.down, uploadThroughput: profile.up });
  proxy.seen.length = 0;
  const started = Date.now();
  await page.goto(`${proxy.url}/app/`);
  const loaded = Date.now() - started; // every script has run
  await page.locator('select[name="db"]').waitFor({ timeout: 60_000 });
  const ms = Date.now() - started;
  await page.waitForTimeout(300);
  await cdp.detach();
  const mine = proxy.seen.filter((r) => r.path.startsWith('/app/'));
  return { ms, loaded, requests: mine.length, fetched: mine.filter((r) => r.status === 200).length, revalidated: mine.filter((r) => r.status === 304).length, bytes: mine.reduce((n, r) => n + r.bytes, 0) };
}

const RUNS = 5;
const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]!;

const hosted = await host({ stores: ['Probe'] });
const proxy = await countRequests(hosted.url);
const browser = await launch();
try {
  console.log(`Web client load, (median of ${RUNS} visits; every /app/ request counted)`);
  for (const profile of PROFILES) {
    const cold: Visit[] = [];
    const warm: Visit[] = [];
    for (let i = 0; i < RUNS; i++) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      cold.push(await visit(await window(context), proxy, profile));
      // A second visit in a new tab, not a reload: a reload is allowed to revalidate everything.
      warm.push(await visit(await window(context), proxy, profile));
      await context.close();
    }
    console.log(`\n${profile.name}`);
    for (const [label, runs] of [['cold', cold], ['warm', warm]] as const) {
      const last = runs[runs.length - 1]!;
      console.log(`  ${label}: scripts run after ${String(median(runs.map((v) => v.loaded))).padStart(5)} ms, sign-in form up after ${String(median(runs.map((v) => v.ms))).padStart(5)} ms  ${String(last.requests).padStart(3)} server requests  (${last.fetched} sent in full, ${last.revalidated} revalidated with 304)  ${Math.round(last.bytes / 1024)} KiB on the wire`);
    }
  }
} finally {
  await browser.close();
  proxy.close();
  await hosted.close();
}
