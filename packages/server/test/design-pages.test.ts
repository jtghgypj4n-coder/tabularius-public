// The shared design tokens and the error pages built on them
// (docs/design-guide.md): the admin console's inline copy of the tokens must
// match packages/web/tokens.css, and a browser gets a page where an app gets
// the bare status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..');
/** The :root block through the dark, more-contrast and print blocks (up to the end-of-tokens comment), whitespace squeezed. */
const tokenBlocks = (css: string) => {
  const start = css.indexOf(':root {');
  const end = css.indexOf('/* end of tokens */', start);
  assert.ok(start >= 0 && end > start, 'the token blocks are closed by an end-of-tokens comment');
  return css.slice(start, end).replace(/\s+/g, ' ').trim();
};

test('the admin console carries the same design tokens as tokens.css', () => {
  const shared = readFileSync(join(root, 'web', 'tokens.css'), 'utf8');
  const admin = readFileSync(join(root, 'server', 'admin', 'index.html'), 'utf8');
  assert.match(shared, /--brand: #0d6e7c/);
  assert.equal(tokenBlocks(admin), tokenBlocks(shared));
});

test('browsers get an error page; apps get the bare status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pages-'));
  const s = await serve({ dir, port: 0, log: () => {}, mcpToken: 'a-token-for-the-test' });
  try {
    const page = await fetch(`${s.url}/no/such/page`, { headers: { accept: 'text/html,*/*' } });
    assert.equal(page.status, 404);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const html = await page.text();
    assert.match(html, /Page not found/);
    assert.match(html, /<code>\/no\/such\/page<\/code>/);
    assert.match(html, /href="\/app\/"/);

    const missing = await fetch(`${s.url}/app/nothing-here.html`, { headers: { accept: 'text/html' } });
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Page not found/);

    const app = await fetch(`${s.url}/no/such/page`);
    assert.equal(app.status, 404);
    assert.equal(await app.text(), '');

    const mcp = await fetch(`${s.url}/mcp`, { headers: { accept: 'text/html' } });
    assert.equal(mcp.status, 401);
    assert.match(await mcp.text(), /Sign in needed/);
    const wrong = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: 'Bearer wrong' } });
    assert.equal(wrong.status, 401);
    assert.match(wrong.headers.get('www-authenticate')!, /^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp", Basic realm="tabularius"$/);
    assert.deepEqual(await wrong.json(), { error: 'unauthorized' });

    const escaped = await fetch(`${s.url}/%3Cb%3Ex`, { headers: { accept: 'text/html' } });
    assert.doesNotMatch(await escaped.text(), /<b>x/);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pages keep their accessibility basics', () => {
  const admin = readFileSync(join(root, 'server', 'admin', 'index.html'), 'utf8');
  assert.match(admin, /<a class="skip" href="#content">Skip to content<\/a>/);
  assert.match(admin, /id="content" tabindex="-1"/);
  assert.match(admin, /<meta name="color-scheme" content="light dark">/);
  assert.match(admin, /aria-label="FileMaker files to host"/);
  assert.doesNotMatch(admin, /id="welcome-file"[^>]* hidden/);
  assert.match(admin, /forced-colors: active/);
  // docs/accessibility.md: the console's results are announced, and its timed lists keep focus.
  assert.match(admin, /id="health-summary" role="status"/);
  assert.match(admin, /function render\(el, html\)/);
  assert.doesNotMatch(admin, /id="welcome-status" role="status"/, 'a percentage every 500 ms is not read out');
});

test('the web client keeps its accessibility basics', () => {
  const web = join(root, 'web');
  const tokens = readFileSync(join(web, 'tokens.css'), 'utf8');
  assert.match(tokens, /\[hidden\][^{]*\{ display: none !important; \}/, 'hidden means hidden on every page');
  assert.match(tokens, /@media \(forced-colors: active\) \{ :focus-visible/);
  for (const page of ['index', 'automations', 'cleanup', 'dashboard', 'dataviewer', 'debugger', 'design', 'security']) {
    const html = readFileSync(join(web, `${page}.html`), 'utf8');
    assert.match(html, /<meta name="color-scheme" content="light dark">/, `${page}.html declares light and dark`);
    assert.match(html, /<html lang="en">/);
  }
  const main = readFileSync(join(web, 'src', 'main.ts'), 'utf8');
  assert.match(main, /h\('a', \{ class: 'skip', href: '#content' \}/);
  assert.match(main, /h\('main', \{ class: 'content', id: 'content'/);
  const menus = readFileSync(join(web, 'src', 'menubar.ts'), 'utf8');
  assert.match(menus, /case 'ArrowDown'/, 'menus work from the keyboard');
  assert.match(menus, /'aria-expanded'/);
});
