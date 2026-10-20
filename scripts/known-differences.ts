// Writes docs/known-differences.md from the markers in docs/ (npm run docs:known-differences). With --check it writes
// nothing and fails when the page is out of date or a statement has no marker.

import { readFileSync, writeFileSync } from 'node:fs';
import { REGISTER, render, scan } from './known-differences-lib.ts';

const check = process.argv.includes('--check');
const { entries, problems } = scan();
for (const p of problems) console.error(`docs/${p.file}${p.line ? `:${p.line}` : ''}: ${p.why}\n  ${p.text}`);
const text = render(entries);
let old: string | undefined;
try { old = readFileSync(REGISTER, 'utf8'); } catch { old = undefined; }
if (old === text) console.log('docs/known-differences.md: up to date');
else if (check) { console.error('docs/known-differences.md: out of date; run npm run docs:known-differences'); process.exitCode = 1; }
else { writeFileSync(REGISTER, text); console.log('docs/known-differences.md: written'); }
if (problems.length) process.exitCode = 1;
