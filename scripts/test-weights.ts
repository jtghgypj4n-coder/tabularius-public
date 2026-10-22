// `npm run test:weights`: times every test file on its own and writes scripts/test-weights.json, which
// `npm run test:ci -- --shard=N/M` uses to give each shard about the same amount of work. Run it when the
// shards have drifted apart (the slowest shard is well over a quarter of the total); it takes about as
// long as the whole suite.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allTests, ROOT, WEIGHTS_PATH, type Weights } from './test-plan.ts';

const files = allTests();
const concurrency = Number(process.env.TEST_CI_CONCURRENCY) || Math.max(2, Math.min(4, availableParallelism()));
const weights: Weights = {};
let next = 0;
const time = (file: string) => new Promise<void>((done) => {
  const started = Date.now();
  const child = spawn(process.execPath, ['--test', '--test-timeout=300000', '--test-reporter=dot', file], { cwd: ROOT, stdio: 'ignore' });
  child.on('close', () => {
    weights[file] = Math.max(1, Math.round((Date.now() - started) / 1000));
    done();
  });
});
const worker = async () => {
  while (next < files.length) await time(files[next++]);
};
await Promise.all(Array.from({ length: concurrency }, worker));
const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(join(ROOT, WEIGHTS_PATH), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote ${WEIGHTS_PATH}: ${files.length} files, ${Object.values(weights).reduce((a, b) => a + b, 0)} s of work`);
