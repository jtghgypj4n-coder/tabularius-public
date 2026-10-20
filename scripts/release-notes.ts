// Drafts release notes from the pull requests merged since a tag or commit (npm run release-notes). It prints the notes,
// or writes them to --out; it publishes and tags nothing. The conventions it follows are in docs/versioning.md.
//
//   node scripts/release-notes.ts --version 0.1.0 [--since v0.0.9] [--out notes.md] [--max-per-area 12] [--prs prs.json] [--changelog]
//
// --prs reads a list of {number, title, body?, labels?, files?} instead of the git history, for the pull request bodies
// and labels the history does not carry. --changelog puts the CHANGELOG.md heading above the notes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNotes, pullsFromGit, type MergedPull } from './release-notes-lib.ts';

try {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (const a of args.filter((x) => x.startsWith('--'))) {
    if (!['--version', '--since', '--out', '--max-per-area', '--prs', '--changelog'].includes(a)) throw new Error(`Unknown option ${a}`);
  }
  const version = value('--version');
  if (!version) throw new Error('give the version the notes are for: --version 0.1.0');
  const max = value('--max-per-area');
  const prsFile = value('--prs');
  const pulls: MergedPull[] = prsFile
    ? (JSON.parse(readFileSync(prsFile, 'utf8')) as MergedPull[])
    : pullsFromGit(join(import.meta.dirname, '..'), value('--since'));
  const body = buildNotes(pulls, { version, ...(max ? { maxPerArea: Number(max) } : {}) });
  const notes = args.includes('--changelog')
    ? `# Changelog\n\nWhat changed in each version of Tabularius, newest first. Each area lists its newest changes; work on reading FileMaker files is counted, not listed.\n\n${body}`
    : body;
  const out = value('--out');
  if (out) { writeFileSync(out, notes); console.log(`${out}: written`); } else process.stdout.write(notes);
} catch (e) {
  console.error(`release-notes: ${(e as Error).message}`);
  process.exitCode = 1;
}
