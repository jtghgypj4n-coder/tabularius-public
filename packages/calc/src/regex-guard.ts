// A time limit for regular expressions a person's formula or query supplies.
//
// JavaScript's engine backtracks, so a pattern like (a+)+$ on a long run of a's can run for years, and the server
// does everything on one thread: one such formula would stop every other person's work. Node can interrupt a
// script that runs too long (vm's timeout), regular expression matching included, so the matching runs in a
// separate context under that limit. A pattern that overruns throws RegexTimeout instead of holding the server.
//
// Each call costs about a tenth of a millisecond, so work that finds many matches (every match in a text) is done
// in batches inside the context: one call finds up to BATCH of them.

import vm from 'node:vm';
import { checkTextSize, MAX_TEXT_MATCHES, MAX_TEXT_RESULT } from './text-budget.ts';

/** A pattern that ran past its time limit and was stopped. */
export class RegexTimeout extends Error {
  readonly ms: number;
  constructor(ms: number) {
    super(`The pattern took longer than ${ms} ms and was stopped; it probably backtracks without end, so simplify it`);
    this.name = 'RegexTimeout';
    this.ms = ms;
  }
}

/** The longest one regular expression call may run. */
export const CALL_LIMIT_MS = 500;
/** The longest everything inside one withRegexBudget may run in all. */
export const BUDGET_MS = 500;
const BATCH = 500;

/** How deep groups may nest in a pattern a person supplies: PCRE2's own default limit. */
export const MAX_NESTING = 250;

/**
 * Throws a SyntaxError (what an uncompilable pattern throws anyway) for a pattern whose groups nest deeper than
 * MAX_NESTING. V8 compiles a pattern by recursion and aborts the whole process, not just the call, when thousands of
 * groups or look-arounds are nested (a 24,000-character pattern is enough), and the vm time limit cannot stop a
 * compile. Real patterns nest a handful of levels. Call this before `new RegExp(source)` on any pattern that came
 * from a formula, a query or a request.
 */
export function assertPatternNesting(source: string): void {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') i++;
    else if (inClass) inClass = c !== ']';
    else if (c === '[') inClass = true;
    else if (c === '(') {
      if (++depth > MAX_NESTING) throw new SyntaxError(`Invalid regular expression: groups are nested more than ${MAX_NESTING} deep`);
    } else if (c === ')' && depth > 0) depth--;
  }
}

