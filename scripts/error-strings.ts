// Prints the table of every message a person can be shown (npm run docs:error-strings -- <file>), or to the screen when
// no file is given. With --count it prints only how many read like a fault.

import { writeFileSync } from 'node:fs';
import { collect, faults, render } from './error-strings-lib.ts';

const rows = collect();
const target = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (process.argv.includes('--count')) console.log(`${faults(rows).length} of ${rows.length} read like a fault`);
else if (target) { writeFileSync(target, render(rows)); console.log(`${target}: ${rows.length} messages`); }
else console.log(render(rows));
