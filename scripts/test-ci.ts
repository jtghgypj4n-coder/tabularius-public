// `npm run test:ci`: the whole suite with a concurrency that fits the runner. The shared Linux
// CI hosts run several jobs at once, so each takes 2 test files at a time there; elsewhere one per
// core up to 4 (a three-core macOS runner given 4 files at once ran every timing test on a machine
// with no core to spare). TEST_CI_CONCURRENCY overrides it.
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const concurrency = Number(process.env.TEST_CI_CONCURRENCY) || (process.platform === 'linux' ? 2 : Math.max(2, Math.min(4, availableParallelism())));
const result = spawnSync(process.execPath, [
  '--test', `--test-concurrency=${concurrency}`, '--test-timeout=300000', '--test-reporter=spec', 'packages/*/test/*.test.ts',
], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
