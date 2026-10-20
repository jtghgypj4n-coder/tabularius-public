// The script profiler: which scripts take the longest on this server, and
// which of their steps the time goes to. Every script run (Data API, web
// client, schedules, OData, MCP, debugger) reports its timings here; the admin
// console shows the slowest.
//
//   GET    /tabularius/admin/v1/profile           scripts, slowest total first, each with its slowest steps
//   DELETE /tabularius/admin/v1/profile           start counting again
//
// Kept in memory, since the server started (or was last reset). Bounded: at
// most 500 scripts and 50 steps each are tracked; when full, the ones with
// the least time give way.

import { REDACTED, redactCredentialStep } from '../../scripts/src/redaction.ts';
import type { ScriptProfile } from '../../scripts/src/index.ts';
import type { FindTiming } from '../../store/src/index.ts';

const MAX_SCRIPTS = 500;
const MAX_FINDS = 300;
const MAX_STEPS = 50;

interface StepStats {
  index: number;
  line: string;
  count: number;
  ms: number;
  maxMs: number;
  errors: number;
}

interface ScriptStats {
  file: string;
  script: string;
  runs: number;
  ms: number;
  maxMs: number;
  errors: number;
  steps: number;
  last: number;
  stepStats: Map<number, StepStats>;
}

/** Finds of one shape: the same table, criteria fields and sort, however the values differ. */
export interface FindStats {
  file: string;
  table: string;
  layout: string;
  fields: string[];
  sort: string[];
  count: number;
  ms: number;
  maxMs: number;
  /** How many of them started a criterion with a wildcard. */
  leadingWildcard: number;
  lastFound?: number;
  total: number;
  last: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** What one process has timed, as it is passed to the others of a cluster (see cluster.ts). */
export interface ProfileSnapshot {
  scripts: (Omit<ScriptStats, 'stepStats'> & { stepStats: StepStats[] })[];
  finds: FindStats[];
}

export class Profiler implements ScriptProfile {
  private own = new Map<string, ScriptStats>();
  private ownFinds = new Map<string, FindStats>();
  private since = Date.now();
  /** Changes with every timing kept, so a cluster's worker passes its timings on only when they changed. */
  version = 0;
  /** What the other worker processes of a cluster have timed: the reports add it to this one's. */
  elsewhere?: () => ProfileSnapshot[];
  /** Called on reset, so the other workers of a cluster start counting again too. */
  onReset?: () => void;

  /** This process's timings, to pass on. */
  snapshot(): ProfileSnapshot {
    return {
      scripts: [...this.own.values()].map((s) => ({ ...s, stepStats: [...s.stepStats.values()] })),
      finds: [...this.ownFinds.values()],
    };
  }

  /** This process's scripts, and the other workers' added in. */
  private get scripts(): Map<string, ScriptStats> {
    const others = this.elsewhere?.() ?? [];
    if (!others.length) return this.own;
    const all = new Map([...this.own].map(([k, s]) => [k, { ...s, stepStats: new Map([...s.stepStats].map(([i, st]) => [i, { ...st }])) }]));
    for (const o of others) {
      for (const x of o.scripts) {
        const key = `${x.file}\u0000${x.script}`;
        const s = all.get(key);
        if (!s) {
          all.set(key, { ...x, stepStats: new Map(x.stepStats.map((st) => [st.index, { ...st }])) });
          continue;
        }
        s.runs += x.runs;
        s.ms += x.ms;
        s.maxMs = Math.max(s.maxMs, x.maxMs);
        s.errors += x.errors;
        s.steps += x.steps;
        s.last = Math.max(s.last, x.last);
        for (const st of x.stepStats) {
          const mine = s.stepStats.get(st.index);
          if (!mine) s.stepStats.set(st.index, { ...st });
          else {
            mine.count += st.count;
            mine.ms += st.ms;
            mine.maxMs = Math.max(mine.maxMs, st.maxMs);
            mine.errors += st.errors;
          }
        }
      }
    }
    return all;
  }

  /** This process's finds, and the other workers' added in. */
  private get finds(): Map<string, FindStats> {
    const others = this.elsewhere?.() ?? [];
    if (!others.length) return this.ownFinds;
    const all = new Map([...this.ownFinds].map(([k, f]) => [k, { ...f }]));
    for (const o of others) {
      for (const x of o.finds) {
        const key = [x.file, x.table, x.fields.join('\u0001'), x.sort.join('\u0001')].join('\u0000');
        const f = all.get(key);
        if (!f) {
          all.set(key, { ...x });
          continue;
        }
        f.count += x.count;
        f.ms += x.ms;
        f.maxMs = Math.max(f.maxMs, x.maxMs);
        f.leadingWildcard += x.leadingWildcard;
        if (x.last > f.last) Object.assign(f, { last: x.last, lastFound: x.lastFound, total: x.total, layout: x.layout });
      }
    }
    return all;
  }

  private entry(file: string, script: string): ScriptStats {
    const key = `${file}\u0000${script}`;
    let s = this.own.get(key);
    if (!s) {
      if (this.own.size >= MAX_SCRIPTS) {
        let least: [string, ScriptStats] | undefined;
        for (const e of this.own) if (!least || e[1].ms < least[1].ms) least = e;
        this.own.delete(least![0]);
      }
      s = { file, script, runs: 0, ms: 0, maxMs: 0, errors: 0, steps: 0, last: 0, stepStats: new Map() };
      this.own.set(key, s);
    }
    this.version++;
    return s;
  }

