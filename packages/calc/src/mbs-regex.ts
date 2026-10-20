import { ENTRY_BYTES, RetainedMap, retainedBudget, stringBytes } from './retained-budget.ts';

// MBS ( "RegEx.…" ): MonkeyBread's regular expressions (PCRE patterns and options), run on JavaScript's engine.
// Behaviour follows MBS's own function pages (mbsplugins.eu). Patterns are translated from PCRE to JavaScript:
// what JavaScript can't do (possessive quantifiers, atomic groups, recursion, inline options other than at the
// start, partial matching) is refused with an MBS error rather than matched differently.

import { MbsError } from './mbs-text.ts';
import { assertPatternNesting, guardedAll, guardedFirst } from './regex-guard.ts';
import { checkTextSize, joinText, MAX_TEXT_MATCHES } from './text-budget.ts';

// --- options --------------------------------------------------------------------------
// PCRE's option bits, as MBS documents them. Given as a number (their sum) or as names separated by returns,
// commas or spaces ("caseless¶greedy", "MultiLine NewLineAny CaseLess"), in any case.

const OPTION: Record<string, number> = {
  caseless: 1, casesensitive: 0, multiline: 2, singleline: 0, dotall: 4, extended: 8, anchored: 16, dollarendonly: 32,
  notbol: 128, noteol: 256, ungreedy: 512, greedy: 0, notempty: 1024, empty: 0, autocapture: 0, noautocapture: 4096,
  autocallout: 16384, noautocallout: 0, partial: 32768, firstline: 0x40000, dupnames: 0x80000,
  newlinecr: 0x100000, newlinelf: 0x200000, newlinecrlf: 0x300000, newlineany: 0x400000, newlineanycrlf: 0x500000,
  bsranycrlf: 0x800000, bsrunicode: 0x1000000, javascriptcompatible: 0x2000000, nostartoptimize: 0x4000000,
  partialhard: 0x8000000, notemptyatstart: 0x10000000, ucp: 0x20000000,
};
const CASELESS = 1, MULTILINE = 2, DOTALL = 4, EXTENDED = 8, ANCHORED = 16, DOLLARENDONLY = 32, NOTBOL = 128, NOTEOL = 256, UNGREEDY = 512,
  NOTEMPTY = 1024, NOAUTOCAPTURE = 4096, NOTEMPTYATSTART = 0x10000000, UCP = 0x20000000;
/** Options Tabularius can't honour: a pattern asking for them is refused. */
const UNSUPPORTED: [number, string][] = [
  [NOTBOL, 'NotBOL'], [NOTEOL, 'NotEOL'], [16384, 'AutoCallout'], [32768, 'Partial'], [0x8000000, 'PartialHard'], [0x40000, 'FirstLine'],
];

/**
 * Options as a number. `replaceDefault`: the Replace, ReplaceAll and Extract pages say "Default options are non
 * greedy", and their examples bear it out: with no options, or names without "greedy", quantifiers are lazy.
 * A number is PCRE's own bits, so 0 there is greedy (inferred: the Extract page's example with options 1 matches greedily).
 */
export function optionsOf(raw: string | undefined, replaceDefault = false): number {
  const s = (raw ?? '').trim();
  if (s === '') return replaceDefault ? UNGREEDY : 0;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Math.trunc(Number(s));
  let bits = replaceDefault ? UNGREEDY : 0;
  for (const name of s.split(/[\r\n,\s]+/).filter(Boolean)) {
    const key = name.toLowerCase();
    if (!(key in OPTION)) throw new MbsError(`Unknown regular expression option "${name}"`);
    if (key === 'greedy') bits &= ~UNGREEDY;
    else bits |= OPTION[key];
  }
  return bits;
}

// --- PCRE to JavaScript ------------------------------------------------------------------

