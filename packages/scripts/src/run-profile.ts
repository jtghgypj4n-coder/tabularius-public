// One run's profile, for the debugger: where the time went, step by step and
// script by script, so a slow script explains itself. Built from each step's
// own time (a Perform Script step's excludes its subscript's steps), so time
// the run spends paused in the debugger isn't counted.

import { REDACTED, redactCredentialStep } from './redaction.ts';
import type { ScriptProfile } from './engine.ts';

/** Steps that wait for a person (Pause/Resume Script, Show Custom Dialog, Insert File...): their time is the person's. */
const WAITS = /^(Pause\/Resume Script|Show Custom Dialog|Insert File|Insert from Device)\b/;

export interface ProfiledStep {
  script: string;
  /** 0-based index in the script. */
  index: number;
  line: string;
  count: number;
  ms: number;
  maxMs: number;
  errors: number;
  /** It waits for a person: its time isn't the script's. */
  waits?: boolean;
}

export interface ProfiledScript {
  script: string;
  calls: number;
  /** Its own steps' time. */
  ownMs: number;
  /** With the scripts it called. */
  totalMs: number;
}

export interface RunProfileReport {
  /** Every step's time added up (not counting waits for a person). */
  totalMs: number;
  steps: number;
  /** Slowest first. */
  scripts: ProfiledScript[];
  /** Slowest first (by time over all its runs); at most `limit`. */
  slowest: ProfiledStep[];
  /** Plain sentences: where most of the time went. */
  summary: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} s` : `${n >= 10 ? Math.round(n) : round(n)} ms`);

export class RunProfile implements ScriptProfile {
  private readonly stepStats = new Map<string, ProfiledStep>();
  private readonly scriptStats = new Map<string, ProfiledScript>();
  /** Scripts running now, outermost first, with the time of their steps and their subscripts' so far. */
  private readonly frames: { script: string; ms: number }[] = [];
  private total = 0;
  private count = 0;

  enter(_file: string, script: string): void {
    this.frames.push({ script, ms: 0 });
    const s = this.scriptOf(script);
    s.calls++;
  }

  leave(_file: string, script: string): void {
    const f = this.frames.pop();
    if (!f) return;
    // A script that called itself (directly or not) counts its outermost call only, so time isn't counted twice.
    if (!this.frames.some((x) => x.script === script)) this.scriptOf(script).totalMs += f.ms;
  }

  step(_file: string, script: string, index: number, line: string, took: number, error: number): void {
    line = redactCredentialStep(line);
    const key = `${script}\u0000${index}`;
    const s = this.stepStats.get(key) ?? { script, index, line, count: 0, ms: 0, maxMs: 0, errors: 0, ...(WAITS.test(line) ? { waits: true } : {}) };
    this.stepStats.set(key, s);
    if (line.includes(REDACTED)) s.line = line;
    s.count++;
    s.ms += took;
    s.maxMs = Math.max(s.maxMs, took);
    if (error) s.errors++;
    this.count++;
    if (s.waits) return;
    this.total += took;
    this.scriptOf(script).ownMs += took;
    for (const f of this.frames) f.ms += took;
  }

  run(): void {
    // The whole run's time includes waits and pauses; the report adds up steps instead.
  }

  private scriptOf(script: string): ProfiledScript {
    const s = this.scriptStats.get(script) ?? { script, calls: 0, ownMs: 0, totalMs: 0 };
    this.scriptStats.set(script, s);
    return s;
  }

  report(limit = 20): RunProfileReport {
    const steps = [...this.stepStats.values()].filter((s) => !s.waits).sort((a, b) => b.ms - a.ms);
    const scripts = [...this.scriptStats.values()].sort((a, b) => b.totalMs - a.totalMs || b.ownMs - a.ownMs);
    const summary: string[] = [];
    const total = this.total;
    if (steps.length && total > 0) {
      const top = steps[0];
      const each = top.count > 1 ? `, run ${top.count.toLocaleString('en-US')} times at ${ms(top.ms / top.count)} each` : '';
      summary.push(`${pct(top.ms, total)}% of the time is line ${top.index + 1} of "${top.script}": ${top.line}${each}.`);
      // The scripts it called, when one of them takes most of the time.
      const sub = scripts.find((s) => s.script !== scripts[0]?.script && s.totalMs >= total * 0.5);
      if (sub) summary.push(`"${sub.script}" and what it calls take ${pct(sub.totalMs, total)}% (${sub.calls.toLocaleString('en-US')} call${sub.calls === 1 ? '' : 's'}).`);
      const loopy = steps.filter((s) => s.count >= 100).reduce((n, s) => n + s.ms, 0);
      if (loopy >= total * 0.5 && !(top.count >= 100 && top.ms >= total * 0.5)) summary.push(`${pct(loopy, total)}% is in steps that ran 100 times or more: a loop.`);
    }
    const waited = [...this.stepStats.values()].filter((s) => s.waits).reduce((n, s) => n + s.ms, 0);
    if (waited >= 1) summary.push(`Not counted: ${ms(waited)} waiting for a person (dialogs, pauses, file pickers).`);
    return {
      totalMs: round(total),
      steps: this.count,
      scripts: scripts.map((s) => ({ ...s, ownMs: round(s.ownMs), totalMs: round(s.totalMs) })),
      slowest: steps.slice(0, limit).map((s) => ({ ...s, ms: round(s.ms), maxMs: round(s.maxMs) })),
      summary,
    };
  }
}
