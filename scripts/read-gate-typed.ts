// Lists what the read-gate inventory (scripts/read-gate-lib.ts) finds and what is still unclassified:
//   node --experimental-strip-types scripts/read-gate-typed.ts            the unclassified sites (exit 1 when there are any)
//   node --experimental-strip-types scripts/read-gate-typed.ts --all      every reader, gated or not
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, type Allowance } from './read-gate-lib.ts';

const root = join(import.meta.dirname, '..');
const allow = JSON.parse(readFileSync(join(root, 'scripts', 'read-gate-typed-allowlist.json'), 'utf8')) as Allowance[];
const result = check(root, allow);
if (process.argv.includes('--all')) {
  for (const r of result.readers) console.log(`${r.gated ? 'gated ' : 'open  '} ${r.at}  ${r.within}  ${r.api}`);
} else {
  for (const p of result.problems) console.log(p);
  console.log(`${result.readers.length} readers, ${result.readers.filter((r) => r.gated).length} pass the caller's privileges, ${result.problems.length} problems`);
  process.exitCode = result.problems.length ? 1 : 0;
}
