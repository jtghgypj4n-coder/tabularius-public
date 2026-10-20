// Opt-in browser smoke test: load the admin console (/admin/) and the web
// client (/app/) in a real headless Chromium and fail if either logs a
// JavaScript error, fails to load, or returns an HTTP error. This is the
// backstop behind the dependency-free parse and id guards in
// packages/server/test/admin-page.test.ts — those catch a dead script at build
// time; this catches one that only shows up once the page runs.
//
// It is NOT part of the default test suite and adds no npm dependency: it drives
// Chromium directly over the DevTools Protocol with Node's built-in WebSocket.
// It needs a Chromium binary. Cloud sessions have one preinstalled at
// /opt/pw-browsers; elsewhere, point TABULARIUS_CHROMIUM at a Chrome/Chromium
// executable. Run it with:
//
//   npm run smoke:web
//
// Exit code 0 means both pages ran clean; non-zero prints the errors found.
import { serve } from '../packages/server/src/index.ts';
import type { ChildProcess } from 'node:child_process';
import { Cdp, findChromium, launchChromium, type Listener } from './chromium.ts';
import type { Server } from 'node:http';
import { existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const PAGES = ['/admin/', '/app/'];
const PAGE_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_500; // let late errors (timers, fetch handlers) surface after load

/** Load one page in its own tab and return everything wrong with it: JS errors, a failed load, an HTTP error. */
async function checkPage(cdp: Cdp, pageUrl: string): Promise<string[]> {
  const errors: string[] = [];
  let httpStatus: number | undefined;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  let loadedResolve: (() => void) | undefined;
  const loaded = new Promise<void>((r) => (loadedResolve = r));
  const handler: Listener = (method, params, sid) => {
    if (sid !== sessionId) return;
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      errors.push(`uncaught: ${d.exception?.description ?? d.text}`);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(`console.error: ${params.args.map((a: any) => a.description ?? a.value ?? a.type).join(' ')}`);
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error' && params.entry.source === 'javascript') {
      errors.push(`log: ${params.entry.text}`);
    } else if (method === 'Network.responseReceived' && params.type === 'Document' && httpStatus === undefined) {
      httpStatus = params.response.status; // the first document response is the page itself
    } else if (method === 'Page.loadEventFired') {
      loadedResolve?.();
    }
  };
  cdp.on(handler);

  try {
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);

    const nav = await cdp.send('Page.navigate', { url: pageUrl }, sessionId);
    if (nav.errorText) errors.push(`navigation failed: ${nav.errorText}`);

    let timed = false;
    await Promise.race([loaded, new Promise<void>((r) => setTimeout(() => { timed = true; r(); }, PAGE_TIMEOUT_MS))]);
    if (timed) errors.push(`did not finish loading within ${PAGE_TIMEOUT_MS} ms`);
    await new Promise((r) => setTimeout(r, SETTLE_MS)); // catch errors thrown after load
    if (httpStatus !== undefined && httpStatus >= 400) errors.push(`HTTP ${httpStatus}`);
  } finally {
    cdp.off(handler);
    await cdp.send('Target.closeTarget', { targetId }).catch(() => { /* browser may be gone */ });
  }
  return errors;
}

async function main(): Promise<void> {
  if (!existsSync(FIXTURE)) {
    console.error('No fixture to host. Run `npm run fixtures` first.');
    process.exit(2);
  }
  const chromium = findChromium();
  if (!chromium) {
    console.error('No Chromium found. Set TABULARIUS_CHROMIUM to a Chrome/Chromium binary, or run this in a cloud session (one is preinstalled at /opt/pw-browsers).');
    process.exit(2);
  }

  const dir = mkdtempSync(join(tmpdir(), 'tabularius-smoke-'));
  const profile = mkdtempSync(join(tmpdir(), 'tabularius-smoke-chrome-'));
  let server: Server | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  const failures: Record<string, string[]> = {};

  try {
    copyFileSync(FIXTURE, join(dir, 'Charts.fmp12'));
    ({ server } = await serve({ dir, port: 0, log: () => {} }));
    const url = (server.address() as { port: number }) && `http://127.0.0.1:${(server.address() as any).port}`;

    ({ chrome, cdp } = await launchChromium(chromium, profile));
    for (const page of PAGES) {
      const full = url + page;
      process.stdout.write(`Loading ${full} … `);
      const errors = await checkPage(cdp, full);
      if (errors.length) { failures[page] = errors; console.log(`${errors.length} error(s)`); }
      else console.log('clean');
    }
  } finally {
    cdp?.close();
    chrome?.kill();
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await new Promise((r) => setTimeout(r, 300)); // let Chrome let go of its profile dir
    for (const p of [dir, profile]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* leave it for the OS */ } }
  }

  const pages = Object.keys(failures);
  if (pages.length) {
    console.error('\nBrowser smoke test FAILED — problems on:');
    for (const page of pages) for (const e of failures[page]) console.error(`  ${page}  ${e}`);
    process.exit(1);
  }
  console.log('\nBrowser smoke test passed: no JavaScript errors on', PAGES.join(' or '));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
