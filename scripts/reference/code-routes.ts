// The route-matching expressions in the server's source: the regular
// expressions request paths are matched against, and the literal comparisons
// on a path or path segment. Every one must be listed as an anchor of some
// group in rest/ (scripts/reference/types.ts), so a route added to the code
// can't be left out of docs/reference/rest.md unnoticed.
//
// It is a scan of the text, not of behaviour: a new HTTP method on a path that
// is already matched brings no new expression, so check the method list of a
// group when you change what a handler answers.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SERVER_SRC = join(import.meta.dirname, '..', '..', 'packages', 'server', 'src');

/**
 * Files whose path expressions aren't routes of their own: metrics.ts sorts
 * requests into kinds for its counters, cluster.ts decides which worker
 * process a request goes to, and request-gate.ts sorts requests into admission
 * classes (all of them match paths the other files serve).
 */
export const NOT_ROUTES = new Set(['metrics.ts', 'cluster.ts', 'request-gate.ts']);

const PATTERNS = [
  // A regular expression on a path: /^\/…/.exec( or /^\/…/.test(
  /\/\^\\\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n[\\])*\/[a-z]*\.(?:exec|test)\(/g,
  // A path, or a segment of one, compared with a literal.
  /\b(?:path|pathname|sub|rest|p\[\d\]|parts\[\d\])\s*===\s*'[^']*'/g,
  /\b(?:path|pathname)\.startsWith\('[^']*'\)/g,
];

/** The route-matching expressions in one source text, in order of first appearance. */
export function routeExpressions(text: string): string[] {
  const found: { at: number; text: string }[] = [];
  for (const re of PATTERNS) for (const m of text.matchAll(re)) found.push({ at: m.index, text: m[0] });
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.text))];
}

/** Every server source file with route expressions, and its expressions. */
export function codeRoutes(dir = SERVER_SRC): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()) {
    if (NOT_ROUTES.has(file)) continue;
    const found = routeExpressions(readFileSync(join(dir, file), 'utf8'));
    if (found.length) out.set(file, found);
  }
  return out;
}
