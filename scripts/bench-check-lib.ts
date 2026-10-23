export interface BenchRow { group: string; operation: string; median: number }
export interface BenchOutput {
  records: number;
  customers: number;
  runs: number;
  calibrationMs: number;
  rows: BenchRow[];
}
export interface RatioRow { group: string; operation: string; ratio: number }
export interface Baseline {
  version: 1;
  config: { records: number; customers: number; importRows: number; runs: number };
  tolerance: number;
  operations: RatioRow[];
  wide?: WideBudget;
}

export interface WideBudget { records: number; tables: number; maxMs: number }
export function wideElapsed(output: { counts: { records: number; tables: number }; timings: { firstUseTotalMs: number } }, budget: WideBudget): number {
  if (!Number.isSafeInteger(budget.records) || budget.records < 1 || !Number.isSafeInteger(budget.tables) || budget.tables < 1 || !Number.isFinite(budget.maxMs) || budget.maxMs <= 0) throw new Error('invalid wide budget');
  if (output.counts.records !== budget.records || output.counts.tables !== budget.tables) throw new Error('wide benchmark configuration changed');
  const ms = output.timings.firstUseTotalMs;
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('invalid wide timing');
  return ms;
}

export const CONFIG = { records: 50_000, customers: 2_000, importRows: 5_000, runs: 3 };
export const TOLERANCE = 0.4;
export const key = (row: Pick<RatioRow, 'group' | 'operation'>) => JSON.stringify([row.group, row.operation]);

export function median(values: number[]): number {
  if (values.length === 0 || values.some((n) => !Number.isFinite(n))) throw new Error('invalid median values');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function ratios(output: BenchOutput): RatioRow[] {
  if (!Number.isFinite(output.calibrationMs) || output.calibrationMs <= 0) throw new Error('invalid calibration');
  if (output.records !== CONFIG.records || output.customers !== CONFIG.customers || output.runs !== CONFIG.runs) throw new Error('benchmark configuration changed');
  if (!Array.isArray(output.rows) || output.rows.length === 0) throw new Error('benchmark returned no operations');
  const seen = new Set<string>();
  return output.rows.map((row) => {
    if (typeof row.group !== 'string' || typeof row.operation !== 'string' || !Number.isFinite(row.median) || row.median < 0) throw new Error('invalid operation timing');
    const id = key(row);
    if (seen.has(id)) throw new Error(`duplicate operation: ${row.group} / ${row.operation}`);
    seen.add(id);
    return { group: row.group, operation: row.operation, ratio: row.median / output.calibrationMs };
  });
}

export function medianRatios(samples: RatioRow[][]): RatioRow[] {
  if (samples.length !== 3) throw new Error('exactly three samples required');
  const ids = samples[0].map(key);
  for (const sample of samples) {
    if (sample.length !== ids.length || sample.some((row, i) => key(row) !== ids[i] || !Number.isFinite(row.ratio) || row.ratio < 0)) throw new Error('operation list changed between samples');
  }
  return samples[0].map((row, i) => ({ ...row, ratio: median(samples.map((sample) => sample[i].ratio)) }));
}

export function compare(current: RatioRow[], baseline: Baseline) {
  if (baseline.version !== 1 || JSON.stringify(baseline.config) !== JSON.stringify(CONFIG) || baseline.tolerance !== TOLERANCE) throw new Error('baseline format, configuration or tolerance changed');
  if (baseline.operations.length !== current.length || baseline.operations.some((row, i) => key(row) !== key(current[i]) || !Number.isFinite(row.ratio) || row.ratio <= 0)) throw new Error('baseline operation list differs; review and run --update-baseline');
  return current.map((row, i) => ({ ...row, baseline: baseline.operations[i].ratio, increase: row.ratio / baseline.operations[i].ratio - 1,
    over: row.ratio > baseline.operations[i].ratio * (1 + baseline.tolerance) }));
}

export function confirmedRegressions(first: ReturnType<typeof compare>, second: ReturnType<typeof compare>) {
  return first.filter((row) => row.over && second.some((next) => key(next) === key(row) && next.over));
}
