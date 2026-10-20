import type { LayoutObject, LayoutPart } from './types.ts';

// Modern layouts: a layout that is one web viewer filling the window, its page (HTML, CSS and JavaScript) kept in
// the web viewer's address formula. Nothing about it is Tabularius's own, so FileMaker Pro and FileMaker Go open the
// same layout and run the same page in their web viewers.
//
// The page goes in as a text literal, base64-encoded by the formula: a raw data:text/html address breaks at the
// first # (every CSS colour) in FileMaker Pro's web viewer, and base64 keeps the page exactly as written.

/** FileMaker Pro's longest formula, in characters. */
export const FORMULA_LIMIT = 30000;

/** Where the editor starts warning that a page is close to the limit, as a share of it. */
const NEAR = 0.9;

/** What the layout editor says about a page whose address formula is `length` characters: how much room is left, and a warning near or over the limit. */
export function pageSizeNote(length: number): { text: string; level: 'ok' | 'near' | 'over' } {
  const n = length.toLocaleString(), max = FORMULA_LIMIT.toLocaleString();
  if (length > FORMULA_LIMIT) return { level: 'over', text: `${n} characters: FileMaker Pro takes formulas of up to ${max}, so this page shows only in Tabularius. Keep it smaller, or keep parts of it in a field.` };
  if (length >= FORMULA_LIMIT * NEAR) return { level: 'near', text: `${n} of FileMaker Pro's ${max} characters: close to the limit. A larger page will show only in Tabularius; keep it smaller, or keep parts of it in a field.` };
  return { level: 'ok', text: `${n} of FileMaker Pro's ${max} characters.` };
}

const PREFIX = '"data:text/html;base64," & Base64EncodeRFC ( 4648 ; ';

/** The address formula that shows `html` as the web viewer's page. */
export function pageFormula(html: string): string {
  return `${PREFIX}"${html.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/¶/g, '\\¶')}" )`;
}

/** The page an address formula made by pageFormula shows; undefined for any other formula (one built from fields). */
export function pageSource(formula: string | undefined): string | undefined {
  const f = formula?.trim();
  if (!f?.startsWith(PREFIX) || !f.endsWith('" )')) return undefined;
  const literal = f.slice(PREFIX.length, -2).trimEnd();
  if (!literal.startsWith('"') || !literal.endsWith('"') || literal.length < 2) return undefined;
  let out = '';
  const body = literal.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) out += body[++i];
    // An unescaped quote ends the literal early: the formula does more than show one page.
    else if (c === '"') return undefined;
    else out += c;
  }
  return out.replace(/\r\n?/g, '\n');
}

/** A web viewer's Web Viewer Setup for a modern layout's page: scripts and Tabularius's page calls allowed, no URL encoding. */
export const PAGE_OPTIONS = { interaction: true, findMode: false, progressBar: false, statusMessages: false, encodeUrl: false, jsBridge: true };

/**
 * A new modern layout's first page: a header with the layout's records counted, and the first few listed, read
 * through window.tabularius. In FileMaker Pro (no window.tabularius) it says where its data would come from.
 */
export function starterPage(title: string, layout: string): string {
  const name = title.replace(/[<>&]/g, '');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg: #0f172a; --card: #1e293b; --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 32px 32px 8px; }
  h1 { margin: 0; font-size: 28px; }
  .muted { color: var(--muted); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 24px 32px; }
  .tile { background: var(--card); border-radius: 16px; padding: 20px; animation: rise .5s ease both; }
  .tile b { display: block; font-size: 40px; color: var(--accent); }
  ul { list-style: none; margin: 0; padding: 0 32px 32px; }
  li { background: var(--card); border-radius: 12px; padding: 12px 16px; margin-bottom: 8px; cursor: pointer; }
  li:hover { outline: 2px solid var(--accent); }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
  @media (prefers-reduced-motion: reduce) { .tile { animation: none; } }
</style>
</head>
<body>
<header><h1>${name}</h1><p class="muted" id="where"></p></header>
<section class="tiles"><div class="tile"><span class="muted">Records</span><b id="count">–</b></div></section>
<ul id="list"></ul>
<script>
  const LAYOUT = ${JSON.stringify(layout)};
  const list = document.getElementById('list');
  async function show() {
    if (!window.tabularius) {
      document.getElementById('where').textContent = 'Shows records from ' + LAYOUT + ' when opened in Tabularius.';
      return;
    }
    const found = await tabularius.records(LAYOUT, { limit: 8 });
    document.getElementById('count').textContent = found.foundCount;
    list.replaceChildren(...found.data.map((r) => {
      const li = document.createElement('li');
      li.textContent = Object.values(r.fieldData).filter((v) => v !== '').slice(0, 3).join(' · ') || 'Record ' + r.recordId;
      return li;
    }));
  }
  show().catch((e) => (document.getElementById('where').textContent = e.message));
  if (window.tabularius) tabularius.on('refresh', () => show());
</script>
</body>
</html>
`;
}

/** A modern layout's design: one body part and one web viewer filling it, anchored on every side so it fills the window. */
export function modernDesign(title: string, layout: string, html = starterPage(title, layout)): { width: number; parts: LayoutPart[]; objects: LayoutObject[] } {
  const width = 1000;
  const height = 700;
  return {
    width,
    parts: [{ kind: 'body', kindId: 2, top: 0, height, style: {} } as LayoutPart],
    objects: [{
      id: 1, kind: 'web-viewer', type: 13, external: 'WEBV', name: 'page', style: {},
      bounds: { top: 0, left: 0, bottom: height, right: width },
      anchors: { left: true, top: true, right: true, bottom: true },
      webUrl: pageFormula(html), webOptions: { ...PAGE_OPTIONS },
    } as LayoutObject],
  };
}

/** The page of a modern layout's design (its one web viewer showing a page made by pageFormula), if it is one. */
export function modernPage(objects: LayoutObject[]): { viewer: LayoutObject; html: string } | undefined {
  const viewers = objects.filter((o) => o.kind === 'web-viewer');
  const viewer = viewers.length === 1 ? viewers[0] : undefined;
  const html = viewer && pageSource(viewer.webUrl);
  return viewer && html !== undefined ? { viewer, html } : undefined;
}
