// npm run fuzz -- --target <name|all> [--seed N] [--seconds S] [--iterations N] [--timeout-ms N] [--memory-mb N] [--out DIR]
// Writes each minimised finding as <out>/<target>-<hash>.json and exits 1 when there are any.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { TARGETS, type Target } from './generate.ts';
import { findingName, fuzz } from './harness.ts';

const usage = `usage: npm run fuzz -- --target <${TARGETS.join('|')}|all> [--seed N] [--seconds S] [--iterations N] [--timeout-ms N] [--memory-mb N] [--out DIR]`;
const { values } = parseArgs({
  options: {
    target: { type: 'string' }, seed: { type: 'string', default: '1' }, seconds: { type: 'string' }, iterations: { type: 'string' },
    'timeout-ms': { type: 'string', default: '2000' }, 'memory-mb': { type: 'string', default: '256' }, out: { type: 'string', default: join(tmpdir(), 'tabularius-fuzz') },
  },
});
const number = (name: string, v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`--${name} must be a whole number\n${usage}`);
  return n;
};
if (!values.target || (values.target !== 'all' && !TARGETS.includes(values.target as Target))) throw new Error(usage);
const targets = values.target === 'all' ? [...TARGETS] : [values.target as Target];
const seed = number('seed', values.seed)!;
const iterations = number('iterations', values.iterations);
const seconds = number('seconds', values.seconds) ?? (iterations === undefined ? 60 : undefined);

let total = 0;
for (const target of targets) {
  const report = await fuzz({ target, seed, seconds, iterations, timeoutMs: number('timeout-ms', values['timeout-ms']), memoryMb: number('memory-mb', values['memory-mb']) });
  console.log(`${target}: ${report.iterations} inputs, ${report.findings.length} finding(s)`);
  for (const f of report.findings) {
    mkdirSync(values.out, { recursive: true });
    const file = join(values.out, `${findingName(f)}.json`);
    writeFileSync(file, `${JSON.stringify({ target, kind: f.kind, signature: f.signature, seed, input: f.input.toString('base64'), detail: f.detail }, null, 2)}\n`);
    console.log(`  ${f.kind}: ${f.signature}\n    minimised ${f.originalLength} -> ${f.input.length} bytes: ${file}`);
  }
  total += report.findings.length;
}
if (total) process.exitCode = 1;
