// Every page the server itself writes as HTML (not the browser apps, which xss-sweep.e2e.ts walks): the sign-in and
// consent pages of the AI apps, error pages, the solution documentation and handover memo downloads, the HTML export
// and the admin console's own policy. Names a file's designer controls, text an app registers and the path in a URL
// are all hostile here; each page must keep them as text, and say so in its headers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { docsHtml } from '../src/docs.ts';
import { inlineScriptSources } from '../src/csp.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

/** Strings that would run script or add markup if a page put them in HTML as they are. */
const PAYLOADS = [
  '<img src=x onerror=__hit(1)>',
  '"><svg onload=__hit(2)>',
  "'><script>__hit(3)</script>",
  '" onmouseover="__hit(4)" x="',
  '</title><script>__hit(5)</script>',
  '<a href="javascript:__hit(6)">x</a>',
  '&lt;b&gt;&#60;i&#62;',
  'javascript:__hit(10)',
];
const ALL = PAYLOADS.join(' ');
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FORBIDDEN_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'img', 'link', 'base', 'form', 'input', 'frame', 'applet', 'math']);

/** An attribute value as a browser reads it: numeric character references are their characters. */
const decoded = (v: string) => v.replace(/&(colon|Tab|NewLine);/gi, (_, n) => (n.toLowerCase() === 'colon' ? ':' : '')).replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d))).replace(/[\t\n\r]/g, '');

/**
 * What a browser would find in `html` as markup: its tags and attributes, as problems. Empty when the page has no script
 * tag, event handler, javascript: address or tag only an author of the page would put there. `allow` lists tags a page
 * is meant to have although they are in FORBIDDEN_TAGS (the sign-in pages are forms).
 */
