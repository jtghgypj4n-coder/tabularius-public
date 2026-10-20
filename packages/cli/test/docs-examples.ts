// Finds the command examples in the documentation: fenced shell blocks and `inline code`, with the hidden comment
// `<!-- docs-example: run | placeholders {"a":"b"} | illustrative -->` an author puts on the line before a fence to say whether the
// example runs as written (`run`), runs once a placeholder (a database name, a token) is filled in (`placeholders`), or only
// shows the shape of a command (`illustrative`). docs-commands.test.ts runs the first kind and checks every kind against the
// program's own `help`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const root = join(import.meta.dirname, '..', '..', '..');

/**
 * The pages people write by hand: the top-level guides and everything under docs/ except docs/reference/, which
 * `npm run docs:reference` writes from the code (and a test keeps in step with it).
 */
export function handWrittenDocs(): string[] {
  const out = ['README.md', 'QUICKSTART.md', 'ADMIN.md', 'SECURITY.md', 'CONTRIBUTING.md'];
  const walk = (dir: string): void => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (path !== 'docs/reference') walk(path); } else if (e.name.endsWith('.md')) out.push(path);
    }
  };
  walk('docs');
  return out;
}

export type Mark = 'run' | 'placeholders' | 'illustrative';
/** `subs` (after `placeholders`): text in the example to replace before it runs, as JSON, in order: `{"Ann":"Admin"}`. */
export interface Fence { file: string; line: number; lang: string; body: string; mark?: Mark; subs?: [string, string][] }
export interface Inline { file: string; line: number; text: string }

const SHELL = new Set(['sh', 'bash', 'shell', 'console', 'powershell']);

export function fences(file: string): Fence[] {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  const out: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*```(\w*)\s*$/.exec(lines[i]);
    if (!open) continue;
    let end = i + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
    let before = i - 1;
    while (before >= 0 && lines[before].trim() === '') before--;
    const m = /^<!-- docs-example: (run|placeholders|illustrative)(?: (\{.*\}))? -->$/.exec(lines[before]?.trim() ?? '');
    out.push({ file, line: i + 1, lang: open[1], body: lines.slice(i + 1, end).join('\n'), mark: m?.[1] as Mark | undefined, subs: m?.[2] ? Object.entries(JSON.parse(m[2]) as Record<string, string>) : undefined });
    i = end;
  }
  return out;
}

export const shellFences = (file: string): Fence[] => fences(file).filter((f) => SHELL.has(f.lang));

/** `inline code` outside fenced blocks. */
export function inlineCode(file: string): Inline[] {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  const out: Inline[] = [];
  let inFence = false;
  lines.forEach((text, i) => {
    if (/^\s*```/.test(text)) { inFence = !inFence; return; }
    if (inFence) return;
    for (const m of text.matchAll(/`([^`\n]+)`/g)) out.push({ file, line: i + 1, text: m[1] });
  });
  return out;
}

/** The commands of a shell block: continuation lines joined, blank lines and comments dropped, trailing comments cut. */
export function shellCommands(body: string): string[] {
  const out: string[] = [];
  for (const raw of body.replace(/\\\n\s*/g, ' ').split('\n')) {
    let quote = '';
    let cut = raw.length;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) { cut = i; break; }
    }
    const line = raw.slice(0, cut).trim();
    if (line) out.push(line);
  }
  return out;
}

export interface Call { command: string; flags: string[]; serveFlags: string[] }

/**
 * The Tabularius command in a line (also `npm run tabularius -- <command>`), with its options. After a bare `--` come the options
 * of the program the command starts (`service install ... -- --https local` hands them to `serve`).
 */
export function tabulariusCall(line: string): Call | undefined {
  // In a container the command is run through Compose: "docker compose exec tabularius tabularius passwd /data ..." (the first
  // Tabularius is the service's name).
  line = line.replace(/\bdocker compose exec (?:-T )?tabularius (?=tabularius )/, '');
  const m = /(?:^|[\s|&;(])(?:npm run (?:-s )?)?tabularius (?:-- )?([a-z][\w-]*)((?:\s.*)?)$/.exec(line);
  if (!m) return undefined;
  const rest = m[2].replace(/"[^"]*"|'[^']*'/g, ' ');
  const dash = rest.search(/\s--(?:\s|$)/);
  const own = dash >= 0 ? rest.slice(0, dash) : rest;
  const after = dash >= 0 ? rest.slice(dash + 3) : '';
  const flags = (s: string) => [...s.matchAll(/(?:^|\s)(--[a-z][\w-]*)/g)].map((x) => x[1]);
  return { command: m[1], flags: flags(own), serveFlags: flags(after) };
}
