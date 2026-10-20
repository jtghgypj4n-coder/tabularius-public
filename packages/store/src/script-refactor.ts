// Where a script could be simpler or faster, found by reading it (and, when the server has timed it, from its
// profile): branches that never run, steps nothing can reach, runs of steps repeated in it that could be one
// subscript, and the slow shapes FileMaker developers know (a Set Field per record in a loop, a find or a commit on
// every pass). FileMaker has nothing like it. Each hint names its lines and what to do instead; the script editor
// lists them, and "Explain and refactor with AI" hands them to the assistant, whose draft is proven against the script before use.

import { scriptText, type Schema, type ScriptStep } from '../../fmp12/src/index.ts';
import { lineNumbers, type LintStep } from './script-lint.ts';
import { scriptStepName } from '../../fmp12/src/index.ts';

export type RefactorKind = 'dead-branch' | 'unreachable' | 'repeated' | 'same-as-script' | 'record-loop' | 'find-in-loop' | 'commit-in-loop' | 'slow-step' | 'disabled';

export interface RefactorHint {
  kind: RefactorKind;
  /** The lines it is about, in the script text (from 1): first and last. */
  line: number;
  endLine: number;
  message: string;
  /** What to do instead. */
  fix: string;
}

/** A step's time on this server, as the profiler counted it: in all, and how many times it ran. */
export interface StepTime { index: number; ms: number; runs: number }

const FALSE = /^\s*(?:0|false|""|0\s*=\s*1)\s*$/i;
const TRUE = /^\s*(?:1|true)\s*$/i;
/** Steps after which nothing in the same block runs. */
const ENDS = new Set(['Exit Script', 'Halt Script']);
/** Steps that open or close a block: a run of repeated steps is cut at them. */
const BLOCK = new Set(['If', 'Else If', 'Else', 'End If', 'Loop', 'End Loop', 'Exit Loop If']);
const MIN_REPEAT = 3;
const HINTS_KEPT = 50;

