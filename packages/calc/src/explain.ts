// Explaining a calculation: the formula written back from its parse tree, and
// the value of each part as the engine worked it out.
import { rethrowExecutionRefusal } from './execution-refusal.ts';
import type { CalcContext } from './evaluate.ts';
import type { Compiled } from './index.ts';
import { assertTraversalDepth, type Node } from './parser.ts';
import { asText, CalcError, type Value } from './values.ts';

const BINARY: Record<string, number> = {
  or: 1, xor: 1, and: 2,
  '=': 4, '≠': 4, '<>': 4, '<': 4, '>': 4, '≤': 4, '<=': 4, '≥': 4, '>=': 4,
  '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '^': 8,
};

const quote = (s: string) => '"' + s.replace(/[\\"¶\n]/g, '\\$&').replace(/\r/g, '¶') + '"';
/** A parse tree back in FileMaker calculation syntax (spacing normalized, comments gone). */
export function nodeText(n: Node, parent = 0, precise = false): string {
  assertTraversalDepth(n);
  return renderNodeText(n, parent, precise);
}

function renderNodeText(n: Node, parent = 0, precise = false): string {
  switch (n.k) {
    case 'num': return (precise || n.raw === 'Pi' ? n.raw : undefined) ?? (n.exact !== undefined ? n.exact.toString() : Number.isFinite(n.value) ? String(n.value) : '1e999');
    case 'str': return n.value === '\r' ? '¶' : quote(n.value);
    case 'field': return (n.occurrence ? `${n.occurrence}::${n.name}` : n.name) + (n.rep ? ` [ ${renderNodeText(n.rep, 0, precise)} ]` : '');
    case 'var': return n.name + (n.rep ? ` [ ${renderNodeText(n.rep, 0, precise)} ]` : '');
    case 'get': return `Get ( ${n.param} )`;
    case 'let': return `Let ( [ ${n.binds.map(([name, v, r]) => `${name}${r ? ` [ ${renderNodeText(r, 0, precise)} ]` : ''} = ${renderNodeText(v, 0, precise)}`).join(' ; ')} ] ; ${renderNodeText(n.body, 0, precise)} )`;
    case 'unary': {
      const p = n.op === 'not' ? 3 : 9;
      const s = n.op === 'not' ? `not ${renderNodeText(n.a, p, precise)}` : `${n.op}${renderNodeText(n.a, p, precise)}`;
      return p < parent ? `( ${s} )` : s;
    }
    case 'bin': {
      const p = BINARY[n.op] ?? 4;
      const s = `${renderNodeText(n.a, p, precise)} ${n.op} ${renderNodeText(n.b, p + 1, precise)}`;
      return p < parent ? `( ${s} )` : s;
    }
    case 'call':
      if (n.name === '[]') return `[ ${n.args.map((a) => renderNodeText(a, 0, precise)).join(' ; ')} ]`;
      if (n.name === 'While' && n.args.length === 2 && n.args[0].k === 'let' && n.args[1].k === 'let') {
        const binds = (v: Extract<Node, { k: 'let' }>) => `[ ${v.binds.map(([name, value, r]) => `${name}${r ? ` [ ${renderNodeText(r, 0, precise)} ]` : ''} = ${renderNodeText(value, 0, precise)}`).join(' ; ')} ]`;
        return `While ( ${binds(n.args[0])} ; ${renderNodeText(n.args[0].body, 0, precise)} ; ${binds(n.args[1])} ; ${renderNodeText(n.args[1].body, 0, precise)} )`;
      }
      return `${n.name} ( ${n.args.map((a, i) => renderNodeText(a, 0, precise || (n.name.toLowerCase() === 'setprecision' && i === 0))).join(' ; ')} )`;
  }
}

export interface Step {
  /** The part of the formula, in FileMaker syntax. */
  expr: string;
  /** Its value as text (clipped), or the error that stopped it. */
  value?: string;
  type?: Value['type'];
  error?: { code: number; message: string };
  /** The parts it was worked out from, in order (constants left out). */
  steps?: Step[];
}

export interface Explanation {
  value?: Value;
  error?: { code: number; message: string };
  /** The whole formula as one step, with its parts nested under it. */
  step?: Step;
  /** True when the formula ran more parts than maxSteps; later ones aren't listed. */
  truncated?: boolean;
}

/**
 * Evaluate a compiled formula and record each part's value: the step by step
 * a person (or an AI) needs to see why the result is what it is. Custom
 * function bodies appear under their call.
 */
export function explainEvaluation(c: Compiled, ctx: CalcContext = {}, opts: { maxSteps?: number; clip?: number } = {}): Explanation {
  const max = opts.maxSteps ?? 200;
  const clip = opts.clip ?? 200;
  const order = ctx.dateOrder ?? 'MDY';
  const pending = new Map<number, Step[]>();
  let count = 0;
  let truncated = false;
  const trace = (n: Node, r: Value | CalcError, depth: number) => {
    const children = pending.get(depth + 1);
    pending.delete(depth + 1);
    if (n.k === 'num' || n.k === 'str') return;
    if (++count > max && depth > 1) { truncated = true; return; }
    const step: Step = { expr: nodeText(n) };
    if (r instanceof CalcError) step.error = { code: r.code, message: r.message };
    else {
      const t = asText(r, order);
      step.value = t.length > clip ? t.slice(0, clip) + '…' : t;
      step.type = r.type;
    }
    if (children?.length) step.steps = children;
    // A Let's bound values come first, in order: name them.
    if (n.k === 'let' && children) {
      let i = 0;
      for (const [name, b] of n.binds) {
        const expr = nodeText(b);
        if (children[i]?.expr === expr) children[i++].expr = `${name} = ${expr}`;
      }
    }
    const at = pending.get(depth) ?? [];
    at.push(step);
    pending.set(depth, at);
  };
  const out: Explanation = {};
  try {
    out.value = c.evaluate({ ...ctx, trace });
  } catch (e) {
    rethrowExecutionRefusal(e);
    if (!(e instanceof CalcError)) throw e;
    out.error = { code: e.code, message: e.message };
  }
  out.step = pending.get(1)?.at(-1);
  if (truncated) out.truncated = true;
  return out;
}