function markupProblems(html: string, allow: string[] = []): string[] {
  const problems: string[] = [];
  // A style block is text to a browser, except inside svg or math, where its content is parsed as markup: it may hold none.
  const page = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    if (css.includes('<')) problems.push(`markup inside a style block: ${css.slice(css.indexOf('<'), css.indexOf('<') + 40)}`);
    return '<style></style>';
  });
  for (const m of page.matchAll(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const [tag, name, attrs] = m;
    if (FORBIDDEN_TAGS.has(name.toLowerCase()) && !allow.includes(name.toLowerCase())) problems.push(`tag ${tag.slice(0, 80)}`);
    // Attributes are all name="value"; anything else is a value that broke out of its quotes.
    const rest = attrs.replace(/\s+[^\s=\/"'<>]+="[^"]*"/g, '').replace(/\s+[^\s=\/"'<>]+(?=\s|\/|$)/g, '').replace(/\//g, '').trim();
    if (rest) problems.push(`odd attribute text "${rest.slice(0, 60)}" in ${tag.slice(0, 80)}`);
    if (name.toLowerCase() === 'meta' && /\shttp-equiv\s*=/i.test(attrs) && !allow.includes('meta-refresh')) problems.push(`meta http-equiv in ${tag.slice(0, 80)}`);
    for (const a of attrs.matchAll(/\s([^\s=\/"'<>]+)="([^"]*)"/g)) {
      if (/^on/i.test(a[1])) problems.push(`event handler ${a[1]} in ${tag.slice(0, 80)}`);
      if (/^(href|src|action|formaction|xlink:href|srcdoc)$/i.test(a[1]) && /^[\s\u0000-\u001f]*(javascript|data|vbscript):/i.test(decoded(a[2]))) problems.push(`${a[1]}="${a[2].slice(0, 40)}" in ${tag.slice(0, 80)}`);
    }
  }
  return problems;
}

const inert = (html: string, label: string, allow: string[] = []) => assert.deepEqual(markupProblems(html, allow), [], label);

/** Headers every page the server writes as HTML sends. */
function assertPageHeaders(res: Response, label: string, opts: { scripts?: boolean } = {}) {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'none'|default-src 'self'/, `${label}: has a policy`);
  if (!opts.scripts) assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, `${label}: no inline scripts allowed`);
}

let dir: string;
let server: Server;
let base: string;
let store: Store;
let token: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-xss-pages-'));
  createStore(join(dir, 'X' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  base = s.url;
  store = s.host.get('X')!;
  // Every name a designer can choose, hostile where the file lets them be.
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Note' }] }] as DesignOp[]);
  const refused: string[] = [];
  PAYLOADS.forEach((p, i) => {
    for (const op of [
      { op: 'createTable', name: `T${i}${p}`, fields: [{ name: `F${i}${p}` }] },
      { op: 'createValueList', name: `V${i}${p}`, values: [p, `${p} two`] },
      { op: 'createScript', name: `S${i}${p}`, steps: [] },
    ] as DesignOp[]) {
      try { store.applyDesign([op]); } catch { refused.push(`${op.op}:${i}`); }
    }
  });
  store.create('People', { Name: ALL, Note: PAYLOADS[0] });
  store.setPassword('Admin', 'pw', '[Full Access]');
  const r = await fetch(`${base}/fmi/data/vLatest/databases/X/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}' });
  token = (await r.json()).response.token;
  assert.ok(token);
  console.log('refused names:', refused.join(' '));
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const auth = () => ({ authorization: `Bearer ${token}` });

test('the detector sees what it is meant to see', () => {
  // Text content, then an attribute value: a payload is only dangerous where it can break out.
  for (const p of PAYLOADS.slice(0, 3).concat(PAYLOADS[5])) assert.notDeepEqual(markupProblems(`<p>${p}</p>`), [], p);
  for (const p of PAYLOADS.slice(0, 6)) assert.notDeepEqual(markupProblems(`<p title="${p.replace(/^"/, '')}">x</p>`.replace('title="', 'title="a')), [], p);
  assert.notDeepEqual(markupProblems(`<p title="" onmouseover="__hit(4)" x="">x</p>`), []);
  assert.deepEqual(markupProblems('<p class="a">text &lt;img src=x onerror=1&gt;</p><a href="/docs">x</a>'), []);
  assert.notDeepEqual(markupProblems('<a href="https://x" onclick=alert(1)>x</a>'), []);
  assert.notDeepEqual(markupProblems('<a href="java&#115;cript:alert(1)">x</a>'), [], 'an entity does not hide the scheme');
  assert.notDeepEqual(markupProblems('<a href="javascript&colon;alert(1)">x</a>'), [], 'a named reference does not hide it either');
  assert.notDeepEqual(markupProblems('<a href="java&Tab;script:alert(1)">x</a>'), []);
  assert.notDeepEqual(markupProblems('<svg><style><img src=x onerror=1></style></svg>'), [], 'svg parses a style block as markup');
  assert.notDeepEqual(markupProblems('<meta http-equiv=refresh content="0;url=/x">'), []);
});

test('an error page shows the path of the request as text', async () => {
  for (const path of ['/%3Cimg%20src=x%20onerror=__hit(1)%3E', '/%22%3E%3Csvg%20onload=__hit(2)%3E', '/a/%3C%2Fcode%3E%3Cscript%3E__hit(3)%3C%2Fscript%3E', `/${encodeURIComponent(ALL)}`]) {
    const res = await fetch(base + path, { headers: { accept: 'text/html' } });
    assert.equal(res.status, 404, path);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    inert(html, path);
    assert.ok(html.includes('There is no page at'), path);
    assertPageHeaders(res, path);
    assert.doesNotMatch(res.headers.get('content-security-policy') ?? '', /script-src|unsafe-eval/);
  }
});

test('the solution documentation and handover memo downloads keep every name and the introduction as text, and are attachments', async () => {
  const docs = await fetch(`${base}/tabularius/design/v1/databases/X/docs?format=html`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ introduction: `# ${ALL}\n\n${ALL}\n\n[${ALL}](javascript:__hit(7))\n\n![${ALL}](x" onerror="__hit(8))\n\n<script>__hit(9)</script>` }),
  });
  assert.equal(docs.status, 200);
  assert.match(docs.headers.get('content-disposition') ?? '', /^attachment; filename="X_docs\.html"$/);
  assertPageHeaders(docs, 'docs');
  const page = await docs.text();
  inert(page, 'docs');
  assert.ok(page.includes('&lt;img src=x onerror=__hit(1)&gt;'), 'the payload is in the page, as text');
  // Names the designer chose, which the introduction does not repeat.
  for (const name of [`T3${PAYLOADS[3]}`, `F1${PAYLOADS[1]}`, `V4${PAYLOADS[4]}`, `S2${PAYLOADS[2]}`]) assert.ok(page.includes(esc(name)), `the name ${name.slice(0, 12)}… is in the page, as text`);
  assert.doesNotMatch(page, /<a [^>]*javascript:/i);
  const view = await fetch(`${base}/tabularius/design/v1/databases/X/docs?format=html`, { headers: auth() });
  inert(await view.text(), 'docs, GET');

  const memo = await fetch(`${base}/tabularius/assistant/v1/databases/X/handover?format=html`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ memo: `# ${ALL}\n\n| ${ALL} | b |\n|---|---|\n| ${ALL} | \`${ALL}\` |\n\n- ${ALL}\n\n\`\`\`\n${ALL}\n\`\`\`\n` }),
  });
  assert.equal(memo.status, 200, await memo.clone().text());
  assert.match(memo.headers.get('content-disposition') ?? '', /^attachment; filename="X_handover\.html"$/);
  assertPageHeaders(memo, 'memo');
  const memoPage = await memo.text();
  inert(memoPage, 'memo');
  assert.ok(memoPage.includes('&lt;img src=x onerror=__hit(1)&gt;'));
});

