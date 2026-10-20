// Script linter, which FileMaker doesn't have: loops that can never end and
// guards that don't catch what they look like they catch, found by reading a
// script before anyone runs it. Each finding says what goes wrong in plain
// English and how to fix it. The script editor and Check show these, AI
// assistants get them through the lint_script MCP tool, and test-scripts adds
// them to a script that stalls.
//
// Loop and guard rules describe FileMaker's own behaviour. Undecoded-option
// findings describe Tabularius capability limits before a data-changing step runs.

import { scriptStepName, scriptText, undecodedOptionError, type Schema, type ScriptStep } from '../../fmp12/src/index.ts';

/** A step as the file stores it, or as parseScriptText reads it from text (name and enabled may be left out). */
export type LintStep = Omit<ScriptStep, 'name' | 'enabled' | 'stepId'> & { stepId?: number; name?: string; enabled?: boolean };

export type ScriptLintRule = 'loop-no-exit' | 'loop-no-progress' | 'count-equality' | 'omit-loop' | 'isvalid-related' | 'undecoded-options';

export interface ScriptLintIssue {
  rule: ScriptLintRule;
  severity: 'error' | 'warning';
  /** The step it is about: its index in the script's steps, and its line in the script text (from 1). */
  step: number;
  line: number;
  message: string;
  /** What to change, as a step or a sentence. */
  fix: string;
  /** Why it happens, in more depth: for a count, where the count comes from and when that is 0. */
  detail?: string;
}

