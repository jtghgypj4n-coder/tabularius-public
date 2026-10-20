// The script editor's profiler marks: each step's time beside its line, and the slowest steps picked out.
// The server places each timed step on its line of the saved script (and leaves out steps changed since).
import type { ScriptProfileData } from './client.ts';

export interface LineMark {
  /** 1-based line in the editor. */
  line: number;
  /** Short text for the gutter: the step's time a run, and how many times a run it ran when more than once. */
  label: string;
  /** One of the few steps most of the time goes to. */
  hot: boolean;
  /** Its part of the script's step time, 0 to 1. */
  share: number;
  /** The longer explanation, for a tooltip or the list of slowest steps. */
  title: string;
}

/** A duration in plain units. */
export function ms(n: number): string {
  if (n < 0.1) return '<0.1 ms';
  if (n < 10) return `${n.toFixed(1)} ms`;
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} s`;
}

/** At most this many steps are picked out as slow, and only those taking at least this part of the time. */
const HOT = 3;
const HOT_SHARE = 0.1;

export function profileMarks(p: ScriptProfileData): { marks: Map<number, LineMark>; slowest: LineMark[] } {
  const total = p.steps.reduce((t, s) => t + s.totalMs, 0) || 1;
  const runs = Math.max(1, p.runs);
  const marks = new Map<number, LineMark>();
  for (const s of p.steps) {
    const share = s.totalMs / total;
    const loops = s.perRun > 1 ? ` ×${s.perRun % 1 ? s.perRun.toFixed(1) : s.perRun}` : '';
    marks.set(s.at, {
      line: s.at, label: ms(s.totalMs / runs) + loops, hot: false, share,
      title: `${ms(s.totalMs / runs)} a run` + (s.perRun > 1 ? `, run ${loops.slice(2)} times a run (${ms(s.averageMs)} each)` : '') +
        `; slowest ${ms(s.maxMs)}; ${Math.round(share * 100)}% of the script's time` + (s.errors ? `; ended with an error ${s.errors} time${s.errors === 1 ? '' : 's'}` : ''),
    });
  }
  const slowest = [...marks.values()].sort((a, b) => b.share - a.share).slice(0, HOT).filter((m) => m.share >= HOT_SHARE);
  for (const m of slowest) m.hot = true;
  return { marks, slowest };
}
