import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { serve } from '../packages/server/src/index.ts';
import { findChromium } from './chromium.ts';
import { assembleWalkthrough, recordWalkthrough, SVG_SIZE_BUDGET, type Walkthrough } from './walkthrough.ts';

const sample = JSON.parse(readFileSync(join(import.meta.dirname, 'walkthrough-sample.json'), 'utf8')) as Walkthrough;
const browser = findChromium();

test('synthetic walkthrough records twice to identical accessible SVG bytes; missing target names its step', { timeout: 100_000, skip: browser ? false : 'no Chromium: set TABULARIUS_CHROMIUM' }, async () => {
  assert.ok(browser, 'Chromium is required for this test');
  const root = mkdtempSync(join(tmpdir(), 'tabularius-walkthrough-test-'));
  mkdirSync(join(root, 'hosted'));
  const server = await serve({ dir: join(root, 'hosted'), port: 0, watch: false, log: () => {} });
  server.host.create('Sample'); // empty synthesised solution; no fixture or personal data
  try {
    const a = join(root, 'a'), b = join(root, 'b');
    const first = await recordWalkthrough(sample, server.url, a, browser);
    const second = await recordWalkthrough(sample, server.url, b, browser);
    assert.equal(first.frames.length, sample.steps.length);
    assert.deepEqual(first.frames.map((f) => f.caption), sample.steps.map((s) => s.caption));
    assert.ok(first.frames.every((f) => f.rect.width > 0 && f.rect.height > 0));
    const svgA = assembleWalkthrough(first, a);
    const svgB = assembleWalkthrough(second, b);
    const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
    assert.equal(digest(svgA), digest(svgB), `same definition and synthetic server produce identical SVG bytes; frame hashes ${first.frames.map((f) => digest(readFileSync(join(a, f.image)))).join(',')} vs ${second.frames.map((f) => digest(readFileSync(join(b, f.image)))).join(',')}`);
    assert.ok(Buffer.byteLength(svgA) < SVG_SIZE_BUDGET);
    assert.equal((svgA.match(/class="caption"/g) ?? []).length, sample.steps.length, 'a real-text caption on each frame');
    for (const label of ['Previous step', 'Pause animation', 'Next step']) assert.match(svgA, new RegExp(`role="button" tabindex="0" aria-label="${label}"`));
    assert.match(svgA, /prefers-reduced-motion: reduce/);
    assert.match(svgA, /data:image\/webp;base64,/);
    assert.ok(readFileSync(join(a, first.frames[0].image)).length > 0, 'cropped image saved separately');
    const svgFile = join(a, 'tour.svg');
    writeFileSync(svgFile, svgA);
    const browserSession = await chromium.launch({ executablePath: browser, args: ['--no-sandbox'] });
    try {
      const page = await browserSession.newPage({ reducedMotion: 'reduce' });
      await page.goto(pathToFileURL(svgFile).href);
      assert.equal(await page.locator('.frame:visible').count(), 1);
      assert.equal(await page.locator('[data-control="pause"]').getAttribute('aria-label'), 'Play animation');
      const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
      await page.evaluate(axe);
      const violations = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: { type: 'rule', values: ['button-name', 'aria-command-name'] } }).then((r: any) => r.violations.map((v: any) => v.id)));
      assert.deepEqual(violations, [], 'SVG controls pass accessible-name checks');
      await page.locator('[data-control="next"]').click();
      assert.equal(await page.locator('.frame[data-step="1"]:visible').count(), 1);
    } finally { await browserSession.close(); }
    await assert.rejects(recordWalkthrough({ id: 'broken', steps: [sample.steps[0], { action: 'wait', target: { selector: '#does-not-exist' }, caption: 'Missing' }] }, server.url, join(root, 'broken'), browser), /Step 2: target does not exist/);
  } finally {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