test('the documentation renderer keeps hostile Markdown as text in every place text goes', () => {
  const md = [`# ${ALL}`, '', `## ${ALL}`, '', ALL, '', `**${ALL}**`, '', `\`${ALL}\``, '', `> ${ALL}`, '',
    `| ${ALL} | ${ALL} |`, '|---|---|', `| ${ALL} | \`${ALL}\` |`, '',
    `- ${ALL}`, `  - ${ALL}`, '', `1. ${ALL}`, '', '```', ALL, '```', '',
    `[${ALL}](#a-b)`, `[x](javascript:__hit(1))`, `[x](//evil.example/)`, `[x](/ok" onmouseover="__hit(2))`, `[x](https://a.example/" onfocus="__hit(3))`, `[x](data:text/html,<script>__hit(4)</script>)`,
    '<a id="x"></a>', '<a id="x" onclick="__hit(5)"></a>', '<script>__hit(6)</script>'].join('\n');
  for (const opts of [{}, { guide: true, folder: '' }, { guide: true, folder: 'reference' }]) {
    for (const kind of ['Solution documentation', ALL]) {
      inert(docsHtml(md, ALL, kind, opts), JSON.stringify(opts));
    }
  }
});

test('the HTML export keeps field names and values as text', async () => {
  const r = await fetch(`${base}/tabularius/app/v1/databases/X/layouts/People/export`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ fields: ['Name', 'Note'], format: 'html', name: ALL }),
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') ?? '', /^attachment; /);
  const html = await r.text();
  inert(html, 'export');
  assert.ok(html.includes('&lt;img src=x onerror=__hit(1)&gt;'));
  assert.doesNotMatch(r.headers.get('content-disposition') ?? '', /[<>"]\s*(?:onerror|onload)/);
});

test('the AI apps\' sign-in, error and consent pages keep an app\'s name, return address, state and the typed account as text', async () => {
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url');
    return createHash('sha256').update(verifier).digest('base64url');
  };
  let checked = 0;
  for (const name of PAYLOADS) {
    const reg = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }) });
    if (reg.status !== 201) {
      // A name the server refuses is no page either; that it says so is the other fine outcome.
      assert.ok(reg.status >= 400 && reg.status < 500, `${name}: ${reg.status}`);
      continue;
    }
    const { client_id } = await reg.json() as { client_id: string };
    const params = (extra: Record<string, string> = {}) => new URLSearchParams({
      client_id, redirect_uri: redirect, response_type: 'code', code_challenge: pkce(), code_challenge_method: 'S256', state: ALL, resource: `${base}/mcp`, ...extra,
    });
    for (const [label, res] of [
      ['sign-in page', await fetch(`${base}/oauth/authorize?${params()}`)],
      ['sign-in page with a file named', await fetch(`${base}/oauth/authorize?${params({ database: ALL })}`)],
      ['refused sign-in, account typed', await fetch(`${base}/oauth/authorize`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params({ database: 'X', account: ALL, password: 'no' }), redirect: 'manual' })],
      ['bad response_type', await fetch(`${base}/oauth/authorize?${params({ response_type: ALL })}`)],
      ['unknown app', await fetch(`${base}/oauth/authorize?${params({ client_id: ALL })}`)],
      ['wrong return address', await fetch(`${base}/oauth/authorize?${params({ redirect_uri: ALL })}`)],
      ['wrong resource', await fetch(`${base}/oauth/authorize?${params({ resource: ALL })}`)],
    ] as [string, Response][]) {
      if (res.status >= 300 && res.status < 400) continue;
      const html = await res.text();
      const where = `${label}, app named ${name}`;
      assert.match(res.headers.get('content-type') ?? '', /text\/html/, where);
      inert(html, where, ['form', 'input']);
      if (label === 'sign-in page') assert.ok(html.includes(esc(name)) || res.status !== 200, `${where}: the name is on the page, as text`);
      assertPageHeaders(res, where);
      checked++;
      assert.equal(res.headers.get('x-frame-options'), 'DENY', where);
      assert.doesNotMatch(res.headers.get('content-security-policy') ?? '', /script-src|unsafe-eval/, where);
    }
  }
  assert.ok(checked >= PAYLOADS.length * 6, `${checked} pages were looked at`);
});

test('the admin console is one page whose policy allows exactly its own inline scripts', async () => {
  const res = await fetch(`${base}/admin`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const csp = res.headers.get('content-security-policy') ?? '';
  const sources = inlineScriptSources(html);
  assert.ok(sources.length >= 1, 'the page has an inline script');
  for (const s of sources) assert.ok(csp.includes(s), `the policy lists ${s}`);
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'|unsafe-eval|script-src[^;]*https?:/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  // A script in the page that is not one of its own is not allowed: its hash is not in the policy.
  const hashOf = (js: string) => `'sha256-${createHash('sha256').update(js).digest('base64')}'`;
  assert.ok(!csp.includes(hashOf('__hit(1)')));
});

test('inlineScriptSources gives a source for each inline script, byte for byte', () => {
  const js = "const a = '<b>';\nrun(a);";
  const html = `<!doctype html><script src="/x.js"></script><script type="application/json">{"a":1}</script><script>${js}</script><SCRIPT>${js} </SCRIPT><p>&lt;script&gt;nope&lt;/script&gt;</p>`;
  const got = inlineScriptSources(html);
  const hash = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  // A data block is hashed too (a browser never runs it, so the extra source allows nothing); a script with src is not.
  assert.deepEqual(got, [hash('{"a":1}'), hash(js), hash(`${js} `)]);
  assert.deepEqual(inlineScriptSources('<p>no scripts</p>'), []);
});