// The functions that run inside the context. They are plain JavaScript text so they run under the limit.
const SOURCE = `
  const maxText = ${MAX_TEXT_RESULT}, maxMatches = ${MAX_TEXT_MATCHES};
  function size(n) { if (n > maxText) throw new RangeError('The result of the replacement would be too large'); }
  function captures(m) {
    if (!m) return 0;
    let n = 0;
    for (const s of m) n += s?.length ?? 0;
    for (const s of Object.values(m.groups ?? {})) n += s?.length ?? 0;
    size(n);
    return n;
  }
  function advance(text, at, unicode) { return at + (unicode && text.codePointAt(at) > 0xffff ? 2 : 1); }
  // ECMAScript replacement tokens, expanded incrementally before allocating.
  function rewrite(template, m, text) {
    if (!template.includes('$')) { size(template.length); return template; }
    let out = '';
    const add = (s) => { size(out.length + s.length); out += s; };
    for (let i = 0; i < template.length; i++) {
      if (template[i] !== '$' || i + 1 === template.length) { add(template[i]); continue; }
      const c = template[i + 1];
      if (c === '$') { add('$'); i++; }
      else if (c === '&') { add(m[0]); i++; }
      else if (c === String.fromCharCode(96)) { add(text.slice(0, m.index)); i++; }
      else if (c === "'") { add(text.slice(m.index + m[0].length)); i++; }
      else if (c === '<' && m.groups !== undefined && template.indexOf('>', i + 2) >= 0) {
        const end = template.indexOf('>', i + 2);
        add(m.groups[template.slice(i + 2, end)] ?? ''); i = end;
      } else if (c >= '0' && c <= '9') {
        let n = Number(c), used = 1;
        const d = template[i + 2];
        if (d >= '0' && d <= '9' && n * 10 + Number(d) > 0 && n * 10 + Number(d) < m.length) { n = n * 10 + Number(d); used = 2; }
        if (n > 0 && n < m.length) { add(m[n] ?? ''); i += used; }
        else add('$');
      } else add('$');
    }
    return out;
  }
  var fns = {
    exec(re, text, at) { re.lastIndex = at; const m = re.exec(text); captures(m); return m; },
    test(re, text) { re.lastIndex = 0; return re.test(text); },
    replace(re, text, replacement) {
      // Preserve the early conservative rejection for very large templates;
      // incremental accounting below also catches short prefix/suffix tokens.
      if (replacement.includes('$') && (text.length + 1) * replacement.length > 50000000) throw new RangeError('The result of the replacement would be too large');
      re.lastIndex = 0;
      let out = '', pos = 0, count = 0;
      const identity = replacement === '$&';
      const add = (s) => { size(out.length + s.length); out += s; };
      for (;;) {
        const m = re.exec(text);
        if (!m) break;
        if (++count > maxMatches) throw new RangeError('Too many text matches');
        if (!identity) {
          add(text.slice(pos, m.index));
          add(rewrite(replacement, m, text));
        }
        pos = m.index + m[0].length;
        if (!re.global) break;
        if (!m[0].length) re.lastIndex = advance(text, re.lastIndex, re.unicode || re.unicodeSets);
      }
      if (identity) return text;
      add(text.slice(pos));
      return out;
    },
    split(re, text) {
      re.lastIndex = 0;
      const out = text.split(re, maxMatches + 1);
      if (out.length > maxMatches) throw new RangeError('Too many text matches');
      captures(out);
      return out;
    },
    matches(re, text) {
      re.lastIndex = 0;
      const out = [];
      let length = 0;
      for (const m of text.matchAll(re)) {
        if (out.length >= maxMatches) throw new RangeError('Too many text matches');
        size(length += m[0].length);
        out.push(m[0]);
      }
      return out;
    },
    first(re, text, from, notEmpty, anchored, notEmptyAtStart) {
      for (let at = from; at <= text.length; ) {
        re.lastIndex = at;
        const m = re.exec(text);
        if (!m || (anchored && m.index !== from)) return null;
        const empty = m[0] === '';
        if (!empty || (!notEmpty && !(notEmptyAtStart && m.index === from))) { captures(m); return m; }
        if (anchored) return null;
        // Past a whole surrogate pair: a /u expression steps back to a pair's start, so one more would find this match again.
        at = m.index + (text.codePointAt(m.index) > 0xffff ? 2 : 1);
      }
      return null;
    },
    batch(re, text, from, notEmpty, anchored, notEmptyAtStart, limit) {
      const out = [];
      let at = from, chars = 0, values = 0;
      while (at <= text.length && out.length < limit) {
        const m = fns.first(re, text, at, notEmpty, anchored, notEmptyAtStart);
        if (!m) return { matches: out, next: -1 };
        size(chars += captures(m));
        if ((values += m.length + Object.keys(m.groups ?? {}).length) > 1000000) throw new RangeError('Too many regular expression captures');
        out.push(m);
        at = m.index + m[0].length + (m[0] === '' ? (text.codePointAt(m.index) > 0xffff ? 2 : 1) : 0);
      }
      return { matches: out, next: at <= text.length ? at : -1 };
    },
  };
`;

let context: vm.Context | undefined;
let call: vm.Script | undefined;
// Milliseconds of guarded regex work left in the enclosing budget; time spent outside guarded calls is not counted.
let remaining = Infinity;
let budgetMs = BUDGET_MS;