const NEXT_RECORD = 'Go to Record/Request/Page';
const PORTAL_ROW = 'Go to Portal Row';
/** Steps that stop the whole script, so they end any loop around them. */
const STOPS = new Set(['Exit Script', 'Halt Script']);
/** A loop that pauses with no duration waits for a person, who can end it with a button. */
const WAITS = new Set(['Pause/Resume Script']);
const OMITS = new Set(['Omit Record', 'Omit Multiple Records', 'Delete Record/Request']);
/** A variable as scripts name them: $x, $$x, and FileMaker allows | and . in names. */
const VAR = String.raw`\$\$?[^\s=≠<>≤≥;()\[\]&+\-*/^"¶,{}:]+`;
/** Formulas that give a count, which is 0 when there is nothing to count. */
const COUNTS = /\b(?:Count|ValueCount|ItemCount|WordCount|PatternCount|ExecuteSQL|Get\s*\(\s*(?:FoundCount|TotalRecordCount)\s*\))\s*\(?/i;

interface Loop { start: number; end: number; depth: number }

/**
 * The script's problems, in step order: loops nothing ends, loops that end
 * only when a counter equals a count that can be 0, loops that omit records
 * and end only on “Exit after last”, and IsValid used to ask whether there
 * are related records.
 */
export function lintScript(script: { steps: LintStep[] }, schema?: Schema): ScriptLintIssue[] {
  const steps: ScriptStep[] = script.steps.map((s) => ({ ...s, stepId: s.stepId ?? 0, name: s.name || (s.stepId !== undefined ? scriptStepName(s.stepId) : ''), enabled: s.enabled ?? true }));
  const lines = lineNumbers(steps);
  const issues: ScriptLintIssue[] = [];
  const add = (rule: ScriptLintRule, severity: ScriptLintIssue['severity'], step: number, message: string, fix: string, detail?: string) =>
    issues.push({ rule, severity, step, line: lines[step], message, fix, ...(detail ? { detail } : {}) });
  const on = (i: number) => steps[i].enabled;
  const calc = (s: ScriptStep) => s.params?.calculation ?? s.calculations?.[0] ?? '';

  steps.forEach((s, i) => {
    const message = undecodedOptionError(s.stepId, s.params, s.calculations);
    if (s.enabled && message) add('undecoded-options', 'error', i, message, message);
  });

  // Loop nesting, and the If depth of every step (disabled steps don't count).
  const loops: Loop[] = [];
  const open: number[] = [];
  const ifDepth: number[] = [];
  let ifs = 0;
  steps.forEach((s, i) => {
    if (!s.enabled) return void (ifDepth[i] = ifs);
    if (s.name === 'End If') ifs = Math.max(0, ifs - 1);
    ifDepth[i] = s.name === 'Else' || s.name === 'Else If' ? ifs - 1 : ifs;
    if (s.name === 'If') ifs++;
    if (s.name === 'Loop') open.push(i);
    else if (s.name === 'End Loop' && open.length) {
      const start = open.pop()!;
      loops.push({ start, end: i, depth: open.length });
    }
  });
  /** Steps of the loop itself, not of loops inside it. */
  const own = (l: Loop) => {
    const out: number[] = [];
    for (let i = l.start + 1; i < l.end; i++) {
      const inner = loops.find((x) => x.start === i && x.depth === l.depth + 1);
      if (inner) i = inner.end;
      else if (on(i)) out.push(i);
    }
    return out;
  };
  const isNext = (s: ScriptStep) => s.name === NEXT_RECORD && (s.params?.location === 'next' || s.params?.location === 'previous');
  const exitsAfterLast = (s: ScriptStep) => (isNext(s) || s.name === PORTAL_ROW) && !!s.params?.exitAfterLast;

  for (const l of loops.sort((a, b) => a.start - b.start)) {
    const mine = own(l);
    const all = Array.from({ length: l.end - l.start - 1 }, (_, k) => l.start + 1 + k).filter(on);
    const exitIfs = mine.filter((i) => steps[i].name === 'Exit Loop If' && !/^\s*(?:0|False)?\s*$/i.test(calc(steps[i])));
    const afterLast = mine.filter((i) => exitsAfterLast(steps[i]));
    const stops = all.filter((i) => STOPS.has(steps[i].name));
    // A pause with no duration waits for a person, who ends the loop with a button. A timed pause carries on by
    // itself: the loop is checked like any other, except that someone can still click Cancel while it waits.
    const pauses = all.filter((i) => WAITS.has(steps[i].name));
    if (pauses.some((i) => !calc(steps[i]).trim())) continue;

    if (!exitIfs.length && !afterLast.length && !stops.length && pauses.length) {
      add('loop-no-exit', 'warning', pauses[0],
        'Only someone clicking Cancel while this Pause/Resume Script waits ends the loop. Run on the server (a schedule, Perform Script on Server or an inbound hook), where no one can, it never ends.',
        'Add Exit Loop If [ … ] for when it should stop, or keep the script to people\'s own sessions.',
        'The pause has a duration, so the loop carries on by itself after each wait, and nothing in it (no Exit Loop If, no “Exit after last”, no Exit Script) ends it.');
      continue;
    }
    if (!exitIfs.length && !afterLast.length && !stops.length) {
      const next = mine.find((i) => isNext(steps[i]));
      if (next !== undefined) {
        add('loop-no-exit', 'error', next,
          `${NEXT_RECORD} [ ${steps[next].params?.location === 'previous' ? 'Previous' : 'Next'} ] stays on the ${steps[next].params?.location === 'previous' ? 'first' : 'last'} record when there is no other one, and nothing else ends this loop, so it never stops.`,
          `Turn on “Exit after last”: ${NEXT_RECORD} [ ${steps[next].params?.location === 'previous' ? 'Previous' : 'Next'} ; Exit after last: On ]`,
          'FileMaker gives error 101 on the last record and stays there; without “Exit after last” the loop goes on with that record forever.');
      } else {
        add('loop-no-exit', 'error', l.start,
          'Nothing in this loop ends it: no Exit Loop If, no “Exit after last”, no Exit Script. It runs until someone stops it.',
          'Add Exit Loop If [ … ] with the condition that should end the loop.',
          'Only Exit Loop If, Go to Record or Go to Portal Row with “Exit after last”, Exit Script and Halt Script leave a loop, and this loop has none of them that runs.');
      }
      continue;
    }

    // Exit Loop If tests only variables nothing in the loop changes: the answer is the same every time round.
    if (!afterLast.length && !stops.length && exitIfs.length) {
      const frozen = exitIfs.map((e) => frozenVariables(calc(steps[e]))).every((vars) => vars !== undefined &&
        vars.every((v) => !setInLoop(steps, l, v)));
      if (frozen) {
        const e = exitIfs[0];
        const vars = [...new Set(exitIfs.flatMap((i) => frozenVariables(calc(steps[i]))!))];
        add('loop-no-progress', 'warning', e,
          `Exit Loop If [ ${calc(steps[e]).trim()} ] looks only at ${vars.join(', ')}, which nothing in this loop changes, so the answer is the same every time round: if it isn't true the first time, the loop never ends.`,
          `Change ${vars[0]} inside the loop (for example Set Variable [ ${vars[0]} ; Value: ${vars[0]} + 1 ]), or test something the loop changes.`,
          'Nothing between Loop and End Loop sets these variables (no Set Variable, no step with them as its target, no Let that assigns them' +
          (vars.some((v) => v.startsWith('$$')) ? ', and no subscript that could set a global' : '') + '), and the condition reads no field, record or clock.');
      }
    }

    // A loop that omits (or deletes) records and ends only on “Exit after last” in another branch: once
    // every record is gone there is no next record to go to, and the step that would end it never runs.
    if (!exitIfs.length && !stops.length && afterLast.every((i) => ifDepth[i] > ifDepth[l.start] && steps[i].name === NEXT_RECORD)) {
      const omit = mine.find((i) => OMITS.has(steps[i].name));
      if (omit !== undefined) {
        add('omit-loop', 'warning', omit,
          `When every record left is ${steps[omit].name.startsWith('Delete') ? 'deleted' : 'omitted'}, the found set is empty: ${NEXT_RECORD} [ Next ; Exit after last ] is in another branch and never runs again, so the loop never ends.`,
          'Add Exit Loop If [ Get ( FoundCount ) = 0 ] as the loop\'s first step.',
          'The step that ends the loop sits inside an If, so it only runs on records that match; once none are left, nothing ends the loop. The same happens when the loop starts with no records at all.');
      }
    }

    // Exit Loop If [ $count = $i ] with $i starting at 1 and going up: when the count is 0 it never matches.
    for (const e of exitIfs) {
      const m = new RegExp(`^\\s*(${VAR})\\s*=\\s*(${VAR})\\s*$`).exec(calc(steps[e]));
      if (!m) continue;
      const counter = [m[1], m[2]].find((v) => mine.some((i) => setsTo(steps[i], v, new RegExp(`^\\s*${esc(v)}\\s*\\+\\s*1\\s*$`, 'i'))));
      if (!counter) continue;
      const count = counter === m[1] ? m[2] : m[1];
      const start = lastSet(steps, counter, l.start);
      if (start === undefined || !/^\s*1\s*$/.test(steps[start].params?.value ?? '')) continue;
      const source = lastSet(steps, count, e);
      if (source === undefined) continue;
      const value = steps[source].params?.value ?? '';
      const fn = COUNTS.exec(value);
      if (!fn) continue;
      // Already handled: an If, Else If or Exit Loop If between the count and this step that tests the count.
      const mentions = new RegExp(`${esc(count)}(?![^\\s=≠<>≤≥;()\\[\\]&+\\-*/"])`, 'i');
      const guarded = steps.slice(source + 1, e).some((s, k) => on(source + 1 + k) &&
        ['If', 'Else If', 'Exit Loop If', 'Exit Script'].includes(s.name) && mentions.test(calc(s)));
      if (guarded) continue;
      add('count-equality', 'warning', e,
        `${count} comes from ${fn[0].replace(/\s*\($/, '').replace(/\s+/g, ' ')}, which is 0 when there is nothing to count. ${counter} starts at 1 and only goes up, so then Exit Loop If [ ${calc(steps[e]).trim()} ] is never true and the loop never ends.`,
        `Use Exit Loop If [ ${counter} > ${count} ] as the loop's first step, or end the script before the loop when ${count} is 0.`,
        zeroWhen(steps, count, source));
    }
  }

  // IsValid ( Related::key ) to ask "is there a related record?": with none, the field is empty, and an
  // empty field is valid, so it is true either way.
  steps.forEach((s, i) => {
    if (!s.enabled || !['If', 'Else If', 'Exit Loop If'].includes(s.name)) return;
    for (const m of calc(s).matchAll(/IsValid\s*\(\s*([^():;]+?)::([^()]+?)\s*\)/gi)) {
      const [, to, field] = m;
      if (schema && !looksLikeExistenceTest(schema, to.trim(), field.trim())) continue;
      add('isvalid-related', 'warning', i,
        `IsValid ( ${to.trim()}::${field.trim()} ) doesn't tell whether there is a related record: with none, the field is empty, and an empty field is valid, so IsValid is true either way.`,
        `Use not IsEmpty ( ${to.trim()}::${field.trim()} ), or Count ( ${to.trim()}::${field.trim()} ) > 0.`,
        'IsValid is false only for a field holding the wrong kind of data (text in a number field) or a field that no longer exists. With no related record the field is empty, and empty is valid.');
    }
  });
  return issues.sort((a, b) => a.step - b.step);
}

/**
 * When the count set at step `source` is 0: what its formula counts, and the
 * inputs this script never sets (a parameter, a global, a selection made
 * before the script ran). Names only, never values.
 */
function zeroWhen(steps: ScriptStep[], count: string, source: number): string {
  const value = steps[source].params?.value ?? '';
  const why: string[] = [];
  if (/Get\s*\(\s*ScriptParameter\s*\)/i.test(value)) why.push('the script runs without a parameter');
  if (/Get\s*\(\s*FoundCount\s*\)/i.test(value)) why.push('the found set is empty (a find that found nothing)');
  if (/Get\s*\(\s*TotalRecordCount\s*\)/i.test(value)) why.push('the table has no records');
  for (const m of value.matchAll(/\b(?:Count|ValueCount|ItemCount|WordCount|PatternCount)\s*\(\s*([^;()]+?)\s*[;)]/gi)) {
    const arg = m[1].trim();
    if (/^\$/.test(arg)) {
      if (lastSet(steps, arg, source) !== undefined) why.push(`${arg} is empty (the step that sets it found nothing)`);
      else if (arg.startsWith('$$')) why.push(`${arg} is empty: it is a global variable this script never sets, so another script must set it first`);
      else why.push(`${arg} is empty: this script never sets it before here, so it comes from the script parameter (through a function like #AssignP) or nowhere`);
    } else if (/::/.test(arg)) why.push(`the record has no related ${arg.split('::')[0].trim()} records`);
    else if (arg) why.push(`${arg} is empty on the record`);
  }
  if (/ExecuteSQL/i.test(value)) why.push('the query returns no rows');
  if (!why.length) return `${count} is set from a count; when that count is 0, the loop never ends.`;
  return `${count} is 0 when ${[...new Set(why)].join(', or when ')}. That is often the case when the script runs from somewhere other than its button, or on a record with nothing to do.`;
}

/** IsValid can still catch bad data in a date, time or number field; on a text field or a key it can only be an existence test. */
function looksLikeExistenceTest(schema: Schema, toName: string, fieldName: string): boolean {
  const to = schema.tableOccurrences.find((t) => t.name.toLowerCase() === toName.toLowerCase());
  const table = to && !to.dataSourceId ? schema.tables.find((t) => t.id === to.baseTableId) : undefined;
  const f = table?.fields.find((x) => x.name.toLowerCase() === fieldName.toLowerCase());
  if (!f) return true;
  if (f.type === 'text' || f.type === 'container' || f.type === 'unknown') return true;
  const key = !!f.options?.autoEnter?.serial || /get\s*\(\s*uuid/i.test(f.calculation ?? '') || /^(?:_*kp|pk|id$|uuid)/i.test(f.name);
  return f.type === 'number' && key;
}

/** Functions whose answer depends only on their arguments (no field, record, window or clock). */
const PURE = new Set(['not', 'isempty', 'length', 'left', 'right', 'middle', 'leftwords', 'rightwords', 'middlewords', 'leftvalues', 'rightvalues',
  'middlevalues', 'getvalue', 'valuecount', 'wordcount', 'patterncount', 'position', 'substitute', 'filter', 'trim', 'upper', 'lower', 'proper',
  'abs', 'int', 'round', 'truncate', 'ceiling', 'floor', 'mod', 'div', 'max', 'min', 'sign', 'case', 'if', 'choose', 'exact', 'getasnumber',
  'getastext', 'getasdate', 'getastime', 'getastimestamp', 'getasboolean', 'isvalid', 'jsongetelement', 'jsonlistkeys', 'jsonlistvalues', 'quote']);

/**
 * The variables a condition reads, when it reads nothing else that can change (no fields, no Get, no clock, no
 * records); undefined when it reads something else, or no variable at all.
 */
function frozenVariables(formula: string): string[] | undefined {
  const bare = formula.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  if (bare.includes('::')) return undefined;
  const vars = [...new Set([...bare.matchAll(new RegExp(VAR, 'g'))].map((m) => m[0]))];
  if (!vars.length) return undefined;
  const rest = bare.replace(new RegExp(VAR, 'g'), ' ');
  for (const m of rest.matchAll(/[\p{L}_][\p{L}\p{N}_.]*(\s*\()?/gu)) {
    const word = m[0].replace(/\s*\($/, '').toLowerCase();
    if (m[1]) {
      if (!PURE.has(word)) return undefined;
    } else if (!['and', 'or', 'not', 'xor', 'true', 'false'].includes(word)) return undefined; // a field
  }
  return vars;
}

/** Whether a step inside the loop (inner loops too) can change the variable. */
/** The variables a step stores into: its target, a dialog's inputs, a model call's history and messages. */
function targets(params: unknown): string[] {
  if (!params || typeof params !== 'object') return [];
  if (Array.isArray(params)) return params.flatMap(targets);
  return Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' ? (/variable$/i.test(k) ? [v.trim()] : []) : targets(v)));
}

function setInLoop(steps: ScriptStep[], l: Loop, variable: string): boolean {
  const lower = variable.toLowerCase();
  const assigns = new RegExp(`${esc(variable)}\\s*=`, 'i');
  for (let i = l.start + 1; i < l.end; i++) {
    const s = steps[i];
    if (!s.enabled) continue;
    if (targets(s.params).some((v) => v.toLowerCase() === lower)) return true;
    // A subscript can set a global variable.
    if (lower.startsWith('$$') && /^Perform Script/.test(s.name)) return true;
    if (/\bLet\s*\(/i.test(scriptText([s])) && assigns.test(scriptText([s]))) return true;
  }
  return false;
}

function setsTo(s: ScriptStep, variable: string, value: RegExp): boolean {
  return s.name === 'Set Variable' && (s.params?.variable ?? '').toLowerCase() === variable.toLowerCase() && value.test(s.params?.value ?? '');
}

/** The last enabled Set Variable of `variable` before step `before`. */
function lastSet(steps: ScriptStep[], variable: string, before: number): number | undefined {
  for (let i = before - 1; i >= 0; i--) {
    if (steps[i].enabled && steps[i].name === 'Set Variable' && (steps[i].params?.variable ?? '').toLowerCase() === variable.toLowerCase()) return i;
  }
  return undefined;
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Each step's first line in the script text (scriptText puts a step's extra lines under it). */
export function lineNumbers(steps: ScriptStep[]): number[] {
  let line = 1;
  return steps.map((s) => {
    const at = line;
    line += scriptText([s]).split('\n').length;
    return at;
  });
}
