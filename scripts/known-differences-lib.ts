// The known-differences register is built from markers written beside each statement in docs/ that says what differs from
// FileMaker or what is not known yet. A marker is an HTML comment:
//
//   <!-- known-difference: area ;; what differs or is unknown ;; how it shows to the user ;; what would settle it -->
//
// On a table row it goes at the end of the row (a comment after the last pipe is dropped by Markdown renderers, and the
// parts are split on ";;" because a pipe would split the row); in prose it goes anywhere in the same paragraph.
// `<!-- known-difference-file: ... -->` covers every statement in the file (for a document that is one long statement of
// status, such as the file format notes). `<!-- known-difference-ok: reason -->` marks a statement that uses one of the
// words in another sense ("not yet swept"), and says why.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
export const DOCS = join(ROOT, 'docs');
export const REGISTER = join(DOCS, 'known-differences.md');
/** The pages beside docs/ that people read. */
const TOP_LEVEL = ['README.md', 'ADMIN.md', 'QUICKSTART.md', 'SECURITY.md', 'CONTRIBUTING.md'];

/** The words of a statement that something differs from FileMaker or is not settled. */
export const STATEMENT = /\b(?:not yet|inferred|unverified|approximation|unconfirmed|blocked on a sample)/i;
const MARKER = /<!--\s*known-difference(-file|-ok)?:\s*([\s\S]*?)\s*-->/g;
export const PARTS = ['area', 'what differs or is unknown', 'how it shows to the user', 'what would settle it'] as const;

/** Generated or self-describing pages: not scanned. docs/reference is built from the code, the register from these markers. */
const SKIPPED = (path: string) => path.startsWith(`reference${sep}`) || path === 'known-differences.md';
/** Where a page is linked from docs/. */
export const linkTo = (file: string) => (file.startsWith('docs/') ? file.slice(5) : `../${file}`);

export interface Entry { area: string; what: string; shows: string; settles: string; file: string; heading: string; excerpt: string }
export interface Problem { file: string; line: number; text: string; why: string }

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...markdownFiles(path));
    else if (e.name.endsWith('.md')) out.push(path);
  }
  return out.sort();
}

function parse(body: string): string[] | undefined {
  const parts = body.split(/\s;;\s/).map((p) => p.trim());
  return parts.length === PARTS.length && parts.every(Boolean) ? parts : undefined;
}

