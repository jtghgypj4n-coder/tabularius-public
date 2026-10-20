// Names taken from files that belong to someone else must not come back into the repository
// (it is meant to be public). The list is kept as short hashes in scripts/banned-names.ts so no file names them.
// A hit prints file:line only. If it is a false positive, drop that word from the lists there
// (its hash goes in a commit message, not in a file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bannedLines } from '../../../scripts/banned-names.ts';

const root = join(import.meta.dirname, '..', '..', '..');

function tracked(): string[] | undefined {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
  } catch {
    return undefined;
  }
}

test('no tracked file carries a name from the banned list', { skip: tracked() ? false : 'not a git checkout' }, () => {
  const hits: string[] = [];
  for (const file of tracked()!) {
    if (file === 'package-lock.json' || /\.(png|jpe?g|gif|ico|woff2?|pdf|sqlite|zip|gz|mp4)$/i.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    for (const line of bannedLines(text)) hits.push(`${file}:${line}`);
  }
  assert.deepEqual(hits, [], 'a banned name is back in these places; describe the behaviour without naming the source');
});
