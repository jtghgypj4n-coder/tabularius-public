// `npm run test:ci`: the whole suite with a concurrency that fits the runner. The shared Linux
// CI hosts run several jobs at once, so each takes 2 test files at a time there; elsewhere 4.
// TEST_CI_CONCURRENCY overrides it.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const concurrency = Number(process.env.TEST_CI_CONCURRENCY) || (process.platform === 'linux' ? 2 : 4);
const result = spawnSync(process.execPath, [
  '--test', `--test-concurrency=${concurrency}`, '--test-timeout=300000', '--test-reporter=spec', 'packages/*/test/*.test.ts',
], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