export function refactorHints(script: { name?: string; steps: LintStep[] }, schema?: Schema, profile?: StepTime[]): RefactorHint[] {
  const steps: ScriptStep[] = script.steps.map((s) => ({ ...s, stepId: s.stepId ?? 0, name: s.name || (s.stepId !== undefined ? scriptStepName(s.stepId) : ''), enabled: s.enabled ?? true }));
  const lines = lineNumbers(steps);
  const lastLine = (i: number) => lines[i] + scriptText([steps[i]]).split('\n').length - 1;
  const hints: RefactorHint[] = [];
  const add = (kind: RefactorKind, from: number, to: number, message: string, fix: string) =>
    hints.push({ kind, line: lines[from], endLine: lastLine(to), message, fix });
  const calc = (s: ScriptStep) => s.params?.calculation ?? s.calculations?.[0] ?? '';
  const on = steps.map((s) => s.enabled && s.name !== '# (comment)' && s.stepId !== 89);

  // Each If's branches: where each starts and where the If ends (enabled steps only, as FileMaker runs them).
  const ifs: { at: number; branches: number[]; end: number }[] = [];
  const open: { at: number; branches: number[] }[] = [];
  const loops: { start: number; end: number }[] = [];
  const loopOpen: number[] = [];
  steps.forEach((s, i) => {
    if (!s.enabled) return;
    if (s.name === 'If') open.push({ at: i, branches: [i] });
    else if ((s.name === 'Else If' || s.name === 'Else') && open.length) open[open.length - 1].branches.push(i);
    else if (s.name === 'End If' && open.length) ifs.push({ ...open.pop()!, end: i });
    else if (s.name === 'Loop') loopOpen.push(i);
    else if (s.name === 'End Loop' && loopOpen.length) loops.push({ start: loopOpen.pop()!, end: i });
  });

  // Branches that never run: If [ 0 ], and whatever follows a branch that always runs.
  for (const f of ifs) {
    const ends = [...f.branches.slice(1), f.end];
    let always = false;
    f.branches.forEach((b, k) => {
      const until = ends[k] - 1;
      const cond = steps[b].name === 'Else' ? 'true' : calc(steps[b]);
      if (always) {
        add('dead-branch', b, until, `This ${steps[b].name} never runs: an earlier branch of the If on line ${lines[f.at]} always does.`, 'Take it out, or check the condition before it.');
        return;
      }
      if (FALSE.test(cond) && steps[b].name !== 'Else') {
        add('dead-branch', b, Math.max(b, until), `${steps[b].name} [ ${cond.trim()} ] is always false, so its steps never run.`, until > b ? 'Take the branch out (or disable it with // while testing).' : 'Take the empty branch out.');
      } else if (TRUE.test(cond) && steps[b].name !== 'Else' && k < f.branches.length - 1) {
        always = true;
      }
    });
  }

  // Steps after Exit Script or Halt Script in the same block.
  steps.forEach((s, i) => {
    if (!on[i] || !ENDS.has(s.name)) return;
    let j = i + 1;
    while (j < steps.length && !(steps[j].enabled && /^(Else|Else If|End If|End Loop)$/.test(steps[j].name))) j++;
    const dead = [];
    for (let k = i + 1; k < j; k++) if (on[k]) dead.push(k);
    if (dead.length) add('unreachable', dead[0], dead[dead.length - 1], `Nothing reaches ${dead.length === 1 ? 'this step' : `these ${dead.length} steps`}: ${s.name} on line ${lines[i]} ends the script first.`, 'Take them out, or move them before it.');
  });

  // Runs of steps repeated in the script: one subscript (with a parameter for what differs) instead.
  const text = steps.map((s, i) => (on[i] ? scriptText([s]).trim() : ''));
  const claimed = new Set<number>();
  for (let len = Math.min(12, Math.floor(steps.length / 2)); len >= MIN_REPEAT; len--) {
    const seen = new Map<string, number>();
    for (let i = 0; i + len <= steps.length; i++) {
      const run = text.slice(i, i + len);
      if (run.some((t) => !t) || steps.slice(i, i + len).some((s) => BLOCK.has(s.name)) || run.every((t) => t.startsWith('Set Variable'))) continue;
      const key = run.join('\n');
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, i);
        continue;
      }
      if (first + len > i) continue;
      const range = (a: number) => Array.from({ length: len }, (_, k) => a + k);
      if ([...range(first), ...range(i)].some((k) => claimed.has(k))) continue;
      [...range(first), ...range(i)].forEach((k) => claimed.add(k));
      add('repeated', i, i + len - 1, `These ${len} steps repeat lines ${lines[first]}–${lastLine(first + len - 1)}.`, 'Move them into one subscript and perform it from both places (pass what differs as its parameter).');
    }
  }

  // The whole of another script, written out again here.
  if (schema) {
    for (const other of schema.scripts) {
      if (other.name === script.name) continue;
      const body = other.steps.filter((s) => s.enabled && s.stepId !== 89).map((s) => scriptText([s]).trim());
      if (body.length < MIN_REPEAT) continue;
      for (let i = 0; i + body.length <= steps.length; i++) {
        if (body.every((t, k) => text[i + k] === t)) {
          add('same-as-script', i, i + body.length - 1, `These steps are the whole of the script "${other.name}".`, `Perform Script [ “${other.name}” ] instead.`);
          break;
        }
      }
    }
  }

  // Slow shapes inside loops.
  for (const l of loops) {
    const inside = steps.slice(l.start + 1, l.end).map((s, k) => ({ s, i: l.start + 1 + k })).filter((x) => on[x.i]);
    const next = inside.find((x) => x.s.name === 'Go to Record/Request/Page' && /next/i.test(String(x.s.params?.location ?? scriptText([x.s]))));
    const sets = inside.filter((x) => x.s.name === 'Set Field');
    const other = inside.filter((x) => !['Set Field', 'Go to Record/Request/Page', 'Exit Loop If', 'Commit Records/Requests', 'Set Variable', '# (comment)'].includes(x.s.name) && x.s.stepId !== 89);
    if (next && sets.length === 1 && !other.length) {
      add('record-loop', l.start, l.end, 'This loop sets one field on every record of the found set, a record at a time.', `Replace Field Contents [ With dialog: Off ; ${scriptText([sets[0].s]).replace(/^Set Field \[\s*/, '').replace(/\s*\]\s*$/, '')} ] does it in one step.`);
    }
    const find = inside.find((x) => /^(Perform Find|Enter Find Mode|Constrain Found Set|Extend Found Set)$/.test(x.s.name));
    if (find) add('find-in-loop', find.i, find.i, `A ${find.s.name} on every pass of the loop on line ${lines[l.start]}.`, 'Find once before the loop, or read the values with ExecuteSQL or a relationship.');
    const commit = inside.find((x) => x.s.name === 'Commit Records/Requests');
    if (commit && next) add('commit-in-loop', commit.i, commit.i, `The record is committed on every pass of the loop on line ${lines[l.start]}.`, 'Going to the next record commits it anyway; take the Commit out of the loop, or open a transaction around it.');
  }

  // Where the time goes, when the server has timed it.
  if (profile?.length) {
    const total = profile.reduce((n, p) => n + p.ms, 0);
    for (const p of [...profile].sort((a, b) => b.ms - a.ms).slice(0, 3)) {
      if (total < 50 || p.ms / total < 0.25 || !steps[p.index]) continue;
      add('slow-step', p.index, p.index, `This step takes ${Math.round((p.ms / total) * 100)}% of the script's time here (${Math.round(p.ms)} ms in all, run ${p.runs} time${p.runs === 1 ? '' : 's'}).`, 'Look at what it reads: an unstored calculation, a related field or a find on an unindexed field are the usual causes.');
    }
  }

  // Many disabled steps.
  const off = steps.filter((s) => !s.enabled).length;
  if (off >= 5) {
    const first = steps.findIndex((s) => !s.enabled);
    const last = steps.length - 1 - [...steps].reverse().findIndex((s) => !s.enabled);
    add('disabled', first, last, `${off} steps are disabled (//).`, 'Take out the ones nothing needs; History keeps every saved version if you want one back.');
  }

  return hints.sort((a, b) => a.line - b.line).slice(0, HINTS_KEPT);
}
