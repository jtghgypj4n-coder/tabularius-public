// Every message a person can be shown, found in the source: the text of `new SomethingError(...)` and of the calls that
// put a message on screen (`toast`, `alert`, `fail`, `plainError`). Used by scripts/error-strings.ts (the table) and by
// the test that fails when one of them reads like a fault instead of a sentence.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export type Surface = 'web client' | 'admin console' | 'command line' | 'API, MCP and SQL callers' | 'script engine' | 'conversion';

export interface ErrorString {
  text: string;
  file: string;
  line: number;
  /** The class or function the text is given to. */
  via: string;
  surface: Surface;
  /** Whether the text is built from values at run time (`{…}` stands for each). */
  built: boolean;
}

/** Why a message reads like a fault; the empty list is a sentence a person can use. */
export function problems(text: string): string[] {
  const found: string[] = [];
  if (/\bat\s+\S+\s+\(.*:\d+:\d+\)|\bat\s+\S+:\d+:\d+/.test(text)) found.push('a stack frame');
  if (/\[object \w+\]/.test(text)) found.push('[object Object]');
  if (/(^|[^\w.])(undefined|NaN)([^\w]|$)/.test(text.replace(/\{[^}]*\}/g, ''))) found.push('"undefined" or "NaN" in the text');
  if (/(^|[\s'"(=])(\/(?:usr|home|srv|var|etc|tmp|opt|root|Users|mnt|proc)\/[\w./-]*|[A-Za-z]:\\[\w.\\ -]+)/.test(text)) found.push('an absolute path');
  if (/\b(ENOENT|EACCES|EEXIST|EPERM|ENOTDIR|EISDIR|ENOSPC|EBUSY|EMFILE|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EADDRINUSE|ERR_[A-Z_]{4,})\b/.test(text)) found.push('a system error code');
  if (/\bSQLITE_[A-Z_]+|\bSQLITE error\b|\bnode:sqlite\b/.test(text)) found.push('a SQLite error name');
  if (/\b(TypeError|RangeError|ReferenceError|SyntaxError)\b|Cannot read propert/.test(text)) found.push('a JavaScript error name');
  if (/^(HTTP|status|error|code)\s*(\{[^}]*\}|\d+)\.?$/i.test(text.trim())) found.push('an HTTP status or code alone');
  if (/\b(SELECT\b[^.]*\bFROM\b|INSERT INTO|DELETE FROM|UPDATE \w+ SET|no such (column|table)|constraint failed|near ")/i.test(text)) found.push('a SQL fragment');
  if (/\b(cmsg_|cse_|user_[0-9a-z]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4})/i.test(text)) found.push('an internal id');
  if (/\b(failed|failure)\s*$/i.test(text.replace(/\{[^}]*\}/g, '').trim()) && text.replace(/\{[^}]*\}/g, '').trim().split(/\s+/).length <= 6) found.push('"failed" with no reason');
  if (/\b(you|you're) (should have|must have|forgot|did it wrong|made a mistake)\b|\byour (fault|mistake)\b|\binvalid (input|request)\b\.?$/i.test(text)) found.push('wording that blames the person');
  return found;
}

/**
 * Messages that match a pattern above and are kept, each with why. `fetch failed` is what the platform's own fetch throws,
 * which callers (and tests) match on; a person is shown networkProblem()'s sentence made from its cause instead.
 */
export const KEPT: readonly { text: string; file: string; why: string }[] = [
  { text: 'fetch failed', file: 'packages/scripts/src/net-guard.ts', why: 'the platform fetch\'s own error, matched by callers; people read networkProblem()' },
  { text: 'no such table: {name}', file: 'packages/server/src/pgwire.ts', why: 'a table of another file the account may not read must answer word for word as a table that is not there' },
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) yield full;
  }
}

/** The text of an argument that is a string, a template or a sum of them; `{…}` stands for each value put in. */
function textOf(node: ts.Expression, sf: ts.SourceFile): { text: string; built: boolean } | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, built: false };
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += `{${span.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 40)}}${span.literal.text}`;
    return { text, built: true };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = textOf(node.left, sf);
    const r = textOf(node.right, sf);
    if (l && r) return { text: l.text + r.text, built: l.built || r.built };
    if (l && !r) return { text: `${l.text}{${node.right.getText(sf).replace(/\s+/g, ' ').slice(0, 40)}}`, built: true };
    if (!l && r) return { text: `{${node.left.getText(sf).replace(/\s+/g, ' ').slice(0, 40)}}${r.text}`, built: true };
  }
  if (ts.isParenthesizedExpression(node)) return textOf(node.expression, sf);
  return undefined;
}

