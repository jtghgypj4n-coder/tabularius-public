// `npm run test:ci`: the test suite with a concurrency that fits the runner. Elsewhere one test file
// per core, between 2 and 4 (a three-core macOS runner given 4 files at once ran every timing test on
// a machine with no core to spare). TEST_CI_CONCURRENCY overrides it.
//
// With no arguments it runs every test file. CI splits it:
//   --shard=2/4   run the second of four shards of the tests (the gates are not in a shard)
//   --gates       run only the repo-wide gates, once, in their own job
//   --list        print the files that would run instead of running them
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { plan, ROOT } from './test-plan.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
const shardArg = flag('shard')?.split('=')[1];
const [index, count] = shardArg ? shardArg.split('/').map(Number) : [1, 1];
if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count) {
  console.error(`--shard needs the form N/M with 1 <= N <= M, for example --shard=2/4 (got "${shardArg}")`);
  process.exit(2);
}
const { gates, shards } = plan(count);
const files = flag('gates') ? gates : shardArg ? shards[index - 1] : [...gates, ...shards.flat()].sort();
if (!files.length) {
  console.error('no test files selected: node --test would fall back to finding every file itself, so this stops instead');
  process.exit(1);
}
if (flag('list')) {
  console.log(files.join('\n'));
  process.exit(0);
}
const concurrency = Number(process.env.TEST_CI_CONCURRENCY) || Math.max(2, Math.min(4, availableParallelism()));
// A file gets ten minutes: docs-run.test.ts runs the hand-written pages'
// examples (131 s here on a many-core machine, over 300 s on a two-core runner twice running) and asks for 600 s itself.
const result = spawnSync(process.execPath, [
  '--test', `--test-concurrency=${concurrency}`, '--test-timeout=600000', '--test-reporter=spec', ...files,
], { cwd: ROOT, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
