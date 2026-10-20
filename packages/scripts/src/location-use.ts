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

const byFile = new WeakMap<Schema, Map<string, boolean>>();

/** Whether a custom function calls Location, itself or through other custom functions. */
function functionLocates(schema: Schema, name: string, seen: Set<string>): boolean {
  let known = byFile.get(schema);
  if (!known) byFile.set(schema, known = new Map());
  const key = name.toLowerCase();
  const hit = known.get(key);
  if (hit !== undefined) return hit;
  if (seen.has(key)) return false; // recursion: the other calls decide
  const fn = schema.customFunctions.find((c) => c.name.toLowerCase() === key);
  if (!fn?.formula) return false;
  seen.add(key);
  const found = formulaLocates(schema, fn.formula, seen);
  known.set(key, found);
  return found;
}

function formulaLocates(schema: Schema, formula: string, seen = new Set<string>()): boolean {
  const names = callsIn(formula);
  if (!names) return TEXT_CALL.test(withoutStrings(formula));
  for (const n of names) {
    if (WANTED.has(n)) return true;
    // Evaluate builds a formula from text, so its quoted text counts too.
    if (n === 'evaluate' && TEXT_CALL.test(formula)) return true;
    if (schema.customFunctions.length && functionLocates(schema, n.replace(/^@/, ''), seen)) return true;
  }
  return false;
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
  let v = bySteps.get(step);
  if (v === undefined) {
    // Most steps mention neither, and nothing they call can either, unless a custom function does.
    const all = step.params ? texts(step.params, []) : [];
    v = all.some((t) => (TEXT_CALL.test(t) || schema.customFunctions.length > 0) && formulaLocates(schema, t));
    bySteps.set(step, v);
  }
  return v;
}
