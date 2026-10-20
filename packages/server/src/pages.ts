// Error pages for browsers: a missing page, the server starting up, a server
// error, an address that needs signing in. Built on the shared design tokens
// (packages/web/tokens.css, docs/design-guide.md). Anything that isn't a
// browser asking for a page gets the bare status it always had.

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The product's name, as packages/web/src/brand.ts has it. */
export const PRODUCT_NAME = 'Tabularius';

/** The Lifted stack mark, as inline SVG (its lifted slab takes --brand). */
export const MARK = '<svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="18.5" width="26" height="6.5" rx="2.4" fill="currentColor"/><rect x="3" y="10.5" width="26" height="6.5" rx="2.4" fill="currentColor" opacity=".72"/><rect x="7" y="2.5" width="22" height="6.5" rx="2.4" fill="var(--brand)" transform="rotate(-8 18 5.75)"/></svg>';

let tokens: string | undefined;
/** The shared design tokens (packages/web/tokens.css), for pages that carry their style inline. */
export function tokenCss(): string {
  if (tokens === undefined) {
    try {
      tokens = readFileSync(join(import.meta.dirname, '..', '..', 'web', 'tokens.css'), 'utf8');
    } catch {
      tokens = ':root { --bg: #f3f5f6; --panel: #fff; --text: #1a2226; --muted: #5b676e; --line: #dde3e6; --line-strong: #c6cfd4; --brand: #0d6e7c; --brand-text: #fff; --sans: system-ui, sans-serif; }';
    }
  }
  return tokens;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The style of every simple page: one centred panel on the page background. */
export function pageCss(): string {
  return tokenCss() + `
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: var(--s5, 24px) var(--s4, 16px); box-sizing: border-box; background: var(--bg); color: var(--text); font: var(--t-md, 14px)/1.5 var(--sans); }
main { width: min(480px, 100%); padding: var(--s6, 32px); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius, 10px); box-shadow: var(--shadow-raised); }
.brand-lockup { display: flex; align-items: center; gap: 8px; margin: 0 0 var(--s5, 24px); font-size: var(--t-lg, 16px); font-weight: 650; letter-spacing: -0.01em; }
.code { margin: 0 0 4px; color: var(--muted); font-size: var(--t-sm, 13px); font-weight: 600; font-variant-numeric: tabular-nums; }
h1 { margin: 0 0 var(--s3, 12px); font-size: var(--t-2xl, 22px); font-weight: 650; letter-spacing: -0.01em; text-wrap: balance; }
p { margin: 0 0 var(--s3, 12px); color: var(--muted); }
code { font-family: var(--mono); font-size: .92em; padding: 1px 5px; border-radius: 4px; background: var(--sunken); border: 1px solid var(--line); word-break: break-all; }
nav { display: flex; flex-wrap: wrap; gap: var(--s2, 8px); margin-top: var(--s5, 24px); }
nav a { display: inline-flex; align-items: center; min-height: 34px; padding: 0 var(--s4, 16px); border-radius: var(--radius-sm, 6px); border: 1px solid var(--line-strong); background: var(--panel); color: var(--text); font-weight: 500; text-decoration: none; box-shadow: var(--shadow); transition: background-color 150ms ease-out; }
nav a:hover { background: var(--sunken); }
nav a.primary { background: var(--brand); border-color: var(--brand); color: var(--brand-text); }
nav a.primary:hover { background: var(--brand-hover); }
nav a:focus-visible { outline: none; box-shadow: var(--focus); }
@media (forced-colors: active) { nav a:focus-visible { outline: 2px solid CanvasText; outline-offset: 2px; } }
`;
}

const LINKS = '<nav aria-label="Where to go"><a class="primary" href="/app/">Open a file</a><a href="/admin/">Admin console</a></nav>';

interface PageText { title: string; body: string; links?: boolean; refresh?: number }

function text(status: number, req: IncomingMessage): PageText {
  const path = esc(new URL(req.url ?? '/', 'http://x').pathname);
  switch (status) {
    case 404: return { title: 'Page not found', body: `<p>There is no page at <code>${path}</code>. The link may be old, or the file it pointed to is no longer hosted here.</p>`, links: true };
    case 401: return { title: 'Sign in needed', body: `<p><code>${path}</code> is for apps that sign in, such as Claude Desktop or another MCP client, not for a browser. Make a token for one under AI apps in the admin console.</p>`, links: true };
    case 503: return { title: 'The server is starting', body: '<p>It is getting ready and will answer in a moment. This page tries again by itself.</p>', refresh: 3 };
    default: return { title: 'Something went wrong', body: '<p>The server hit an error while answering. Try again; if it keeps happening, the Event log in the admin console says what failed.</p>', links: true };
  }
}

/** A whole error page. */
export function errorPage(status: number, req: IncomingMessage): string {
  const t = text(status, req);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">${t.refresh ? `<meta http-equiv="refresh" content="${t.refresh}">` : ''}
<title>${esc(t.title)} · ${PRODUCT_NAME}</title><style>${pageCss()}</style></head>
<body><main><div class="brand-lockup">${MARK}<span>${PRODUCT_NAME}</span></div>
<p class="code">Error ${status}</p><h1>${esc(t.title)}</h1>${t.body}${t.links ? LINKS : ''}</main></body></html>`;
}

/** Whether a browser is asking for a page (not an app or a script asking for data). */
export function wantsPage(req: IncomingMessage): boolean {
  return (req.method === 'GET' || req.method === 'HEAD') && /text\/html/.test(req.headers.accept ?? '');
}

/** Ends the response with `status`: an error page for a browser, the bare status otherwise. */
export function sendError(req: IncomingMessage, res: ServerResponse, status: number, headers: OutgoingHttpHeaders = {}, body?: string): void {
  if (!wantsPage(req)) {
    res.writeHead(status, headers).end(body);
    return;
  }
  const html = errorPage(status, req);
  res.writeHead(status, {
    ...headers,
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  }).end(req.method === 'HEAD' ? undefined : html);
}
