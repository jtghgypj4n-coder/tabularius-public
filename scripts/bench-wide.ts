// node --no-warnings scripts/bench-wide.ts [--records 270000] [--tables 85]
// Profile just the fresh server with --cpu-prof on this launcher: its CPU flags
// are forwarded to the worker; generation is reported separately, never timed as startup.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWide, wideOptions } from './bench-wide-data.ts';

const options = wideOptions(process.argv.slice(2));
const dir = mkdtempSync(join(tmpdir(), 'tabularius-bench-wide-'));
try {
  const start = performance.now();
  const path = join(dir, 'Wide.openhbam.sqlite');
  const counts = buildWide(path, options);
  const buildMs = performance.now() - start;
  const flags = process.execArgv.filter((a) => a === '--cpu-prof' || a.startsWith('--cpu-prof-dir=') || a === '--no-warnings');
  const run = spawnSync(process.execPath, [...flags, fileURLToPath(new URL('./bench-wide-worker.ts', import.meta.url)), dir],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`wide measurement failed (${run.status}): ${run.stderr}`);
  console.log(JSON.stringify({ counts, buildMs, fileBytes: statSync(path).size,
    machine: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, cpus: cpus().length, memory: totalmem() },
    ...JSON.parse(run.stdout) }, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
