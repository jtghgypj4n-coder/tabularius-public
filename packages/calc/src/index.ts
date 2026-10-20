// @tabularius/calc: FileMaker calculations, evaluated.
//
//   import { evaluate, NameTable } from '@tabularius/calc';
//   evaluate('Upper ( First & " " & Last )', { field: (ref) => ... });
//
// See README.md for the context a host provides.

import { rethrowExecutionRefusal } from './execution-refusal.ts';
import { Env, type CalcContext } from './evaluate.ts';
import { NameTable, parse, fieldRefs, type CalcNames, type Node } from './parser.ts';
import { asText, coerce, type ValueType, type Value } from './values.ts';

export { Env, compare, type CalcContext, type CustomFunctionDef, type DeviceLocation, type FieldRef, type PluginFiles, type PluginFunction, type InstalledPlugin, type PluginOutbound, type PluginNetwork, type PluginMailer, type PluginMail, type PluginResponse, type MbsCurlRequest } from './evaluate.ts';
export { snapshotMbsCurl, restoreMbsCurl } from './mbs-curl.ts';
export { beginMbsReplay, rewindMbsReplay, endMbsReplay } from './mbs-replay.ts';
export { NameTable, parse, fieldRefs, fieldSpans, type CalcNames, type Node } from './parser.ts';
export * from './values.ts';
export { markExecutionRefusal, rethrowExecutionRefusal } from './execution-refusal.ts';
export { resolveFunction } from './evaluate.ts';
export { formatCss, toCss, tidyRuns, restyle, concatRuns, sliceRuns, editRuns, cleanRuns, RUN_LIMITS, rgbHex, STYLE_BITS, ALL_STYLES, type StyleRun, type TextFormat } from './styled.ts';
export { embeddingOf, embeddingFile, cosineSimilarity, isEmbeddingData } from './functions.ts';
export { pdfText, pdfMerge, pdfProblem, pdfPageCount, PdfLimitError } from './pdf-text.ts';
export { GET_NAMES } from './get-names.ts';
export { checkFormula, type CheckOptions, type CheckResult } from './check.ts';
export { explainEvaluation, nodeText, type Explanation, type Step } from './explain.ts';

/** A parsed formula, ready to evaluate many times. */
export interface Compiled {
  readonly formula: string;
  readonly node: Node;
  /** Fields the formula reads (unqualified ones have no occurrence). */
  readonly fields: { occurrence?: string; name: string }[];
  evaluate(ctx?: CalcContext, resultType?: ValueType): Value;
}

/** Parse a formula once. Throws CalcError for a formula FileMaker would reject. */
export function compile(formula: string, names?: NameTable | CalcNames): Compiled {
  const table = names instanceof NameTable ? names : new NameTable(names);
  const node = parse(formula, table);
  return {
    formula,
    node,
    fields: fieldRefs(node),
    evaluate(ctx: CalcContext = {}, resultType?: ValueType): Value {
      const env = new Env({ ...ctx, names: table });
      const v = env.v(node);
      return resultType ? coerce(v, resultType, env.order) : v;
    },
  };
}

/**
 * Evaluate a formula against a context. Throws CalcError (with FileMaker's
 * error code) where FileMaker would show "?" or refuse the formula.
 */
/** Parsed formulas by name table, so a script loop evaluating the same step parses it once. */
const parsed = new WeakMap<NameTable, Map<string, Node>>();

function parseCached(formula: string, names: NameTable): Node {
  let cache = parsed.get(names);
  if (!cache) parsed.set(names, (cache = new Map()));
  let node = cache.get(formula);
  if (!node) {
    if (cache.size >= 5000) cache.clear();
    node = parse(formula, names);
    cache.set(formula, node);
  }
  return node;
}

export function evaluate(formula: string, ctx: CalcContext = {}, resultType?: ValueType): Value {
  const env = new Env(ctx);
  // Only a table the caller keeps is worth caching on; one made for this call would never be seen again.
  const v = env.v(ctx.names instanceof NameTable ? parseCached(formula, env.names) : parse(formula, env.names));
  return resultType ? coerce(v, resultType, env.order) : v;
}

/** Evaluate to text, with "?" for an error, as FileMaker shows a calculation result. */
export function evaluateText(formula: string, ctx: CalcContext = {}): string {
  try {
    return asText(evaluate(formula, ctx), ctx.dateOrder);
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (e instanceof Error && 'code' in e) return '?';
    throw e;
  }
}