/** Every marker and every unmarked statement under docs/ (or `files`, for tests). */
export function scan(files = [...TOP_LEVEL.map((f) => join(ROOT, f)).filter((f) => existsSync(f)), ...markdownFiles(DOCS).filter((f) => !SKIPPED(relative(DOCS, f)))], base = ROOT): { entries: Entry[]; problems: Problem[]; statements: number } {
  const entries: Entry[] = [];
  const problems: Problem[] = [];
  let statements = 0;
  for (const path of files) {
    const file = relative(base, path).split(sep).join('/');
    const lines = readFileSync(path, 'utf8').split('\n');
    const headings: string[] = [];
    const heading = new Map<number, string>();
    let fence = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) fence = !fence;
      const h = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) headings.length = h[1].length - 1, headings.push(h[2].replace(/`/g, ''));
      heading.set(i, headings.join(' › '));
    });
    const marks = lines.map((line) => [...line.matchAll(MARKER)].map((m) => ({ kind: m[1] ?? '', body: m[2] })));
    // File-wide markers.
    const wide = marks.flat().filter((m) => m.kind === '-file');
    for (const m of wide) {
      const parts = parse(m.body);
      if (!parts) problems.push({ file, line: 0, text: m.body, why: `a known-difference-file marker needs four parts: ${PARTS.join(' ;; ')}` });
      else entries.push({ area: parts[0], what: parts[1], shows: parts[2], settles: parts[3], file, heading: '', excerpt: '(the whole page)' });
    }
    // Paragraph bounds: a table row is its own unit; prose is its run of non-blank lines.
    const unit = (i: number): [number, number] => {
      if (lines[i].trimStart().startsWith('|')) return [i, i];
      let a = i, b = i;
      while (a > 0 && lines[a - 1].trim() && !lines[a - 1].trimStart().startsWith('|')) a--;
      while (b < lines.length - 1 && lines[b + 1].trim() && !lines[b + 1].trimStart().startsWith('|')) b++;
      return [a, b];
    };
    // Every marker is an entry, beside a statement or not; its excerpt is the statement it sits beside.
    lines.forEach((line, i) => {
      for (const m of marks[i]) {
        if (m.kind !== '') continue;
        const parts = parse(m.body);
        if (!parts) { problems.push({ file, line: i + 1, text: m.body.slice(0, 120), why: `a known-difference marker needs four parts: ${PARTS.join(' ;; ')}` }); continue; }
        const [a, b] = unit(i);
        const at = lines.slice(a, b + 1).findIndex((l) => STATEMENT.test(l.replace(MARKER, '')));
        const shown = lines[at < 0 ? i : a + at].replace(MARKER, '');
        entries.push({ area: parts[0], what: parts[1], shows: parts[2], settles: parts[3], file, heading: heading.get(i) ?? '', excerpt: excerpt(shown) });
      }
    });
    // Every statement needs a marker in its unit, a marker for the whole file, or an ok marker saying why not.
    lines.forEach((line, i) => {
      if (!STATEMENT.test(line.replace(MARKER, ''))) return;
      statements++;
      const [a, b] = unit(i);
      const around = marks.slice(a, b + 1).flat();
      if (around.some((m) => m.kind === '' || (m.kind === '-ok' && m.body.trim())) || wide.length) return;
      problems.push({ file, line: i + 1, text: line.trim().slice(0, 120), why: 'says what differs or is not settled, but has no <!-- known-difference: ... --> marker' });
    });
  }
  return { entries, problems, statements };
}

function excerpt(line: string): string {
  const text = line.replace(/<!--.*?-->/g, '').replace(/^\s*(?:[|>*-]+\s*)+/, '').replace(/\s*\|\s*$/, '').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
  const m = STATEMENT.exec(text);
  let from = m ? Math.max(0, m.index - 50) : 0;
  // Start and end on a word.
  if (from) from = text.indexOf(' ', from) + 1 || from;
  let to = Math.min(text.length, from + 110);
  if (to < text.length) to = text.lastIndexOf(' ', to) > from ? text.lastIndexOf(' ', to) : to;
  return (from ? '…' : '') + text.slice(from, to).trim() + (to < text.length ? '…' : '');
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** docs/known-differences.md. */
export function render(entries: Entry[]): string {
  const sorted = [...entries].sort((x, y) => x.area.localeCompare(y.area) || x.file.localeCompare(y.file) || x.excerpt.localeCompare(y.excerpt));
  const areas = [...new Set(sorted.map((e) => e.area))];
  const waiting = ([['a sample file', /sample/i], ['a FileMaker run or Design Report', /FileMaker|Design Report|MBS run|native/i], ['a Claris answer', /Claris/i], ['a decision by the owner', /owner/i]] as const)
    .map(([label, pattern]) => `${sorted.filter((e) => pattern.test(e.settles)).length} on ${label}`);
  const out = [
    '# Known differences from FileMaker',
    '',
    'One list of every place Tabularius differs from FileMaker, or does not yet know whether it does: behaviour we inferred rather',
    'than saw, things not built yet, and answers still waiting on a sample file, a Claris page or a decision. It is written from',
    'the markers beside each statement in these pages and the top-level guides (README, ADMIN, SECURITY), so a statement cannot go',
    'missing from it. `npm run docs:known-differences` rewrites it, and a test fails when it is out of date or a statement has no',
    'marker (`<!-- known-difference: area ;; what ;; how it shows ;; what would settle it -->`). Internal working notes are not',
    'part of it.',
    '',
    `**${sorted.length} entries in ${areas.length} areas.** Waiting on: ${waiting.join(', ')} (an entry can wait on more than one).`,
    '',
    ...areas.flatMap((area) => [
      `## ${area}`,
      '',
      '| What differs or is unknown | How it shows | What would settle it | Where it is written |',
      '| --- | --- | --- | --- |',
      ...sorted.filter((e) => e.area === area).map((e) => `| ${cell(e.what)} | ${cell(e.shows)} | ${cell(e.settles)} | [${e.file}${e.heading ? ` › ${cell(e.heading.split(' › ').at(-1)!)}` : ''}](${linkTo(e.file)}) — “${cell(e.excerpt)}” |`),
      '',
    ]),
  ];
  return out.join('\n');
}