// Without UCP, PCRE's classes are ASCII only; with it, letters, digits and spaces of every script.
const PUNCT = '!-\\/:-@\\[-`{-~';
const SPACE = '\\t\\n\\x0b\\f\\r ';
const POSIX: Record<string, string> = {
  alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', space: SPACE, upper: 'A-Z', lower: 'a-z', punct: PUNCT,
  xdigit: '0-9A-Fa-f', word: 'A-Za-z0-9_', blank: ' \\t', cntrl: '\\x00-\\x1f\\x7f',
};
const POSIX_UCP: Record<string, string> = {
  ...POSIX, alpha: '\\p{L}', digit: '\\p{Nd}', alnum: '\\p{L}\\p{N}', space: '\\s', upper: '\\p{Lu}', lower: '\\p{Ll}',
  punct: '\\p{P}' + PUNCT, word: '\\p{L}\\p{N}_',
};
// What JavaScript's \s matches beyond ASCII: without UCP these aren't spaces, so \S has to take them in.
const WIDE_SPACE = '\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff';
// PCRE's \h and \v.
const HSPACE = '\\t \\u00a0\\u1680\\u180e\\u2000-\\u200a\\u202f\\u205f\\u3000';
const VSPACE = '\\n\\x0b\\f\\r\\x85\\u2028\\u2029';
/** Characters JavaScript's u mode lets you escape (others, like \- outside a class, are syntax errors there). */
const SYNTAX = '^$\\.*+?()[]{}|/';

interface Translated { source: string; flags: string; groups: number; names: Map<string, number> }

