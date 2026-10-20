// r30-10: audit the existing deny-framing boundary, not a hypothetical embed API.
// Expected browser result: https://www.w3.org/TR/CSP3/#directive-frame-ancestors
// 'none' blocks every ancestor; top-level navigation remains allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { findChromium } from './harness.ts';
import { serve } from '../../server/src/index.ts';
import { listen, stubCommands } from '../../server/test/edge-test-helpers.ts';

test('r30-10: existing pages deny embedding even under hostile parents', { timeout: 55_000 }, async (t) => {
  let runningBrowser: Browser | undefined;
  let runningServer: Server | undefined;
  let dir: string | undefined;
  // Close children before the later hook checks the forbidden-command marker.
  t.after(async () => {
    try { await runningBrowser?.close(); }
    finally {
      try {
        if (runningServer) {
          runningServer.closeAllConnections();
          await new Promise<void>(resolve => runningServer!.close(() => resolve()));
        }
      } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    }
  });
  // Chromium is a child process. Only the forbidden-command stubs are on PATH;
  // their marker is asserted by the shared helper, including on failure paths.
  stubCommands(t);
  const executablePath = findChromium();
  assert.ok(executablePath, 'Chromium is required; set TABULARIUS_CHROMIUM');
  // Own the directory before awaiting startup, so a listen failure also cleans up.
  dir = mkdtempSync(join(tmpdir(), 'tabularius-embedding-'));
  const hosted = await serve({ dir, port: 0, log: () => {} }); // Empty generated host.
  runningServer = hosted.server;
  const parent = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Synthetic parent</title><p>Parent</p>');
  });
  const port = await listen(t, parent);
  const parentUrl = `http://127.0.0.1:${port}/`;
  assert.notEqual(new URL(hosted.url).origin, new URL(parentUrl).origin);
  const browser = await chromium.launch({ executablePath, timeout: 45_000, env: { ...process.env, PATH: process.env.PATH! } });
  runningBrowser = browser;

  async function context(): Promise<BrowserContext> {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    ctx.setDefaultTimeout(10_000);
    ctx.setDefaultNavigationTimeout(10_000);
    // No page request may escape the two synthetic local origins.
    await ctx.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      return [new URL(hosted.url).origin, new URL(parentUrl).origin].includes(origin) ? route.continue() : route.abort();
    });
    return ctx;
  }

  await t.test('the unembedded app still loads and carries both frame-denial headers', async () => {
    const ctx = await context();
    try {
      const page = await ctx.newPage();
      const res = await page.goto(hosted.url + '/app/');
      assert.equal(res?.status(), 200);
      assert.equal(res?.headers()['x-frame-options'], 'DENY');
      assert.match(res?.headers()['content-security-policy'] ?? '', /frame-ancestors 'none'/);
      await page.getByRole('heading', { name: 'Open a file', exact: true }).waitFor();
    } finally { await ctx.close(); }
  });

  for (const hostile of [false, true]) {
    await t.test(hostile ? 'a hostile parent cannot enable app or admin framing with query flags and messages' : 'a parent on another origin cannot frame the app', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage();
        const appScripts: string[] = [];
        page.on('request', req => { if (req.url().startsWith(hosted.url + '/app/src/')) appScripts.push(req.url()); });
        await page.goto(parentUrl);
        // Positive control: this parent can load an ordinary child document.
        await page.evaluate(async () => {
          const frame = document.createElement('iframe');
          const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
          frame.src = '/control'; document.body.append(frame); await loaded;
          if (frame.contentDocument?.title !== 'Synthetic parent') throw new Error('Control frame failed');
          frame.remove();
        });
        for (const path of hostile ? ['/app/?embed=1&token=synthetic-untrusted', '/admin/?embed=1'] : ['/app/']) {
          const blocked = page.waitForEvent('console', { predicate: msg => msg.text().includes('frame-ancestors') });
          await page.evaluate(async ({ url, hostile }) => {
            const frame = document.createElement('iframe');
            const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
            // Intentionally no parent-controlled sandbox: denial must come from the server.
            frame.src = url; document.body.append(frame);
            if (hostile) {
              for (const data of [null, 'embed', { tabularius: 'ask', id: '1', method: 'navigate', args: ['https://invalid.example/'] }]) {
                frame.contentWindow?.postMessage(data, '*'); // Deliberately hostile test sender.
              }
            }
            await loaded;
          }, { url: hosted.url + path, hostile });
          await blocked;
          assert.equal(page.frames().some(frame => frame.url() === hosted.url + path), false, 'protected document must not commit in the frame');
        }
        assert.deepEqual(appScripts, [], 'blocked app must not execute its modules');
        assert.equal(page.url(), parentUrl);
      } finally { await ctx.close(); }
    });
  }
});
