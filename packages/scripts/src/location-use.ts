// Whether a script step's calculations call Location or LocationValues, so the
// engine asks the person's device where it is only when a step really needs
// it. Each text parameter is read as a formula: a quoted "Location ( ... )" in a
// dialog's message is text, not a call, and a custom function that calls
// Location is followed into. A parameter that isn't a formula the parser can
// read falls back to a text search outside its quoted strings.

import { parse, type Node } from '../../calc/src/index.ts';
import type { ScriptStep, Schema } from '../../fmp12/src/index.ts';

const WANTED = new Set(['location', 'locationvalues']);
const TEXT_CALL = /\bLocation(Values)?\s*\(/i;
/** A formula's text with its "quoted" strings taken out. */
const withoutStrings = (s: string) => s.replace(/"(?:[^"\\]|\\.)*"/g, '""');

/** Function names a formula calls (and bare names, which may be custom functions without parameters), lower-cased. */
function calls(n: Node, out: Set<string>): Set<string> {
  switch (n.k) {
    case 'call': out.add(n.name.toLowerCase()); for (const a of n.args) calls(a, out); break;
    case 'field': if (n.rep) calls(n.rep, out); break;
    // A custom function with no parameters is called by its bare name.
    // Kept apart with a leading "@": a field named Location is not a call.
    case 'var': if (!n.name.startsWith('$')) out.add('@' + n.name.toLowerCase()); if (n.rep) calls(n.rep, out); break;
    case 'let': for (const [, v, rep] of n.binds) { calls(v, out); if (rep) calls(rep, out); } calls(n.body, out); break;
    case 'unary': calls(n.a, out); break;
    case 'bin': calls(n.a, out); calls(n.b, out); break;
  }
  return out;
}

/** The functions a formula calls, or undefined when it doesn't parse. */
function callsIn(formula: string): Set<string> | undefined {
  try {
    return calls(parse(formula), new Set());
  } catch {
    return undefined;
  }
}

type LocateResult = { found: boolean; cycle: boolean };
type FunctionText = { name: string; formula?: string | undefined };
const byFile = new WeakMap<Schema, { functions: FunctionText[]; known: Map<string, { formula: string; found: boolean }> }>();
const sameFunctions = (was: FunctionText[], now: FunctionText[]): boolean =>
  was.length === now.length && was.every((fn, i) => fn.name === now[i].name && fn.formula === now[i].formula);

/** Whether a custom function calls Location, itself or through other custom functions. */
function functionLocates(schema: Schema, name: string, seen: Set<string>): LocateResult {
  const known = byFile.get(schema)?.known;
  const key = name.toLowerCase();
  if (seen.has(key)) return { found: false, cycle: true }; // recursion: the other calls decide
  const fn = schema.customFunctions.find((c) => c.name.toLowerCase() === key);
  if (!fn?.formula) return { found: false, cycle: false };
  const hit = known?.get(key);
  if (hit?.formula === fn.formula) return { found: hit.found, cycle: false };
  seen.add(key);
  const result = formulaLocates(schema, fn.formula, seen);
  seen.delete(key);
  if (result.found || !result.cycle) known?.set(key, { formula: fn.formula, found: result.found });
  return result;
}

function formulaLocates(schema: Schema, formula: string, seen = new Set<string>()): LocateResult {
  const names = callsIn(formula);
  if (!names) return { found: TEXT_CALL.test(withoutStrings(formula)), cycle: false };
  let cycle = false;
  for (const n of names) {
    if (WANTED.has(n)) return { found: true, cycle: false };
    // Evaluate builds a formula from text, so its quoted text counts too.
    if (n === 'evaluate' && TEXT_CALL.test(formula)) return { found: true, cycle: false };
    if (schema.customFunctions.length) {
      const result = functionLocates(schema, n.replace(/^@/, ''), seen);
      if (result.found) return result;
      cycle ||= result.cycle;
    }
  }
  return { found: false, cycle };
}

/** Every text in a step's parameters, however deep. */
function texts(v: unknown, out: string[]): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) texts(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) texts(x, out);
  return out;
}

const bySteps = new WeakMap<ScriptStep, boolean>();

/** Whether a step's calculations call Location or LocationValues (directly, through a custom function, or in Evaluate's text). */
export function stepLocates(step: ScriptStep, schema: Schema): boolean {
  const custom = schema.customFunctions.length > 0;
  if (custom) {
    // The answers are kept for as long as no custom function was added, removed or edited: compared in place, one string
    // comparison each, so asking about many steps costs no more than that.
    const functions = schema.customFunctions;
    const cached = byFile.get(schema);
    if (!cached || !sameFunctions(cached.functions, functions)) byFile.set(schema, { functions: functions.map((fn) => ({ name: fn.name, formula: fn.formula })), known: new Map() });
  }
  let v = custom ? undefined : bySteps.get(step);
  if (v === undefined) {
    // Most steps mention neither, and nothing they call can either, unless a custom function does.
    const all = step.params ? texts(step.params, []) : [];
    v = all.some((t) => (TEXT_CALL.test(t) || custom) && formulaLocates(schema, t).found);
    if (!custom) bySteps.set(step, v);
  }
  return v;
}
