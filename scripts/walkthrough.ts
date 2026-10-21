// Reproducible help walkthrough capture. Only use a locally hosted, synthesised or starter solution.
// Example: node scripts/walkthrough.ts definition.json output-folder
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { serve } from '../packages/server/src/index.ts';
import { Cdp, findChromium, launchChromium } from './chromium.ts';

export const SVG_SIZE_BUDGET = 2_000_000;
const WIDTH = 800;
const HEIGHT = 450;
const VIEWPORT = { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false };
const STEP_TIMEOUT = 8_000;

export type Target = { selector: string } | { role: 'button' | 'link' | 'textbox' | 'searchbox' | 'heading'; name: string };
export type WalkthroughStep = { action: 'go' | 'click' | 'type' | 'press' | 'wait'; target: Target; caption: string; path?: string; value?: string };
export type Walkthrough = { id: string; steps: WalkthroughStep[] };
export type Rect = { x: number; y: number; width: number; height: number };
export type Frame = { caption: string; rect: Rect; image: string; step: number; action: WalkthroughStep['action'] };
export type Recording = { id: string; width: number; height: number; frames: Frame[] };

function xml(s: string): string { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!); }
function validDefinition(w: Walkthrough): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(w.id) || !w.steps?.length) throw new Error('Walkthrough needs a safe id and at least one step');
  w.steps.forEach((s, i) => {
    if (!['go', 'click', 'type', 'press', 'wait'].includes(s.action) || !s.caption?.trim() || !s.target || !('selector' in s.target ? s.target.selector : s.target.name)) throw new Error(`Invalid walkthrough step ${i + 1}`);
    if (s.action === 'go' && !s.path?.startsWith('/')) throw new Error(`Step ${i + 1}: go needs a relative path`);
    if (['type', 'press'].includes(s.action) && typeof s.value !== 'string') throw new Error(`Step ${i + 1}: ${s.action} needs a value`);
  });
}

const bootstrap = `(function(){
  const FixedDate = class extends Date { constructor(...a) { super(...(a.length ? a : ["2026-01-01T12:00:00.000Z"])); } static now() { return 1767268800000; } };
  window.Date = FixedDate;
  let state = 123456789;
  Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}::-webkit-scrollbar{display:none!important}#server{font-size:0!important}#server::after{content:"Synthetic local server";font-size:13px}#updated,#welcome-folder,#backup-folder{visibility:hidden!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.append(style), {once:true});
})();`;

// DOM lookup is deliberately strict: a missing or ambiguous target means the UI needs review.
const lookup = `(target) => {
  if (target.selector) return Array.from(document.querySelectorAll(target.selector));
  const role = target.role;
  const selector = {button:'button,[role="button"],input[type="button"],input[type="submit"]',link:'a,[role="link"]',textbox:'input:not([type]),input[type="text"],textarea,[role="textbox"]',searchbox:'input[type="search"],[role="searchbox"]',heading:'h1,h2,h3,h4,h5,h6,[role="heading"]'}[role];
  return Array.from(document.querySelectorAll(selector)).filter(e => {
    const labels = e.labels ? Array.from(e.labels).map(x => x.textContent.trim()).join(' ') : '';
    const named = e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || labels || e.getAttribute('placeholder') || e.textContent || e.value || '';
    return named.trim() === target.name;
  });
}`;

async function evaluate(cdp: Cdp, sid: string, expression: string): Promise<any> {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function targetRect(cdp: Cdp, sid: string, target: Target, step: number): Promise<Rect> {
  const end = Date.now() + STEP_TIMEOUT;
  while (Date.now() < end) {
    const found = await evaluate(cdp, sid, `(() => {const a=(${lookup})(${JSON.stringify(target)}).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'});if(a.length!==1)return {count:a.length};a[0].scrollIntoView({block:'nearest',inline:'nearest'});const r=a[0].getBoundingClientRect();return {count:1,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
    if (found.count === 1) return found.rect;
    if (found.count > 1) throw new Error(`Step ${step}: target matched ${found.count} elements`);
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`Step ${step}: target does not exist or is not visible: ${JSON.stringify(target)}`);
}
function crop(r: Rect): { x: number; y: number; width: number; height: number; scale: number } {
  const x = Math.max(0, Math.min(VIEWPORT.width - WIDTH, Math.round(r.x + r.width / 2 - WIDTH / 2)));
  const y = Math.max(0, Math.min(VIEWPORT.height - HEIGHT, Math.round(r.y + r.height / 2 - HEIGHT / 2)));
  return { x, y, width: WIDTH, height: HEIGHT, scale: 1 };
}
function frameRect(r: Rect, c: { x: number; y: number }): Rect { return { x: Math.round(r.x - c.x), y: Math.round(r.y - c.y), width: Math.round(r.width), height: Math.round(r.height) }; }
async function stableScreenshot(cdp: Cdp, sid: string, clip: ReturnType<typeof crop>, step: number): Promise<string> {
  let previous = '';
  let matches = 0;
  for (let i = 0; i < 20; i++) {
    // Wait for identical lossless paints before encoding. Small browser
    // antialiasing differences at rounded edges otherwise change WebP bytes.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false }, sid);
    matches = data === previous ? matches + 1 : 0;
    if (matches >= 2) {
      const encoded = await evaluate(cdp, sid, `(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), c => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          return canvas.toDataURL('image/webp', 0.40);
        } finally { bitmap.close(); }
      })()`);
      if (typeof encoded !== 'string' || !encoded.startsWith('data:image/webp;base64,')) throw new Error(`Step ${step}: could not encode WebP frame`);
      return encoded.slice('data:image/webp;base64,'.length);
    }
    previous = data;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Step ${step}: page did not settle for recording`);
}

