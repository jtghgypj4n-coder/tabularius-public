// Content-Security-Policy pieces built from the page that is being sent.

import { createHash } from 'node:crypto';

/**
 * The `'sha256-...'` sources for every inline script in a page: with these as a page's only `script-src`, the page's own
 * scripts run and nothing a person's data adds to it does (an injected `<script>`, an `onerror=` or `javascript:` link).
 * A script with `src` has no source of its own here, so with this as `script-src` it is not loaded: the page must not have one
 * (the regex also reads `<script>` blocks the way a browser does only while a script holds no `<!--<script` and no `>` in an
 * attribute; the admin console loading under its policy in a browser, which its test does, is what proves they agree).
 */
export function inlineScriptSources(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    out.push(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return out;
}
