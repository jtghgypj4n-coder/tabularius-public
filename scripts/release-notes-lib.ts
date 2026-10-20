// Release notes from merged pull requests: grouped by area, with the conversion work counted rather than listed and no
// names of people anywhere. The conventions are the ones docs/versioning.md lists; scripts/release-notes.ts is the
// command line.
import { execFileSync } from 'node:child_process';

export interface MergedPull {
  number: number;
  title: string;
  /** The description, when it is known (the git history carries only the title). */
  body?: string;
  /** Labels, when they are known; `area:<name>` decides the area. */
  labels?: string[];
  /** Paths the pull request changed, when they are known; they decide the area when nothing else does. */
  files?: string[];
}

export interface Area {
  name: string;
  /** Only counted in the notes: what the work touches can name private sample files and customer data. */
  countOnly?: boolean;
  /** Said under the count when the work is only counted. */
  countText?: string;
  /** A path belongs to this area when any of these matches. */
  paths: RegExp[];
}

/** In the order a visitor cares about; the first area holding the most changed files wins a tie. */
export const AREAS: Area[] = [
  { name: 'Conversion', countOnly: true, countText: 'changes to how FileMaker files are read and converted (not listed one by one)', paths: [/^packages\/fmp12\//, /^packages\/store\/src\/(import|reconvert|conversion)/, /^packages\/server\/src\/(conversion|convert-worker)/] },
  { name: 'Data API, OData and SQL', paths: [/^packages\/server\/src\/(dataapi|odata|cwp-xml|openapi|sql|pgwire|data-api)/, /^packages\/server\/src\/data-api\.openapi\.json$/, /^docs\/(data-api|openapi|sql-|pgwire|reference\/rest)/] },
  { name: 'Web client', paths: [/^packages\/web\/src\/(?!design\/)/, /^packages\/web\/e2e\//, /^packages\/server\/src\/webclient/] },
  { name: 'Design mode', paths: [/^packages\/web\/src\/design\//, /^packages\/server\/src\/design/, /^packages\/store\/src\/design/] },
  { name: 'Calculations and scripts', paths: [/^packages\/calc\//, /^packages\/scripts\//] },
  { name: 'Security and accounts', paths: [/^packages\/server\/src\/(security|privilege|ai-policy|auth|access|denial|session|totp|passkey|oidc|ldap|scim)/, /^(SECURITY|docs\/(security|threat|audit-privilege|personal-data))/] },
  { name: 'AI and MCP', paths: [/^packages\/server\/src\/(mcp|assistant|ai-|agent|embed)/, /^docs\/(connect-ai|mcp|ai-)/] },
  { name: 'Admin console and server', paths: [/^packages\/server\/admin\//, /^packages\/server\/src\//, /^ADMIN\.md$/, /^packages\/store\//] },
  { name: 'Plug-ins', paths: [/^packages\/plugins\//, /^examples\/plugins\//, /^docs\/(plugin|writing-a-plugin)/] },
  { name: 'Command line and install', paths: [/^packages\/cli\//, /^scripts\/install/, /^(Dockerfile|compose|Caddyfile|QUICKSTART)/, /^packaging\//] },
  { name: 'Documentation', paths: [/^docs\//, /^README\.md$/, /^examples\//, /^CONTRIBUTING\.md$/] },
  { name: 'Build and tests', paths: [/^\.github\//, /^scripts\//, /^package(-lock)?\.json$/, /^tsconfig/] },
];
export const OTHER = 'Other';

/** Title prefixes that name an area on their own ("Docs: ..."), lower case, to the area. */
export const PREFIXES: Record<string, string> = {
  conversion: 'Conversion', converter: 'Conversion', 'data api': 'Data API, OData and SQL', odata: 'Data API, OData and SQL', sql: 'Data API, OData and SQL',
  web: 'Web client', 'web client': 'Web client', design: 'Design mode', calc: 'Calculations and scripts', calculations: 'Calculations and scripts', scripts: 'Calculations and scripts',
  security: 'Security and accounts', ai: 'AI and MCP', mcp: 'AI and MCP', admin: 'Admin console and server', server: 'Admin console and server',
  plugins: 'Plug-ins', 'plug-ins': 'Plug-ins', cli: 'Command line and install', install: 'Command line and install',
  docs: 'Documentation', doc: 'Documentation', ci: 'Build and tests', build: 'Build and tests', tests: 'Build and tests', test: 'Build and tests',
};

const areaNamed = (name: string) => [...AREAS.map((a) => a.name), OTHER].find((n) => n.toLowerCase() === name.trim().toLowerCase());

/** The area of a pull request: its `area:` label, else a title prefix, else the area holding most of its changed files. */
export function areaOf(pr: MergedPull): string {
  for (const label of pr.labels ?? []) {
    const m = /^area:\s*(.+)$/i.exec(label);
    const found = m && (areaNamed(m[1]) ?? PREFIXES[m[1].trim().toLowerCase()]);
    if (found) return found;
  }
  const prefix = /^\s*(?:\[([A-Za-z][A-Za-z -]{1,20})\]|([A-Za-z][A-Za-z -]{1,20}):)\s+\S/.exec(pr.title);
  const named = (prefix?.[1] ?? prefix?.[2])?.trim().toLowerCase();
  if (named && PREFIXES[named]) return PREFIXES[named]!;
  const votes = new Map<string, number>();
  for (const file of pr.files ?? []) {
    const area = AREAS.find((a) => a.paths.some((p) => p.test(file)));
    if (area) votes.set(area.name, (votes.get(area.name) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const a of AREAS) if (votes.has(a.name) && (best === undefined || votes.get(a.name)! > votes.get(best)!)) best = a.name;
  return best ?? OTHER;
}

/** What a pull request says in the notes: its `Release note:` line if it has one, else its title; undefined when it opts out. */
export function lineOf(pr: MergedPull): string | undefined {
  const note = /^\s*release note:\s*(.+?)\s*$/im.exec(pr.body ?? '')?.[1];
  if (note && /^(none|skip|n\/a)\.?$/i.test(note)) return undefined;
  const text = (note ?? pr.title)
    // Backlog item tags such as (r17e-13) or (u-find-width) mean nothing to a reader.
    .replace(/\s*\((?:r\d+[a-z]?-\d+(?:[, ]+r\d+[a-z]?-\d+)*|u-[\w-]+)\)\s*$/i, '')
    // No names of people: a mention or an email address is never carried into the notes.
    .replace(/(^|\s)@[\w-]+/g, '$1').replace(/\S+@\S+\.\S+/g, '').replace(/\s+/g, ' ').trim()
    .replace(/\.$/, '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : undefined;
}

export interface NotesOptions {
  version: string;
  /** Newest items listed under each area before "and N more". */
  maxPerArea?: number;
}

/** The notes as Markdown. `pulls` is newest first. */
export function buildNotes(pulls: MergedPull[], options: NotesOptions): string {
  const max = options.maxPerArea ?? 12;
  const groups = new Map<string, { pr: MergedPull; line: string }[]>();
  let skipped = 0;
  for (const pr of pulls) {
    const line = lineOf(pr);
    if (line === undefined) { skipped++; continue; }
    const area = areaOf(pr);
    groups.set(area, [...(groups.get(area) ?? []), { pr, line }]);
  }
  const out = [`## ${options.version}`, ''];
  const order = [...AREAS.map((a) => a.name), OTHER];
  for (const name of order) {
    const items = groups.get(name);
    if (!items) continue;
    const area = AREAS.find((a) => a.name === name);
    out.push(`### ${name}`, '');
    if (area?.countOnly) {
      out.push(`${items.length} ${area.countText ?? 'changes'}`, '');
      continue;
    }
    for (const { pr, line } of items.slice(0, max)) out.push(`- ${line} (#${pr.number})`);
    if (items.length > max) out.push(`- …and ${items.length - max} more`);
    out.push('');
  }
  const total = [...groups.values()].reduce((n, g) => n + g.length, 0);
  out.push(`${total} merged pull request${total === 1 ? '' : 's'}${skipped ? `, ${skipped} left out at their own request` : ''}.`, '');
  return out.join('\n');
}

const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/**
 * The pull requests merged into the current branch by a "Merge pull request #N" commit, newest first, with the title
 * from the commit body and the files each changed. `since` is a tag or commit: only what came after it.
 */
export function pullsFromGit(cwd: string, since?: string): MergedPull[] {
  const range = since ? [`${since}..HEAD`] : [];
  const log = git(cwd, ['log', '--first-parent', '--merges', '--diff-merges=first-parent', '--name-only', '--format=%x1e%H%x1f%s%x1f%b%x1f', ...range]);
  const pulls: MergedPull[] = [];
  for (const record of log.split('\x1e')) {
    const [, subject, body, files] = record.split('\x1f');
    const m = /^Merge pull request #(\d+)\b/.exec(subject ?? '');
    if (!m) continue;
    const title = (body ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? subject!;
    pulls.push({ number: Number(m[1]), title, files: (files ?? '').split('\n').map((f) => f.trim()).filter(Boolean) });
  }
  return pulls;
}
