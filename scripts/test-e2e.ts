// `npm run test:e2e`: the browser tests, with the files that are timed run alone after the rest (see test-e2e-lib.ts).
// Options after `--` go to node's test runner, as before.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { phases } from './test-e2e-lib.ts';

const root = resolve(import.meta.dirname, '..');
const files = readdirSync(resolve(root, 'packages/web/e2e')).filter((file) => file.endsWith('.e2e.ts')).sort().map((file) => `packages/web/e2e/${file}`);
let status = 0;
for (const phase of phases(files, process.argv.slice(2))) {
  const result = spawnSync(process.execPath, ['--no-warnings', '--test', '--test-reporter=spec', ...phase.args, ...phase.files], { cwd: root, stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(2); }
  status ||= result.status ?? 1;
}
process.exit(status);