/** Capture into outputDir. The caller starts a loopback product server with synthetic data. */
export async function recordWalkthrough(w: Walkthrough, origin: string, outputDir: string, chromium = findChromium()): Promise<Recording> {
  validDefinition(w);
  const base = new URL(origin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('Walkthrough recording requires a loopback HTTP server');
  if (!chromium) throw new Error('Chromium is required to record a walkthrough');
  mkdirSync(outputDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'tabularius-walkthrough-'));
  let chrome: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  try {
    ({ chrome, cdp } = await launchChromium(chromium, profile, ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text']));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT, sessionId);
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' }, sessionId);
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' }, sessionId);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    // A newly created target may stay in the background. Focus styling then
    // depends on when Chromium activates it, changing otherwise identical frames.
    await cdp.send('Page.bringToFront', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap }, sessionId);
    const frames: Frame[] = [];
    for (let i = 0; i < w.steps.length; i++) {
      const s = w.steps[i];
      const step = i + 1;
      if (s.action === 'go') {
        const url = new URL(s.path!, base);
        if (url.origin !== base.origin) throw new Error(`Step ${step}: navigation leaves the local server`);
        await cdp.send('Page.navigate', { url: url.href }, sessionId);
        const end = Date.now() + STEP_TIMEOUT;
        let ready = false;
        while (Date.now() < end) {
          const state = await evaluate(cdp, sessionId, '({url:location.href,ready:document.readyState})');
          if (state.url === url.href && state.ready === 'complete') { ready = true; break; }
          await new Promise((r) => setTimeout(r, 80));
        }
        if (!ready) throw new Error(`Step ${step}: page did not finish loading`);
      }
      const r = await targetRect(cdp, sessionId, s.target, step);
      if (s.action === 'go') {
        // The admin console polls every five seconds and can overwrite an
        // unsaved input between frames. Its own pause control keeps the
        // initial loaded state fixed while the walkthrough is recorded.
        await evaluate(cdp, sessionId, `(() => { const pause = document.querySelector('#pause-updates'); if (pause instanceof HTMLButtonElement && pause.getAttribute('aria-pressed') === 'false') pause.click(); return true })()`);
      }
      if (s.action === 'type') await evaluate(cdp, sessionId, `(() => {const e=(${lookup})(${JSON.stringify(s.target)})[0];e.focus();e.value=${JSON.stringify(s.value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      await evaluate(cdp, sessionId, 'document.fonts.ready.then(() => true)');
      const actual = s.action === 'type' ? await targetRect(cdp, sessionId, s.target, step) : r;
      const clip = crop(actual);
      const scroll = await evaluate(cdp, sessionId, '({x:scrollX,y:scrollY})');
      const data = await stableScreenshot(cdp, sessionId, { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y }, step);
      const image = `${String(step).padStart(2, '0')}.webp`;
      writeFileSync(join(outputDir, image), Buffer.from(data, 'base64'));
      frames.push({ caption: s.caption, rect: frameRect(actual, clip), image, step, action: s.action });
      if (s.action === 'click') {
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
      } else if (s.action === 'press') {
        await evaluate(cdp, sessionId, `(${lookup})(${JSON.stringify(s.target)})[0].focus()`);
        const key = s.value!;
        const code = key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Escape' ? 27 : 0;
        if (!code) throw new Error(`Step ${step}: unsupported key ${key}`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code }, sessionId);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code }, sessionId);
        // Chromium can leave :focus-visible on a number input after Escape in
        // one session and clear it in another. End Escape with a known focus
        // state so the next frame records the same pixels.
        if (key === 'Escape') await evaluate(cdp, sessionId, 'document.activeElement?.blur?.(); true');
      }
      const currentOrigin = await evaluate(cdp, sessionId, 'location.origin');
      if (currentOrigin !== base.origin) throw new Error(`Step ${step}: browser left the local server`);
    }
    const recording = { id: w.id, width: WIDTH, height: HEIGHT, frames };
    writeFileSync(join(outputDir, 'recording.json'), JSON.stringify(recording, null, 2) + '\n');
    return recording;
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { chrome!.kill('SIGKILL'); resolve(); }, 3_000);
        chrome!.once('exit', () => { clearTimeout(timer); resolve(); });
        chrome!.kill();
      });
    }
    // Chromium's child processes can still finish writing the profile after
    // the parent exits. Give their last writes time to finish before failing.
    rmSync(profile, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
}

/** A standalone SVG. Its text and controls remain DOM nodes, including in reduced motion. */
export function assembleWalkthrough(rec: Recording, frameDir: string): string {
  if (!rec.frames.length || rec.width !== WIDTH || rec.height !== HEIGHT) throw new Error('Invalid recording');
  const frames = rec.frames.map((f, i) => {
    const b64 = readFileSync(join(frameDir, f.image)).toString('base64');
    const r = f.rect;
    const show = i === 0 ? '' : ' display="none"';
    return `<g class="frame" data-step="${i}" data-cx="${Math.round(r.x + r.width / 2)}" data-cy="${Math.round(r.y + r.height / 2)}"${show}><image x="0" y="0" width="800" height="450" href="data:image/webp;base64,${b64}"/><rect x="${r.x - 4}" y="${r.y - 4}" width="${r.width + 8}" height="${r.height + 8}" rx="7" fill="none" stroke="#ffd03b" stroke-width="4"/><text x="20" y="480" class="caption">${xml(f.caption)}</text><text x="20" y="507" class="counter">Step ${i + 1} of ${rec.frames.length}</text></g>`;
  }).join('');
  const first = rec.frames[0].rect;
  const cursorX = Math.round(first.x + first.width / 2), cursorY = Math.round(first.y + first.height / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 530" aria-labelledby="walk-title walk-description"><title id="walk-title">${xml(rec.id)} walkthrough</title><desc id="walk-description">${rec.frames.length} step walkthrough with captions and playback controls</desc><style>.caption{font:20px system-ui,sans-serif;fill:#fff}.counter{font:15px system-ui,sans-serif;fill:#ddd}.control text{font:16px system-ui,sans-serif;fill:#fff}.control:focus{outline:3px solid #ffd03b}.control{cursor:pointer}.cursor{transition:transform 650ms ease}@media(prefers-reduced-motion:reduce){.cursor{transition:none}}</style><rect width="800" height="530" fill="#171717"/>${frames}<path class="cursor" d="M0 0 L0 24 L7 18 L12 29 L17 27 L12 16 L21 16 Z" fill="#fff" stroke="#171717" stroke-width="2" aria-hidden="true" style="transform:translate(${cursorX}px,${cursorY}px)"/><g class="control" role="button" tabindex="0" aria-label="Previous step" data-control="previous"><rect x="615" y="462" width="52" height="48" rx="8" fill="#343434"/><text x="631" y="492">❮</text></g><g class="control" role="button" tabindex="0" aria-label="Pause animation" data-control="pause"><rect x="673" y="462" width="52" height="48" rx="8" fill="#343434"/><text x="692" y="492">Ⅱ</text></g><g class="control" role="button" tabindex="0" aria-label="Next step" data-control="next"><rect x="731" y="462" width="52" height="48" rx="8" fill="#343434"/><text x="748" y="492">❯</text></g><script><![CDATA[(function(){const root=document.documentElement,frames=[...root.querySelectorAll('.frame')],cursor=root.querySelector('.cursor');let at=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches;const pause=root.querySelector('[data-control="pause"]');function show(n){at=(n+frames.length)%frames.length;frames.forEach((f,i)=>f.setAttribute('display',i===at?'inline':'none'));cursor.style.transform='translate('+frames[at].dataset.cx+'px,'+frames[at].dataset.cy+'px)'}function label(){pause.setAttribute('aria-label',paused?'Play animation':'Pause animation');pause.querySelector('text').textContent=paused?'▶':'Ⅱ'}label();function act(kind){if(kind==='previous')show(at-1);if(kind==='next')show(at+1);if(kind==='pause'){paused=!paused;label()}}root.querySelectorAll('[data-control]').forEach(b=>{b.addEventListener('click',()=>act(b.dataset.control));b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act(b.dataset.control)}})});setInterval(()=>{if(!paused)show(at+1)},4000);matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{paused=e.matches;label()})})()]]></script></svg>\n`;
  if (Buffer.byteLength(svg) > SVG_SIZE_BUDGET) throw new Error(`SVG exceeds ${SVG_SIZE_BUDGET} byte budget`);
  return svg;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, dir] = process.argv.slice(2);
  if (!file || !dir) { console.error('Usage: node scripts/walkthrough.ts definition.json output-folder'); process.exitCode = 2; }
  else (async () => {
    const root = mkdtempSync(join(tmpdir(), 'tabularius-walkthrough-server-'));
    const hosted = join(root, 'hosted');
    mkdirSync(hosted);
    let server: Awaited<ReturnType<typeof serve>> | undefined;
    try {
      server = await serve({ dir: hosted, port: 0, watch: false, log: () => {} });
      server.host.create('Sample');
      const rec = await recordWalkthrough(JSON.parse(readFileSync(file, 'utf8')) as Walkthrough, server.url, dir);
      const svg = assembleWalkthrough(rec, dir);
      writeFileSync(join(dir, `${rec.id}.svg`), svg);
      console.log(`${rec.frames.length} steps, ${Buffer.byteLength(svg)} SVG bytes (budget ${SVG_SIZE_BUDGET})`);
    } finally {
      if (server) await new Promise<void>((resolve) => server!.server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  })().catch((err) => { console.error(err); process.exitCode = 1; });
}
