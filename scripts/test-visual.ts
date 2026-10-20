import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== '--update');
if (unknown.length) {
  console.error(`Unknown visual test option${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  process.exit(2);
}

const result = spawnSync(process.execPath, [
  '--no-warnings', '--test', '--test-concurrency=2', '--test-reporter=spec',
  'packages/web/e2e/visual-regression.e2e.ts',
], {
  cwd: resolve(import.meta.dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, ...(args.includes('--update') ? { TABULARIUS_VISUAL_UPDATE: '1' } : {}) },
});
if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}
process.exit(result.status ?? 2);
