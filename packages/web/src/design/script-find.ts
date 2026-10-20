// Script Workspace helpers on script text (one step per line, continuation
// lines indented deeper): find and replace across scripts, and turning steps
// off (// …) or into comments (# …) for the selected lines.

export interface ScriptText { id: number; name: string; text: string }
export interface FindOptions { matchCase?: boolean; wholeWord?: boolean }
export interface Match { script: number; name: string; line: number; text: string }

function pattern(query: string, opts: FindOptions): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped, `gu${opts.matchCase ? '' : 'i'}`);
}

/** Every line of every script that holds `query`, in script order. */
export function findInScripts(scripts: ScriptText[], query: string, opts: FindOptions = {}): Match[] {
  if (!query) return [];
  const re = pattern(query, opts);
  const out: Match[] = [];
  for (const s of scripts) {
    s.text.split('\n').forEach((text, i) => {
      re.lastIndex = 0;
      if (re.test(text)) out.push({ script: s.id, name: s.name, line: i + 1, text });
    });
  }
  return out;
}

/** The scripts whose text changes when every `query` becomes `replacement` (the replacement is taken literally). */
export function replaceInScripts(scripts: ScriptText[], query: string, replacement: string, opts: FindOptions = {}): { script: number; text: string; count: number }[] {
  if (!query) return [];
  const re = pattern(query, opts);
  const out: { script: number; text: string; count: number }[] = [];
  for (const s of scripts) {
    let count = 0;
    const text = s.text.replace(re, () => {
      count++;
      return replacement;
    });
    if (count) out.push({ script: s.id, text, count });
  }
  return out;
}

/**
 * Which lines start a step: the others continue a step's options over
 * several lines (an open [ or a quote not closed yet).
 */
export function stepStarts(text: string): boolean[] {
  let depth = 0;
  let quote: string | undefined;
  return text.split('\n').map((line) => {
    const starts = depth === 0 && !quote;
    for (const ch of line) {
      if (quote) {
        if (ch === quote) quote = undefined;
      } else if (ch === '"') quote = '"';
      else if (ch === '“') quote = '”';
      else if (ch === '[') depth++;
      else if (ch === ']') depth = Math.max(0, depth - 1);
    }
    return starts;
  });
}

/**
 * Disable or enable the steps on lines `from`..`to` (0-based) with `// `, or
 * make them comments and back with `# `: when every step there already has the
 * prefix it comes off, else it goes on, after the indent, as FileMaker shows them.
 */
export function toggleSteps(text: string, from: number, to: number, prefix: '// ' | '# '): string {
  const lines = text.split('\n');
  const starts = stepStarts(text);
  const picked: number[] = [];
  for (let i = Math.max(0, from); i <= Math.min(to, lines.length - 1); i++) if (starts[i] && lines[i].trim()) picked.push(i);
  // A selection that begins inside a step's continuation lines takes that step.
  if (!picked.length) {
    let i = Math.min(from, lines.length - 1);
    while (i > 0 && !starts[i]) i--;
    if (lines[i]?.trim()) picked.push(i);
  }
  const bare = prefix.trimEnd();
  const has = (l: string) => l.trimStart().startsWith(bare);
  const off = picked.every((i) => has(lines[i]));
  for (const i of picked) {
    if (!off && has(lines[i])) continue;
    const indent = /^[\t ]*/.exec(lines[i])![0];
    const rest = lines[i].slice(indent.length);
    lines[i] = indent + (off ? rest.slice(rest.startsWith(prefix) ? prefix.length : bare.length) : prefix + rest);
  }
  return lines.join('\n');
}
