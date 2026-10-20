// The admin console and the web client ship HTML with inline <script> that no
// build step ever compiles — a syntax slip (a stray brace, a botched merge)
// sails past typecheck and the test suite and only breaks in the browser, where
// nothing here would notice. These are the guards that would: every inline
// classic script must parse, and every element the admin page looks up by id
// with $('…') must actually exist on the page. Cheap, dependency-free, and they
// catch the whole class of "the console's JavaScript is dead" regressions.
//
// For a real console-error check in a browser, see `npm run smoke:web` (an
// opt-in script; it needs a Chromium, which is preinstalled in cloud sessions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const serverDir = join(import.meta.dirname, '..');
const adminPage = join(serverDir, 'admin', 'index.html');
const webDir = join(serverDir, '..', 'web');

/** Every inline <script> body that the browser runs as classic JavaScript. */
function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] ?? '';
    if (/\bsrc\s*=/.test(attrs)) continue; // external file — compiled/served elsewhere
    const type = /\btype\s*=\s*["']([^"']*)["']/.exec(attrs)?.[1]?.toLowerCase();
    // Classic scripts only. A module (type="module") is always an external src
    // here and is type-checked by tsc; data blocks (application/json, …) are not code.
    if (type && !['', 'text/javascript', 'application/javascript'].includes(type)) continue;
    if (m[2].trim()) out.push(m[2]);
  }
  return out;
}

test('every inline script on the admin page parses', () => {
  const scripts = inlineScripts(readFileSync(adminPage, 'utf8'));
  assert.ok(scripts.length >= 1, 'the admin page has inline scripts to check');
  scripts.forEach((code, i) => {
    assert.doesNotThrow(() => new vm.Script(code, { filename: `admin-inline-${i}.js` }),
      `inline admin script #${i} has a syntax error`);
  });
});

test("every id the admin page looks up with $('…') is defined on the page", () => {
  const html = readFileSync(adminPage, 'utf8');
  // The universe of ids the page defines — both static id="…" attributes and
  // ids written into template strings that build markup at runtime.
  const defined = new Set<string>();
  for (const m of html.matchAll(/id="([A-Za-z0-9_-]+)"/g)) defined.add(m[1]);
  for (const m of html.matchAll(/id='([A-Za-z0-9_-]+)'/g)) defined.add(m[1]);
  for (const m of html.matchAll(/id=`([A-Za-z0-9_-]+)`/g)) defined.add(m[1]);
  // Every literal $('id') / $("id") lookup. (Computed ids like $(`row-${n}`)
  // are not literals and are left to the runtime.)
  const missing = new Set<string>();
  for (const m of html.matchAll(/\$\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g)) {
    if (!defined.has(m[1])) missing.add(m[1]);
  }
  assert.deepEqual([...missing].sort(), [],
    `the admin page calls $('…') for ids it never defines: ${[...missing].sort().join(', ')}`);
});

test('the web client HTML: inline scripts parse and every module src exists', () => {
  let htmlFiles: string[];
  try {
    htmlFiles = readdirSync(webDir).filter((f) => f.endsWith('.html'));
  } catch {
    return; // no web package here — nothing to guard
  }
  assert.ok(htmlFiles.length >= 1, 'there are web client pages to check');
  for (const file of htmlFiles) {
    const html = readFileSync(join(webDir, file), 'utf8');
    // Any inline classic script must parse (there are none today, but guard it).
    inlineScripts(html).forEach((code, i) => {
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${file}-inline-${i}.js` }),
        `inline script #${i} in ${file} has a syntax error`);
    });
    // The web pages run external modules (tsc compiles those); make sure each
    // <script src="…"> actually points at a file that exists, so a renamed or
    // deleted entrypoint fails here instead of as a blank page in the browser.
    for (const m of html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) {
      const src = m[1];
      if (/^(https?:)?\/\//.test(src)) continue; // external URL — not ours to check
      assert.ok(existsSync(join(webDir, src)), `${file} loads a script that does not exist: ${src}`);
    }
  }
});
