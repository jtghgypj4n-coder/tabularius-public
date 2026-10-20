// Opt-in visual regression check: hosts every public sample in fixtures/fmp12,
// opens each of their layouts in the web client in a headless Chromium, takes a
// PNG of the layout and compares its hash with the baseline committed for this
// platform and Chromium version (packages/web/test/visual/). A layout that
// draws differently fails the run, so a change to the renderer or the reader
// that moves pixels is seen, and either fixed or accepted with --update.
//
// NOT part of the default test suite (it needs a Chromium and takes a couple of
// minutes); no npm dependency (scripts/chromium.ts drives Chromium directly).
//
//   npm run visual                    compare with the baseline
//   npm run visual -- --update        render twice, write the baseline
//   npm run visual -- --save <dir>    also write every layout's PNG to <dir>
//   npm run visual -- --only Flicks   only the samples whose name contains this
//
// Pixels depend on the fonts installed and the Chromium version, so each
// platform and Chromium major version has its own baseline file; a run with
// none says so and passes (run --update to start one). Layouts that draw
// differently on two renders in a row (a clock, a random value) are listed as
// unsteady in the baseline and not compared. Pages make no request outside the
// local server: web viewers and remote pictures are refused.
import { serve } from '../packages/server/src/index.ts';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cdp, findChromium, launchChromium, type Listener } from './chromium.ts';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'fixtures', 'fmp12');
const BASELINES = join(ROOT, 'packages', 'web', 'test', 'visual');
const WIDTH = 1280, HEIGHT = 900;
const LOAD_TIMEOUT_MS = 20_000;
const QUIET_MS = 400; // no request in flight for this long: the layout has drawn
const ACCOUNT = 'Visual check', PASSWORD = 'visual-check';
// Stills the page: no caret, animation or transition, and no scroll bars, which differ by platform.
const STILL_CSS = '*,*::before,*::after{caret-color:transparent!important;animation:none!important;transition:none!important}::-webkit-scrollbar{display:none}';

interface Baseline { chromium: string; platform: string; layouts: Record<string, string>; unsteady: string[] }

function args(): { update: boolean; save?: string; only?: string } {
  const a = process.argv.slice(2);
  const value = (flag: string) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : undefined);
  return { update: a.includes('--update'), save: value('--save'), only: value('--only') };
}

/** One tab that signs in to a file and draws its layouts one by one. */
class Tab {
  private inFlight = new Set<string>();
  private lastActivity = Date.now();
  private loaded?: () => void;
  readonly errors: string[] = [];

  private readonly cdp: Cdp;
  private readonly sessionId: string;
  private readonly targetId: string;
  private readonly origin: string;

