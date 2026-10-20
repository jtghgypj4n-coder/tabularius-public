import type { Node } from './parser.ts';

export interface UnknownCalcToken {
  kind: 'function' | 'get';
  id: string;
  name: string;
  shape: string;
}

/** Reader placeholders, not function-name guesses. FMDR IDs are decimal. */
export function unknownFunctionId(name: string): string | undefined {
  const fn = /^⟨fn:([a-f\d]{2}|[a-f\d]{4})⟩$/i.exec(name);
  if (fn) return `0x${fn[1].toLowerCase()}`;
  const design = /^⟨FMDR:(\d+)⟩$/i.exec(name);
  return design ? `FMDR:${Number(design[1])}` : undefined;
}

export function unknownGetId(name: string): string | undefined {
  const get = /^⟨get:([a-f\d]{2})⟩$/i.exec(name);
  return get ? `0x${get[1].toLowerCase()}` : undefined;
}

export function nodeChildren(n: Node): Node[] {
  switch (n.k) {
    case 'call': return n.args;
    case 'field': case 'var': return n.rep ? [n.rep] : [];
    case 'bin': return [n.a, n.b];
    case 'unary': return [n.a];
    case 'let': return [...n.binds.flatMap(([, value, rep]) => rep ? [value, rep] : [value]), n.body];
    default: return [];
  }
}

/** Only node kinds and arities: no literal, field, variable or custom-function names. */
export function nodeShape(n: Node, depth = 0): string {
  const children = nodeChildren(n);
  if (!children.length) return n.k === 'call' ? 'call()' : n.k;
  if (depth >= 8) return `${n.k}[${children.length}]`;
  return `${n.k}(${children.slice(0, 8).map((c) => nodeShape(c, depth + 1)).join(',')}${children.length > 8 ? ',…' : ''})`.slice(0, 240);
}

export function unknownCalcTokens(node: Node): UnknownCalcToken[] {
  const out: UnknownCalcToken[] = [];
  const pending = [node];
  while (pending.length) {
    const n = pending.pop()!;
    const name = n.k === 'call' ? n.name : n.k === 'get' ? n.param : undefined;
    const id = name && (n.k === 'get' ? unknownGetId(name) : unknownFunctionId(name));
    if (id && name) out.push({ kind: n.k === 'get' ? 'get' : 'function', id, name, shape: nodeShape(n) });
    pending.push(...nodeChildren(n).slice().reverse());
  }
  return out;
}
