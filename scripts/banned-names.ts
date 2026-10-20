// Names taken from files that belong to someone else must not come back into the repository or into a release.
// The list is kept as short hashes so this file doesn't name them. A hit prints file:line only. If it is a false
// positive, drop that word from the lists below (its hash goes in a commit message, not here).
// Used by packages/cli/test/no-private-names.test.ts (the tracked files) and scripts/release-audit.ts (what ships).
import { createHash } from 'node:crypto';

export const hash = (w: string) => createHash('sha256').update(w).digest('hex').slice(0, 16);

// sha256(word).slice(0, 16), single words and two-word phrases, lower case.
const WORDS = new Set(['1d9fda0250ddbedf', '1ca0acf49daa83f0', '1b468b27898216f4', '23a2db5356bc2c3a', 'ad8b856e4b8e3c08', '04b8d84bb9ef59e9']);
const PHRASES = new Set(['82b9bb780a473fdc', '0c95c313100f7fff']);

/** The 1-based numbers of the lines of a text that hold a banned word or phrase. */
export function bannedLines(text: string): number[] {
  const hits: number[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (tokens.some((t, k) => WORDS.has(hash(t)) || (k > 0 && PHRASES.has(hash(`${tokens[k - 1]} ${t}`))))) hits.push(i + 1);
  }
  return hits;
}