  private constructor(cdp: Cdp, sessionId: string, targetId: string, origin: string) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.origin = origin;
  }

  static async open(cdp: Cdp, origin: string): Promise<Tab> {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = new Tab(cdp, sessionId, targetId, origin);
    cdp.on(tab.listener);
    for (const d of ['Runtime', 'Page', 'Network']) await cdp.send(`${d}.enable`, {}, sessionId);
    // Nothing leaves the machine: only the local server's own requests go through.
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    // Fetch doesn't see WebSockets (the client uses none), so those are blocked outright.
    await cdp.send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*'] }, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' }, sessionId);
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' }, sessionId);
    return tab;
  }

  private listener: Listener = (method, params, sid) => {
    if (sid !== this.sessionId) return;
    if (method === 'Fetch.requestPaused') {
      const url = String(params.request.url);
      let local = /^(data|blob):/.test(url);
      try {
        local ||= new URL(url).origin === this.origin;
      } catch {
        // Not a URL: blocked.
      }
      void (local
        ? this.cdp.send('Fetch.continueRequest', { requestId: params.requestId }, this.sessionId)
        : this.cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, this.sessionId)).catch(() => {});
    } else if (method === 'Network.requestWillBeSent') {
      // Live updates (the events stream, who is viewing a record) stay open for good: nothing to wait for.
      if (params.type !== 'EventSource' && !/\/tabularius\/live\/v1\//.test(params.request.url)) this.inFlight.add(params.requestId);
      this.lastActivity = Date.now();
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      this.inFlight.delete(params.requestId);
      this.lastActivity = Date.now();
    } else if (method === 'Page.loadEventFired') {
      this.loaded?.();
    } else if (method === 'Runtime.exceptionThrown') {
      this.errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    }
  };

  private eval<T>(expression: string): Promise<T> {
    return this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.sessionId).then((r: any) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value as T;
    });
  }

  private async navigate(url: string): Promise<void> {
    const loaded = new Promise<void>((r) => (this.loaded = r));
    this.inFlight.clear();
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    await Promise.race([loaded, new Promise((r) => setTimeout(r, LOAD_TIMEOUT_MS))]);
    await this.quiet();
  }

  /** Waits until no request has been in flight for a while, and the fonts are in. */
  private async quiet(): Promise<void> {
    const until = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < until && (this.inFlight.size || Date.now() - this.lastActivity < QUIET_MS)) await new Promise((r) => setTimeout(r, 50));
    await this.eval('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
  }

  /** Signs in to a file as the web client does, and returns its token. */
  async signIn(db: string): Promise<string> {
    await this.navigate(`${this.origin}/app/`);
    return this.eval<string>(`(async () => {
      const r = await fetch('/fmi/data/vLatest/databases/${encodeURIComponent(db)}/sessions', { method: 'POST',
        headers: { authorization: 'Basic ' + btoa(${JSON.stringify(`${ACCOUNT}:${PASSWORD}`)}), 'content-type': 'application/json', 'x-tabularius-client': 'web' }, body: '{}' });
      const b = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(b.messages));
      return b.response.token;
    })()`);
  }

  /** Opens a layout on its first record and returns a PNG of the layout, or why it couldn't. */
  async shoot(db: string, token: string, layout: string): Promise<Buffer | string> {
    // A reload keeps the layout it was on and runs no OnFirstWindowOpen script, as for a returning window.
    await this.eval(`(() => {
      sessionStorage.setItem('tabularius.session', ${JSON.stringify(JSON.stringify({ db, token }))});
      sessionStorage.setItem('tabularius.opened', ${JSON.stringify(token)});
      sessionStorage.setItem(${JSON.stringify(`tabularius.layout.${db}`)}, ${JSON.stringify(layout)});
    })()`);
    await this.navigate(`${this.origin}/app/`);
    await this.eval(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(STILL_CSS)}; document.head.append(s); document.activeElement?.blur?.(); })()`);
    await this.quiet();
    const box = await this.eval<{ x: number; y: number; width: number; height: number } | null>(`(() => {
      const el = document.querySelector('.fm-layout');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: Math.max(r.height, el.scrollHeight) };
    })()`);
    if (!box || box.width < 1 || box.height < 1) return 'no layout drawn';
    const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(Math.min(box.width, 4000)), height: Math.ceil(Math.min(box.height, 6000)), scale: 1 };
    const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, this.sessionId);
    return Buffer.from(shot.data, 'base64');
  }

  async close(): Promise<void> {
    this.cdp.off(this.listener);
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

const hash = (png: Buffer) => createHash('sha256').update(png).digest('hex').slice(0, 32);
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');

async function main(): Promise<void> {
  const opts = args();
  const samples = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => f.endsWith('.fmp12') && (!opts.only || f.includes(opts.only))).sort() : [];
  if (!samples.length) {
    console.error('No samples to draw. Run `npm run fixtures` first.');
    process.exit(2);
  }
  const chromium = findChromium();
  if (!chromium) {
    console.error('No Chromium found. Set TABULARIUS_CHROMIUM to a Chrome/Chromium binary, or run this in a cloud session (one is preinstalled at /opt/pw-browsers).');
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-visual-'));
  const profile = mkdtempSync(join(tmpdir(), 'tabularius-visual-chrome-'));
  let server: Server | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  const shots: Record<string, string> = {};
  const unsteady = new Set<string>();
  const failed: string[] = [];
  let version = '';
  try {
    for (const f of samples) copyFileSync(join(FIXTURES, f), join(dir, f));
    const served = await serve({ dir, port: 0, log: () => {} });
    server = served.server;
    // An account that sees everything, made for the run in the throwaway copies.
    for (const name of served.host.names()) {
      const store = served.host.get(name)!;
      const full = store.privilegeSets().find((p) => p.id === 1)!;
      store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmapp'])] });
      store.setPassword(ACCOUNT, PASSWORD, full.name);
    }
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    ({ chrome, cdp } = await launchChromium(chromium, profile, ['--hide-scrollbars', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-lcd-text']));
    version = (await cdp.send('Browser.getVersion')).product as string;
    for (const name of served.host.names().sort()) {
      const store = served.host.get(name)!;
      const tab = await Tab.open(cdp, origin);
      try {
        const token = await tab.signIn(name);
        for (const l of store.layouts()) {
          if (l.file) continue; // a layout of another file
          const key = `${name}/${l.name}`;
          const first = await tab.shoot(name, token, l.name);
          if (typeof first === 'string') { failed.push(`${key}: ${first}`); continue; }
          shots[key] = hash(first);
          if (opts.update && hash((await tab.shoot(name, token, l.name)) as Buffer) !== shots[key]) unsteady.add(key);
          if (opts.save) {
            mkdirSync(opts.save, { recursive: true });
            writeFileSync(join(opts.save, `${safe(name)}--${safe(l.name)}.png`), first);
          }
          process.stdout.write('.');
        }
      } catch (e) {
        failed.push(`${name}: ${e instanceof Error ? e.message : e}`);
      } finally {
        if (tab.errors.length) failed.push(...tab.errors.map((e) => `${name}: page error ${e.split('\n')[0]}`));
        await tab.close();
      }
    }
    process.stdout.write('\n');
  } finally {
    cdp?.close();
    chrome?.kill();
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await new Promise((r) => setTimeout(r, 300));
    for (const p of [dir, profile]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* leave it for the OS */ } }
  }

  // Baseline keys are "file/layout", the file without its .fmp12.
  const ran = (key: string) => samples.some((s) => key.startsWith(`${s.replace(/\.fmp12$/i, '')}/`));
  const major = /\/(\d+)\./.exec(version)?.[1] ?? 'unknown';
  const file = join(BASELINES, `${process.platform}-${process.arch}-chromium${major}.json`);
  const count = Object.keys(shots).length;
  if (failed.length) for (const f of failed) console.error(`  couldn't draw ${f}`);
  if (opts.update) {
    // A run over some samples only keeps the others' hashes.
    const was: Baseline | undefined = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    const kept = Object.fromEntries(Object.entries(was?.layouts ?? {}).filter(([k]) => !ran(k)));
    const layouts = Object.fromEntries(Object.entries({ ...kept, ...shots }).sort(([a], [b]) => a.localeCompare(b)));
    const steadyBefore = (was?.unsteady ?? []).filter((k) => !ran(k));
    const baseline: Baseline = { chromium: version, platform: `${process.platform}-${process.arch}`, layouts, unsteady: [...new Set([...steadyBefore, ...unsteady])].sort() };
    mkdirSync(BASELINES, { recursive: true });
    writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`Baseline written: ${count} layouts (${unsteady.size} unsteady) to ${file.slice(ROOT.length + 1)}`);
    process.exit(failed.length ? 1 : 0);
  }
  if (!existsSync(file)) {
    console.log(`Drew ${count} layouts. No baseline for ${process.platform}-${process.arch} with Chromium ${major} yet: run \`npm run visual -- --update\` to start one.`);
    process.exit(failed.length ? 1 : 0);
  }
  const baseline: Baseline = JSON.parse(readFileSync(file, 'utf8'));
  const skip = new Set(baseline.unsteady);
  const changed = Object.keys(shots).filter((k) => !skip.has(k) && baseline.layouts[k] !== undefined && baseline.layouts[k] !== shots[k]);
  const added = Object.keys(shots).filter((k) => baseline.layouts[k] === undefined);
  const gone = Object.keys(baseline.layouts).filter((k) => shots[k] === undefined && ran(k));
  for (const k of changed) console.error(`  draws differently: ${k}`);
  for (const k of added) console.log(`  new (not in the baseline): ${k}`);
  for (const k of gone) console.error(`  no longer drawn: ${k}`);
  if (changed.length || gone.length || failed.length) {
    console.error(`\nVisual check FAILED: ${changed.length} changed, ${gone.length} gone, ${failed.length} not drawn, of ${count}. Look at them with --save <dir>; if the change is right, run with --update.`);
    process.exit(1);
  }
  console.log(`Visual check passed: ${count} layouts draw as in the baseline (${skip.size} unsteady not compared).`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