function run(op: string, ...args: unknown[]): any {
  if (typeof args[1] === 'string' && args[1].length > MAX_TEXT_RESULT) throw new RangeError('The regular expression input is too large');
  if (!context || !call) {
    context = vm.createContext({ op: '', args: [], out: undefined });
    new vm.Script(SOURCE).runInContext(context);
    call = new vm.Script('out = fns[op](...args)');
  }
  const left = remaining;
  const ms = Math.min(CALL_LIMIT_MS, left);
  if (ms <= 0) throw new RegexTimeout(budgetMs);
  const started = Date.now();
  context.op = op;
  context.args = args;
  try {
    call.runInContext(context, { timeout: Math.max(1, Math.floor(ms)) });
    return context.out;
  } catch (e) {
    // The message names the limit that ended the call: the budget when that is what was left.
    if ((e as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new RegexTimeout(left < CALL_LIMIT_MS ? budgetMs : CALL_LIMIT_MS);
    // An error made inside the context is of that context's own kinds; callers test for this realm's.
    if ((e as Error)?.name === 'RangeError') throw new RangeError((e as Error).message);
    throw e;
  } finally {
    // Nothing of the text is kept in the context between calls, a failed one included.
    context.out = undefined;
    context.args = [];
    if (remaining !== Infinity) remaining -= Date.now() - started;
  }
}

/**
 * Runs `fn`, letting every guarded call inside it share `ms` milliseconds of regex time in all (BUDGET_MS by default), so a loop
 * of slow matches can't add up to a stall either. A call past the budget throws RegexTimeout.
 */
export function withRegexBudget<T>(fn: () => T, ms = BUDGET_MS): T {
  const outer = remaining;
  const outerMs = budgetMs;
  const narrower = ms < remaining;
  if (narrower) {
    remaining = ms;
    budgetMs = ms;
  }
  try {
    return fn();
  } finally {
    // Time the inner scope used counts against the enclosing one too.
    if (narrower) remaining = outer - (ms - remaining);
    budgetMs = outerMs;
  }
}

/** re.exec(text) from `at` (a global or sticky expression). */
export const guardedExec = (re: RegExp, text: string, at = 0): RegExpExecArray | null => run('exec', re, text, at);
/** re.test(text) from the start. */
export const guardedTest = (re: RegExp, text: string): boolean => run('test', re, text);
/** text.replace(re, replacement), every match when `re` is global. */
export const guardedReplace = (re: RegExp, text: string, replacement: string): string => run('replace', re, text, replacement);
/** text.split(re). */
export const guardedSplit = (re: RegExp, text: string): string[] => run('split', re, text);
/** The text of every match of a global expression. */
export const guardedMatches = (re: RegExp, text: string): string[] => run('matches', re, text);

/** What the MBS RegEx functions need of a match: the first one at or after `from`, honouring these options. */
export interface MatchOptions { notEmpty: boolean; anchored: boolean; notEmptyAtStart: boolean }

/** The first match at or after `from`; an empty match is skipped when notEmpty, and one at `from` when notEmptyAtStart. */
export const guardedFirst = (re: RegExp, text: string, from: number, o: MatchOptions): RegExpExecArray | null =>
  run('first', re, text, from, o.notEmpty, o.anchored, o.notEmptyAtStart);

/** Every match, one after another (after an empty match the search moves on a whole character), found in batches. */
export function* guardedAll(re: RegExp, text: string, o: MatchOptions): Generator<RegExpExecArray> {
  let at = 0;
  let values = 0, chars = 0;
  while (at >= 0) {
    const { matches, next } = run('batch', re, text, at, o.notEmpty, o.anchored, o.notEmptyAtStart, BATCH) as { matches: RegExpExecArray[]; next: number };
    // Captures multiply memory even when every match is empty. Charge them
    // across batches before handing them to a caller that may retain them.
    for (const match of matches) {
      values += match.length + Object.keys(match.groups ?? {}).length;
      for (const capture of match) chars += capture?.length ?? 0;
      for (const capture of Object.values(match.groups ?? {})) chars += capture?.length ?? 0;
      checkTextSize(chars);
      if (values > 1_000_000) throw new RangeError('Too many regular expression captures');
      yield match;
    }
    at = next;
  }
}