const SHOWN_BY = new Set(['toast', 'alert', 'plainError', 'fail', 'say']);

function surfaceOf(file: string, via: string): Surface {
  if (file === 'packages/server/admin/index.html') return 'admin console';
  if (file.endsWith('.html')) return 'web client';
  const pkg = file.split('/')[1];
  if (pkg === 'web') return /^(Admin|admin)/.test(via) || /\/admin/.test(file) ? 'admin console' : 'web client';
  if (pkg === 'cli') return 'command line';
  if (pkg === 'scripts' || pkg === 'calc') return 'script engine';
  if (pkg === 'fmp12') return 'conversion';
  if (/admin/.test(file)) return 'admin console';
  return 'API, MCP and SQL callers';
}

/** The messages that read like a fault and are not in KEPT. */
export function faults(rows: ErrorString[] = collect()): { row: ErrorString; why: string[] }[] {
  return rows.filter((r) => !KEPT.some((k) => k.text === r.text && k.file === r.file)).map((row) => ({ row, why: problems(row.text) })).filter((x) => x.why.length);
}

/** The pages that carry their own script: the admin console's page and the web client's entry pages. */
function pageScripts(): { file: string; code: string; firstLine: number }[] {
  const out: { file: string; code: string; firstLine: number }[] = [];
  const pages = [join(ROOT, 'packages/server/admin/index.html'), ...readdirSync(join(ROOT, 'packages/web')).filter((n) => n.endsWith('.html')).map((n) => join(ROOT, 'packages/web', n))];
  for (const full of pages) {
    const html = readFileSync(full, 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      out.push({ file: relative(ROOT, full), code: m[1], firstLine: html.slice(0, m.index! + m[0].indexOf('>') + 1).split('\n').length - 1 });
    }
  }
  return out;
}

export function collect(): ErrorString[] {
  const out: ErrorString[] = [];
  const sources: { file: string; code: string; firstLine: number; kind: ts.ScriptKind }[] = [];
  for (const full of walk(join(ROOT, 'packages'))) {
    const file = relative(ROOT, full);
    if (/^packages\/[^/]+\/src\//.test(file)) sources.push({ file, code: readFileSync(full, 'utf8'), firstLine: 0, kind: ts.ScriptKind.TS });
  }
  for (const page of pageScripts()) sources.push({ ...page, kind: ts.ScriptKind.JS });
  for (const { file, code, firstLine, kind } of sources) {
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node): void => {
      let via: string | undefined;
      let args: readonly ts.Expression[] = [];
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /Error$/.test(node.expression.text)) {
        via = node.expression.text;
        args = node.arguments ?? [];
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SHOWN_BY.has(node.expression.text)) {
        via = node.expression.text;
        args = node.arguments;
      }
      if (via) {
        for (const arg of args) {
          const t = textOf(arg, sf);
          if (!t) continue;
          // The first text is the message; later ones are details (a hint, a field name).
          if (/^[\w.:/-]+$/.test(t.text) && !/\s/.test(t.text) && t.text.length < 24 && !t.built) continue;
          out.push({ text: t.text, file, line: firstLine + sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, via, surface: surfaceOf(file, via), built: t.built });
          break;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

export function render(rows: ErrorString[]): string {
  const bad = faults(rows).map((x) => x.row);
  const bySurface = new Map<Surface, number>();
  for (const r of rows) bySurface.set(r.surface, (bySurface.get(r.surface) ?? 0) + 1);
  const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    '# Messages a person can be shown',
    '',
    `Generated by \`npm run docs:error-strings\` from the source. ${rows.length} messages: ${[...bySurface].map(([s, n]) => `${n} for the ${s}`).join(', ')}.`,
    '`{…}` is a value put in at run time. "Who sees it" is the surface the message belongs to; a store error can reach any of them.',
    '',
    `## Messages that read like a fault (${bad.length})`,
    '',
    '| Message | Why | Where | Who sees it |',
    '|---|---|---|---|',
    ...bad.map((r) => `| ${cell(r.text)} | ${problems(r.text).join(', ')} | ${r.file}:${r.line} | ${r.surface} |`),
    '',
    '## All messages',
    '',
    '| Message | Given to | Where | Who sees it |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.text)} | ${r.via} | ${r.file}:${r.line} | ${r.surface} |`),
    '',
  ];
  return lines.join('\n');
}
