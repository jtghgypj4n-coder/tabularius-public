// Which test files `npm run test:ci` runs, and how they are split across CI jobs. The repo-wide
// gates (scans of the whole tree) run once in their own job; every other file is spread over the
// shards so that each shard takes about the same time. Every file lands in exactly one place.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Tests that scan the whole repository (documentation, release contents, banned names, error text)
// and say nothing about one platform: they run in the `gates` job on Linux, not on every shard.
const SCANNING_SLOW_GATES = [
  'packages/cli/test/error-strings.test.ts',
  'packages/cli/test/release-audit.test.ts',
  'packages/cli/test/no-private-names.test.ts',
  'packages/cli/test/docs-drift.test.ts',
];
const WEIGHTS_FILE = 'scripts/test-weights.json';

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;

export function allTests(root = ROOT): string[] {
  const packages = join(root, 'packages');
  return readdirSync(packages).flatMap((name) => {
    const dir = join(packages, name, 'test');
    return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.test.ts')).map((file) => `packages/${name}/test/${file}`) : [];
  }).sort();
}

export function gateTests(): string[] {
  const gates = readJson<{ file: string }[]>('scripts/precheck-gates.json').map((gate) => gate.file);
  return [...new Set([...gates, ...SCANNING_SLOW_GATES])].sort();
}

export type Weights = Record<string, number>;
export const loadWeights = (): Weights => (existsSync(join(ROOT, WEIGHTS_FILE)) ? readJson<Weights>(WEIGHTS_FILE) : {});
export const WEIGHTS_PATH = WEIGHTS_FILE;

// Seconds a file is expected to take: the recorded time when there is one, otherwise a guess from
// its size, so a new file still lands somewhere sensible until the weights are refreshed.
export function weightOf(file: string, weights: Weights, root = ROOT): number {
  if (weights[file] !== undefined) return weights[file];
  const size = existsSync(join(root, file)) ? statSync(join(root, file)).size : 0;
  return 1 + size / 20000;
}

// Longest-first onto the lightest shard: deterministic, and within a few percent of even.
export function shardFiles(files: string[], count: number, weights: Weights, root = ROOT): string[][] {
  const shards = Array.from({ length: count }, () => ({ load: 0, files: [] as string[] }));
  const ordered = files.map((file) => ({ file, weight: weightOf(file, weights, root) })).sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : 1));
  for (const { file, weight } of ordered) {
    const lightest = shards.reduce((best, shard) => (shard.load < best.load ? shard : best));
    lightest.files.push(file);
    lightest.load += weight;
  }
  return shards.map((shard) => shard.files.sort());
}

export type Plan = { gates: string[]; shards: string[][] };
export function plan(shardCount: number, root = ROOT): Plan {
  const gates = new Set(gateTests());
  const tests = allTests(root);
  return { gates: tests.filter((file) => gates.has(file)), shards: shardFiles(tests.filter((file) => !gates.has(file)), shardCount, loadWeights(), root) };
}