  step(file: string, script: string, index: number, line: string, ms: number, error: number): void {
    line = redactCredentialStep(line);
    const s = this.entry(file, script);
    let st = s.stepStats.get(index);
    if (!st) {
      if (s.stepStats.size >= MAX_STEPS) {
        let least: StepStats | undefined;
        for (const x of s.stepStats.values()) if (!least || x.ms < least.ms) least = x;
        if (least!.ms > ms) return;
        s.stepStats.delete(least!.index);
      }
      st = { index, line, count: 0, ms: 0, maxMs: 0, errors: 0 };
      s.stepStats.set(index, st);
    }
    if (line.includes(REDACTED)) st.line = line;
    st.count++;
    st.ms += ms;
    if (ms > st.maxMs) st.maxMs = ms;
    if (error) st.errors++;
  }

  run(file: string, script: string, ms: number, error: number, steps: number): void {
    const s = this.entry(file, script);
    s.runs++;
    s.ms += ms;
    if (ms > s.maxMs) s.maxMs = ms;
    if (error) s.errors++;
    s.steps += steps;
    s.last = Date.now();
  }

  /** Scripts run since `since`, slowest in total first, each with its slowest steps. */
  report(limit = 50, stepsEach = 10) {
    const scripts = [...this.scripts.values()]
      .filter((s) => s.runs > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit)
      .map((s) => ({
        file: s.file,
        script: s.script,
        runs: s.runs,
        totalMs: round(s.ms),
        averageMs: round(s.ms / s.runs),
        maxMs: round(s.maxMs),
        errors: s.errors,
        averageSteps: Math.round(s.steps / s.runs),
        lastRun: new Date(s.last).toISOString(),
        slowestSteps: [...s.stepStats.values()]
          .sort((a, b) => b.ms - a.ms)
          .slice(0, stepsEach)
          .map((st) => ({ index: st.index, line: st.line, count: st.count, totalMs: round(st.ms), averageMs: round(st.ms / st.count), maxMs: round(st.maxMs), errors: st.errors })),
      }));
    return { since: new Date(this.since).toISOString(), scripts };
  }

  /**
   * One script's timings, step by step in script order, for the script editor: each step's own time (not the
   * scripts it calls), how often it ran (a loop's steps run many times a run), and its slowest run.
   */
  script(file: string, script: string) {
    const s = this.scripts.get(`${file}\u0000${script}`);
    if (!s || s.runs === 0) return undefined;
    return {
      since: new Date(this.since).toISOString(),
      runs: s.runs, totalMs: round(s.ms), averageMs: round(s.ms / s.runs), maxMs: round(s.maxMs), errors: s.errors,
      lastRun: new Date(s.last).toISOString(),
      steps: [...s.stepStats.values()].sort((a, b) => a.index - b.index).map((st) => ({
        index: st.index, line: st.line, count: st.count, perRun: round(st.count / s.runs),
        totalMs: round(st.ms), averageMs: round(st.ms / st.count), maxMs: round(st.maxMs), errors: st.errors,
      })),
    };
  }

  /** A find, timed by the store. Grouped by its shape; when full, the shape with the least time gives way. */
  find(file: string, t: FindTiming): void {
    const fields = [...t.fields].sort();
    const key = [file, t.table, fields.join('\u0001'), t.sort.join('\u0001')].join('\u0000');
    let f = this.ownFinds.get(key);
    if (!f) {
      if (this.ownFinds.size >= MAX_FINDS) {
        let least: [string, FindStats] | undefined;
        for (const e of this.ownFinds) if (!least || e[1].ms < least[1].ms) least = e;
        this.ownFinds.delete(least![0]);
      }
      f = { file, table: t.table, layout: t.layout, fields, sort: t.sort, count: 0, ms: 0, maxMs: 0, leadingWildcard: 0, total: t.total, last: 0 };
      this.ownFinds.set(key, f);
    }
    this.version++;
    f.count++;
    f.ms += t.ms;
    if (t.ms > f.maxMs) f.maxMs = t.ms;
    if (t.leadingWildcard) f.leadingWildcard++;
    f.lastFound = t.found;
    f.total = t.total;
    f.layout = t.layout;
    f.last = Date.now();
  }

  /** Find shapes since `since`, slowest in total first. */
  findReport(limit = 50): (Omit<FindStats, 'ms' | 'maxMs' | 'last'> & { totalMs: number; averageMs: number; maxMs: number; lastRun: string })[] {
    return [...this.finds.values()].sort((a, b) => b.ms - a.ms).slice(0, limit).map(({ ms, maxMs, last, ...f }) => ({
      ...f, totalMs: round(ms), averageMs: round(ms / f.count), maxMs: round(maxMs), lastRun: new Date(last).toISOString(),
    }));
  }

  /** Starts counting again; `here` only this process (a cluster's other worker asked), not the others too. */
  reset(here = false): void {
    this.ownFinds = new Map();
    this.own = new Map();
    this.since = Date.now();
    this.version++;
    if (!here) this.onReset?.();
  }
}