export function translate(pattern: string, options: number): Translated {
  if (pattern.length > 32768) throw new MbsError('The pattern is too long');
  for (const [bit, name] of UNSUPPORTED) if (options & bit) throw new MbsError(`The ${name} option isn't available in Tabularius`);
  let p = pattern;
  let caseless = (options & CASELESS) !== 0;
  let multiline = (options & MULTILINE) !== 0;
  let dotall = (options & DOTALL) !== 0;
  let extended = (options & EXTENDED) !== 0;
  let ungreedy = (options & UNGREEDY) !== 0;
  // Leading inline options, (?i) (?ms) and so on, apply to the whole pattern; anywhere else JavaScript can't scope them.
  for (let m; (m = /^\(\?([imsxU]+)\)/.exec(p)); p = p.slice(m[0].length)) {
    for (const c of m[1]) {
      if (c === 'i') caseless = true;
      else if (c === 'm') multiline = true;
      else if (c === 's') dotall = true;
      else if (c === 'x') extended = true;
      else ungreedy = true;
    }
  }
  const ucp = (options & UCP) !== 0;
  const dollarEndOnly = (options & DOLLARENDONLY) !== 0;
  const capture = (options & NOAUTOCAPTURE) === 0;
  let out = '';
  let groups = 0;
  const names = new Map<string, number>();
  let inClass = false;
  let classStart = false;
  /** Whether the last thing written in a class was a set of characters (a "-" after one is a literal "-"). */
  let afterSet = false;
  /** Whether the last thing written can take a quantifier. */
  let atom = false;
  const fail = (what: string): never => {
    throw new MbsError(`${what} isn't available in Tabularius's regular expressions`);
  };
  const quantifierAt = (i: number) => /^(\*|\+|\?|\{\d+(,\d*)?\})/.exec(p.slice(i))?.[0];
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (inClass) {
      if (c === ']' && !classStart) {
        inClass = false;
        out += ']';
        atom = true;
        continue;
      }
      classStart = false;
      if (c === '-' && afterSet) {
        out += '\\-';
        afterSet = false;
        continue;
      }
      afterSet = false;
      if (c === '[' && p[i + 1] === ':') {
        const m = /^\[:(\^?)([a-z]+):\]/.exec(p.slice(i));
        if (m && POSIX[m[2]] && !m[1]) {
          if (caseless && ucp && (m[2] === 'upper' || m[2] === 'lower')) fail(`[:${m[2]}:] with Caseless`);
          out += (ucp ? POSIX_UCP : POSIX)[m[2]];
          i += m[0].length - 1;
          afterSet = true;
          continue;
        }
        if (m) fail(`The class [:${m[1]}${m[2]}:]`);
        out += '\\[';
        continue;
      }
      if (c === '[') {
        out += '\\[';
        continue;
      }
      if (c === '\\') {
        const [text, used, , isSet] = escape(p, i, true, { ucp, caseless }, fail);
        out += text;
        i += used - 1;
        afterSet = isSet ?? false;
        continue;
      }
      out += c;
      continue;
    }
    // Extended mode skips ASCII white space only, as PCRE does.
    if (extended && /[\t\n\x0b\f\r ]/.test(c)) continue;
    if (extended && c === '#') {
      while (i < p.length && p[i] !== '\n' && p[i] !== '\r') i++;
      continue;
    }
    if (c === '\\') {
      if (p[i + 1] === 'Q') {
        const end = p.indexOf('\\E', i + 2);
        const literal = p.slice(i + 2, end < 0 ? p.length : end);
        out += [...literal].map((x) => (SYNTAX.includes(x) ? '\\' + x : x)).join('');
        i = end < 0 ? p.length : end + 1;
        atom = literal.length > 0;
        continue;
      }
      const [text, used, isAtom] = escape(p, i, false, { ucp, caseless }, fail);
      out += text;
      i += used - 1;
      atom = isAtom;
      continue;
    }
    if (c === '[') {
      if (/^\[:\^?[a-z]+:\]/.test(p.slice(i))) throw new MbsError('POSIX classes such as [:alpha:] work only inside [ ]');
      inClass = true;
      classStart = true;
      afterSet = false;
      out += '[';
      if (p[i + 1] === '^') {
        out += '^';
        i++;
      }
      // A ] straight after [ or [^ is a literal one.
      if (p[i + 1] === ']') {
        out += '\\]';
        i++;
        classStart = false;
      }
      continue;
    }
    if (c === '(') {
      atom = false;
      if (p[i + 1] !== '?') {
        if (capture) groups++;
        out += capture ? '(' : '(?:';
        continue;
      }
      const rest = p.slice(i);
      const named = /^\(\?(?:P?<([A-Za-z_]\w*)>|'([A-Za-z_]\w*)')/.exec(rest);
      if (named) {
        groups++;
        names.set(named[1] ?? named[2], groups);
        out += `(?<${named[1] ?? named[2]}>`;
        i += named[0].length - 1;
        continue;
      }
      const backref = /^\(\?P=([A-Za-z_]\w*)\)/.exec(rest);
      if (backref) {
        out += `\\k<${backref[1]}>`;
        i += backref[0].length - 1;
        atom = true;
        continue;
      }
      if (/^\(\?(:|=|!|<=|<!)/.test(rest)) {
        const m = /^\(\?(:|=|!|<=|<!)/.exec(rest)!;
        out += m[0];
        i += m[0].length - 1;
        continue;
      }
      if (rest.startsWith('(?#')) {
        const end = p.indexOf(')', i);
        i = end < 0 ? p.length : end;
        continue;
      }
      if (rest.startsWith('(?>')) fail('An atomic group (?>…)');
      if (/^\(\?(R|\d|[+-]\d|&|P>)/.test(rest)) fail('Recursion');
      if (rest.startsWith('(?|')) fail('A branch reset group (?|…)');
      if (rest.startsWith('(?(')) fail('A conditional group');
      fail(`The group "${rest.slice(0, 6)}…"`);
    }
    if (c === ')') {
      out += ')';
      atom = true;
      continue;
    }
    const q = quantifierAt(i);
    if (q && atom) {
      out += q;
      i += q.length;
      const next = p[i];
      if (next === '+') fail('A possessive quantifier');
      const lazy = next === '?';
      if (lazy) i++;
      // Ungreedy flips laziness: a plain quantifier is lazy, and a ? after one makes it greedy.
      if (lazy !== ungreedy) out += '?';
      i--;
      atom = false;
      continue;
    }
    if (c === '.' && !dotall) {
      // PCRE's dot stops only at its newline; JavaScript's at \r and \n both, which FileMaker's \r line ends want.
      out += '.';
      atom = true;
      continue;
    }
    if (c === '{' || c === '}') {
      out += '\\' + c;
      atom = true;
      continue;
    }
    if (c === '$' && !multiline && !dollarEndOnly) {
      // PCRE's $ also matches before a newline that ends the text.
      out += '(?=\\n?(?![\\s\\S]))';
      atom = false;
      continue;
    }
    out += c;
    atom = c !== '|' && c !== '^' && c !== '$';
  }
  if (inClass) throw new MbsError('Missing ] in the pattern');
  const flags = 'u' + (caseless ? 'i' : '') + (multiline ? 'm' : '') + (dotall ? 's' : '');
  try {
    assertPatternNesting(out);
    new RegExp(out, flags);
  } catch (e) {
    throw new MbsError(`The pattern can't be compiled: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}`);
  }
  return { source: out, flags, groups, names };
}

/**
 * One escape at p[i] ("\…"): its JavaScript, how many characters it used, whether it can take a quantifier, and
 * (in a class) whether it stands for a set of characters.
 */
function escape(p: string, i: number, inClass: boolean, mode: { ucp: boolean; caseless: boolean }, fail: (what: string) => never): [string, number, boolean, boolean?] {
  const { ucp, caseless } = mode;
  const c = p[i + 1];
  if (c === undefined) throw new MbsError('The pattern ends with a backslash');
  const rest = p.slice(i + 1);
  if (/[1-9]/.test(c)) {
    if (inClass) {
      // In a class, \1 to \7 start an octal number (in UTF mode \400 is U+0100); \8 and \9 are the digits themselves.
      const oct = /^[0-7]{1,3}/.exec(rest)?.[0];
      return oct ? [`\\u{${parseInt(oct, 8).toString(16)}}`, 1 + oct.length, true] : [c, 2, true];
    }
    const n = /^\d+/.exec(rest)![0];
    return [`\\${n}`, 1 + n.length, true];
  }
  if (c === '0') {
    const oct = /^0[0-7]{0,2}/.exec(rest)![0];
    return [`\\x${parseInt(oct, 8).toString(16).padStart(2, '0')}`, 1 + oct.length, true];
  }
  if (c === 'x') {
    const braced = /^x\{([0-9a-fA-F]+)\}/.exec(rest);
    if (braced) return [`\\u{${braced[1]}}`, 1 + braced[0].length, true];
    const two = /^x([0-9a-fA-F]{1,2})/.exec(rest);
    return [two ? `\\x${two[1].padStart(2, '0')}` : '\\x00', 1 + (two ? two[0].length : 1), true];
  }
  if (c === 'o') {
    const braced = /^o\{([0-7]+)\}/.exec(rest);
    if (braced) return [`\\u{${parseInt(braced[1], 8).toString(16)}}`, 1 + braced[0].length, true];
  }
  if (c === 'p' || c === 'P') {
    const prop = /^[pP](\{\^?[A-Za-z_ ]+\}|[A-Za-z])/.exec(rest);
    if (!prop) throw new MbsError('Malformed \\p in the pattern');
    let name = prop[1].replace(/[{}]/g, '');
    let negate = c === 'P';
    if (name.startsWith('^')) {
      name = name.slice(1);
      negate = !negate;
    }
    // PCRE's script names (Greek, Latin) are Script= in JavaScript; categories (L, Lu, N) stay as they are.
    const js = /^(L|Lu|Ll|Lt|Lm|Lo|M|Mn|Mc|Me|N|Nd|Nl|No|P|Pc|Pd|Ps|Pe|Pi|Pf|Po|S|Sm|Sc|Sk|So|Z|Zs|Zl|Zp|C|Cc|Cf|Co|Cn|Cs|Any|L&)$/.test(name)
      ? (name === 'L&' ? 'LC' : name === 'Any' ? 'Any' : name) : `Script=${name}`;
    // JavaScript lets caseless \p{Lu} match lower case letters; PCRE doesn't, so that pairing is refused.
    if (caseless && /^(Lu|Ll|Lt)$/.test(js)) fail(`\\${c}{${name}} with Caseless`);
    if (js === 'Any') {
      if (negate) fail(`\\${c}{${name}}`);
      return [inClass ? '\\s\\S' : '[\\s\\S]', 1 + prop[0].length, true, true];
    }
    return [`\\${negate ? 'P' : 'p'}{${js}}`, 1 + prop[0].length, true, true];
  }
  const simple: Record<string, string> = { a: '\\x07', e: '\\x1b', f: '\\f', n: '\\n', r: '\\r', t: '\\t' };
  if (simple[c]) return [simple[c], 2, true];
  if (c === 'c') return [`\\c${p[i + 2] ?? ''}`, 3, true];
  if (c === 's' || c === 'S') {
    // With UCP, JavaScript's own \s; without it, ASCII white space only.
    if (ucp) return ['\\' + c, 2, true, true];
    if (c === 's') return [inClass ? SPACE : `[${SPACE}]`, 2, true, true];
    return [inClass ? `\\S${WIDE_SPACE}` : `[\\S${WIDE_SPACE}]`, 2, true, true];
  }
  if (c === 'w' || c === 'W' || c === 'd' || c === 'D') {
    if (!ucp) return ['\\' + c, 2, true, true];
    // UCP: \w and \d cover every script's letters and digits.
    const set = c === 'w' || c === 'W' ? '\\p{L}\\p{N}_' : '\\p{Nd}';
    if (inClass) {
      if (c === 'W' || c === 'D') fail(`\\${c} inside a class with UCP`);
      return [set, 2, true, true];
    }
    return [c === 'w' || c === 'd' ? `[${set}]` : `[^${set}]`, 2, true];
  }
  if (c === 'h' || c === 'v') {
    const set = c === 'h' ? HSPACE : VSPACE;
    return [inClass ? set : `[${set}]`, 2, true, true];
  }
  if (c === 'H' || c === 'V') {
    if (inClass) fail(`\\${c} inside a class`);
    return [`[^${c === 'H' ? HSPACE : VSPACE}]`, 2, true];
  }
  if (!inClass) {
    if (c === 'A') return ['(?<![\\s\\S])', 2, false];
    if (c === 'z') return ['(?![\\s\\S])', 2, false];
    if (c === 'Z') return ['(?=\\n?(?![\\s\\S]))', 2, false];
    if (c === 'R') return ['(?:\\r\\n|[\\n\\v\\f\\r\\x85\\u2028\\u2029])', 2, true];
    if (c === 'b' || c === 'B') return ['\\' + c, 2, false];
    if (c === 'G') fail('\\G');
    if (c === 'K') fail('\\K');
    if (c === 'g' || c === 'k') {
      const ref = /^[gk](?:\{(-?\w+)\}|<(\w+)>|'(\w+)'|(-?\d+))/.exec(rest);
      if (!ref) throw new MbsError(`Malformed \\${c} in the pattern`);
      const target = ref[1] ?? ref[2] ?? ref[3] ?? ref[4];
      if (/^\d+$/.test(target)) return [`\\${target}`, 1 + ref[0].length, true];
      if (/^-/.test(target)) fail('A relative back reference');
      return [`\\k<${target}>`, 1 + ref[0].length, true];
    }
  } else if (c === 'b') return ['\\x08', 2, true];
  // Any other escaped character is that character.
  if (/[A-Za-z]/.test(c)) fail(`\\${c}`);
  const cp = String.fromCodePoint(rest.codePointAt(0)!);
  return [SYNTAX.includes(cp) || (inClass && cp === '-') ? '\\' + cp : cp, 1 + cp.length, true];
}

// --- matching -------------------------------------------------------------------------

/** What Execute leaves for Substring, Results and the rest: the captures and where they are, not the text searched. */
interface Last { index: number; captures: (string | undefined)[]; indices: ([number, number] | undefined)[]; named: Record<string, string | undefined> }
interface Compiled { pattern: string; options: number; re: RegExp; withIndices?: RegExp; groups: number; names: Map<string, number>; last?: Last | null }

export function compileRegex(pattern: string, options: number): Compiled {
  const t = translate(pattern, options);
  return { pattern, options, re: new RegExp(t.source, t.flags + (options & ANCHORED ? 'y' : 'g')), groups: t.groups, names: t.names };
}

// A capture is a slice of the text searched and can keep all of it alive; a copy holds only the capture.
const own = (s: string | undefined) => (s !== undefined && s.length > 12 ? Buffer.from(s, 'utf16le').toString('utf16le') : s);

/**
 * The first match at or after `from`, honouring Anchored, NotEmpty and NotEmptyAtStart (an empty match at `from`).
 * `indices`: Execute's match, which needs each group's offsets.
 */
function execAt(c: Compiled, text: string, from: number, options = c.options, indices = false): RegExpExecArray | null {
  checkOptions(options);
  const re = indices ? (c.withIndices ??= new RegExp(c.re.source, c.re.flags + 'd')) : c.re;
  // Under a time limit: a pattern that backtracks without end throws RegexTimeout instead of holding the server.
  return guardedFirst(re, text, from, matchOptions(options));
}
function checkOptions(options: number): void {
  for (const [bit, name] of UNSUPPORTED) if (options & bit) throw new MbsError(`The ${name} option isn't available in Tabularius`);
}
const matchOptions = (options: number) => ({ notEmpty: (options & NOTEMPTY) !== 0, anchored: (options & ANCHORED) !== 0, notEmptyAtStart: (options & NOTEMPTYATSTART) !== 0 });

/** Whether the expression matches somewhere in the text, with these execute options (List.RegExMatch). */
export const regexMatches = (c: Compiled, text: string, options: number): boolean => execAt(c, text, 0, options) !== null;

/**
 * Every match, one at a time. After an empty match the search moves on a character (a whole surrogate pair) so the
 * loop ends; Anchored means anchored at each new place, so the matches have to follow on from each other.
 */
function* allMatches(c: Compiled, text: string, options = c.options): Generator<RegExpExecArray> {
  checkOptions(options);
  yield* guardedAll(c.re, text, matchOptions(options));
}

/** A rewrite: \0 to \9 are the match and its groups, \\ a backslash; anything else is as written. */
function rewrite(template: string, m: RegExpExecArray): string {
  let size = template.length;
  checkTextSize(size);
  return template.replace(/\\([0-9\\])/g, (_, d: string) => {
    const part = d === '\\' ? '\\' : m[Number(d)] ?? '';
    size += part.length - 2;
    checkTextSize(size);
    return part;
  });
}

function replace(text: string, c: Compiled, template: string, all: boolean, skip: number): string {
  let out = '';
  let pos = 0;
  let n = 0;
  for (const m of allMatches(c, text)) {
    if (++n > MAX_TEXT_MATCHES) throw new RangeError('Too many text matches');
    if (n <= skip) continue;
    const part = rewrite(template, m);
    checkTextSize(out.length + m.index - pos + part.length);
    out += text.slice(pos, m.index) + part;
    pos = m.index + m[0].length;
    if (!all) break;
  }
  checkTextSize(out.length + text.length - pos);
  return out + text.slice(pos);
}

function captureBytes(last: Pick<Last, 'captures' | 'named'> | null | undefined): number {
  if (!last) return 0;
  let chars = 0, bytes = 0;
  for (const capture of last.captures) chars += capture?.length ?? 0;
  checkTextSize(chars + Math.max(0, last.captures.length - 1));
  for (const [name, capture] of Object.entries(last.named)) {
    chars += capture?.length ?? 0;
    bytes += ENTRY_BYTES + stringBytes(name);
  }
  checkTextSize(chars);
  return bytes + chars * 2 + last.captures.length * ENTRY_BYTES;
}

// --- the functions ----------------------------------------------------------------------
// Compiled expressions are kept per session (a person's web session, or one scheduled run), numbered from 13000
// as MBS numbers them. A web session is one person's; MCP keeps one per account and database, OData one per account.

interface Session { next: number; refs: RetainedMap<number, Compiled> }
const sessions = new WeakMap<object, Session>();
const MAX_LIVE = 1000;
const sessionOf = (scope: object): Session => {
  let s = sessions.get(scope);
  if (!s) sessions.set(scope, (s = { next: 13000, refs: new RetainedMap(retainedBudget(scope), (_, c) => ENTRY_BYTES + stringBytes(c.pattern) + captureBytes(c.last)) }));
  return s;
};
function refOf(scope: object, raw: string | undefined): Compiled {
  const c = sessionOf(scope).refs.get(Number(raw));
  if (!c) throw new MbsError(`Invalid RegEx reference: ${raw ?? ''}`);
  return c;
}
const int = (s: string | undefined, d = 0) => (s === undefined || s.trim() === '' || Number.isNaN(Number(s)) ? d : Math.trunc(Number(s)));

type MbsRegex = (a: string[], scope: object) => string | number;

/** The RegEx functions by lower-case name. `scope` is the session the compiled expressions belong to. */
export const MBS_REGEX: Record<string, MbsRegex> = {
  'regex.compile': ([pattern = '', opts], scope) => {
    const s = sessionOf(scope);
    if (s.refs.size >= MAX_LIVE) throw new MbsError(`Too many regular expressions are open (${MAX_LIVE}); release them with RegEx.Release`);
    const c = compileRegex(pattern, optionsOf(opts));
    const ref = s.next;
    s.refs.set(ref, c);
    s.next++;
    return ref;
  },
  // The number of results: 1 for the whole match plus its groups, up to the last one that took part (PCRE's count);
  // 0 when nothing matches (inferred: MBS says only "the number of results").
  'regex.execute': ([ref, text = '', opts, offset], scope) => {
    const c = refOf(scope, ref);
    const from = Math.max(0, Math.min(text.length, int(offset)));
    const m = execAt(c, text, from, c.options | optionsOf(opts), true);
    const bytes = captureBytes(m && { captures: m, named: m.groups ?? {} });
    retainedBudget(scope).check(captureBytes(c.last), bytes);
    const last = m && {
      index: m.index,
      captures: [...m].map(own),
      indices: [...(m.indices ?? [])],
      named: Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, own(v)])),
    };
    sessionOf(scope).refs.set(Number(ref), { ...c, last });
    if (!m) return 0;
    let n = m.length;
    while (n > 1 && m[n - 1] === undefined) n--;
    return n;
  },
  'regex.substring': ([ref, index], scope) => {
    const c = refOf(scope, ref);
    const i = int(index);
    if (i < 0 || i > c.groups) throw new MbsError(`Index ${i} is out of range`);
    return c.last?.captures[i] ?? '';
  },
  'regex.substringlist': ([ref], scope) => {
    const c = refOf(scope, ref);
    return c.last ? joinText(Array.from({ length: c.groups + 1 }, (_, i) => c.last!.captures[i] ?? ''), '\r') : '';
  },
  'regex.namedsubstring': ([ref, name = ''], scope) => {
    const c = refOf(scope, ref);
    if (!c.names.has(name)) throw new MbsError(`No substring is named "${name}"`);
    return c.last?.named[name] ?? '';
  },
  'regex.stringnumber': ([ref, name = ''], scope) => {
    const n = refOf(scope, ref).names.get(name);
    if (n === undefined) throw new MbsError(`No substring is named "${name}"`);
    return n;
  },
  // Offsets into the text, end exclusive: two for the whole match, then two for each group (-1 for one that didn't take part).
  'regex.results': ([ref], scope) => {
    const c = refOf(scope, ref);
    const m = c.last;
    if (!m) return '';
    const out: number[] = [m.index, m.index + (m.captures[0] ?? '').length];
    for (let i = 1; i <= c.groups; i++) out.push(...(m.indices[i] ?? [-1, -1]));
    return out.join('\r');
  },
  'regex.capturecount': ([ref], scope) => refOf(scope, ref).groups,
  'regex.namecount': ([ref], scope) => refOf(scope, ref).names.size,
  'regex.pattern': ([ref], scope) => refOf(scope, ref).pattern,
  'regex.options': ([ref], scope) => refOf(scope, ref).options,
  'regex.study': ([ref], scope) => (refOf(scope, ref), 'OK'),
  'regex.release': ([refs = ''], scope) => {
    const s = sessionOf(scope);
    const keys = new Set(refs.split(/[\r\n]+/).filter((x) => x.trim()).map(Number));
    for (const key of keys) if (!s.refs.has(key)) throw new MbsError(`Invalid RegEx reference: ${key}`);
    for (const key of keys) s.refs.delete(key);
    return 'OK';
  },
  'regex.releaseall': (_, scope) => (sessionOf(scope).refs.clear(), 'OK'),
  'regex.list': (_, scope) => [...sessionOf(scope).refs.keys()].join('\r'),
  'regex.version': () => 'tabularius (JavaScript regular expressions, PCRE syntax)',
  'regex.match': ([pattern = '', text = '', compileOpts, execOpts]) => {
    const c = compileRegex(pattern, optionsOf(compileOpts));
    return execAt(c, text, 0, c.options | optionsOf(execOpts)) ? 1 : 0;
  },
  'regex.matchlist': ([pattern = '', list = '', compileOpts, execOpts]) => {
    const c = compileRegex(pattern, optionsOf(compileOpts));
    const exec = c.options | optionsOf(execOpts);
    return list.split(/\r\n|\r|\n/).filter((item) => execAt(c, item, 0, exec)).join('\r');
  },
  // One line per match: each group's text, or the whole match with ReturnWholeMatch; every line ends with a return unless NoReturnEnding.
  'regex.findmatches': ([ref, text = '', opts, whole, noEnding], scope) => {
    const c = refOf(scope, ref);
    const lines: string[] = [];
    let size = 0;
    const add = (part: string) => {
      if (lines.length >= MAX_TEXT_MATCHES) throw new RangeError('Too many text matches');
      size += part.length + 1;
      checkTextSize(size);
      lines.push(part);
    };
    for (const m of allMatches(c, text, c.options | optionsOf(opts))) {
      if (int(whole) === 1) add(m[0]);
      else for (let i = 1; i <= c.groups; i++) add(m[i] ?? '');
    }
    const list = lines.join('\r');
    return lines.length && int(noEnding) !== 1 ? list + '\r' : list;
  },
  'regex.replace': ([text = '', pattern = '', template = '', opts, all, nth]) =>
    replace(text, compileRegex(pattern, optionsOf(opts, true)), template, int(all) === 1, Math.max(0, int(nth))),
  'regex.replaceall': ([text = '', pattern = '', template = '', opts]) =>
    replace(text, compileRegex(pattern, optionsOf(opts, true)), template, true, 0),
  'regex.extract': ([text = '', pattern = '', template = '', opts]) => {
    const m = allMatches(compileRegex(pattern, optionsOf(opts, true)), text).next().value;
    return m ? rewrite(template, m) : '';
  },
  // Every character but letters, digits and _ (and those past ASCII) gets a backslash; NUL is \0.
  'regex.quote': ([text = '']) => [...text].map((c) => (c === '\u0000' ? '\\0' : /[A-Za-z0-9_]/.test(c) || c.codePointAt(0)! > 127 ? c : '\\' + c)).join(''),
};
MBS_REGEX['regex.free'] = MBS_REGEX['regex.release'];
