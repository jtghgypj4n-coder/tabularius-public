import type { Node } from './parser.ts';
import { nodeChildren } from './unknown.ts';

export const BY_NAME_FUNCTIONS: ReadonlySet<string> = new Set([
  'executesql', // SQL names tables and fields in query text.
  'getfield', // Resolves a field name supplied as text.
  'getfieldname', // Builds a field name as text.
  'evaluate', // Interprets formula text, including names.
  'getnthrecord', // Reads a specified field at a record position.
  'valuelistitems', // Reads a value list selected by name.
  'fieldnames', // Builds field names for a named layout.
  'fieldtype', // Reads the type of a named field.
  'fieldstyle', // Reads a named field's layout style.
  'fieldrepetitions', // Reads repetitions of a named field on a layout.
  'fieldbounds', // Reads bounds of a named field on a layout.
  'fieldcomment', // Reads the comment of a named field.
  'layoutobjectnames', // Builds object names for a named layout.
  'getlayoutobjectattribute', // Reads an attribute of a named layout object.
  'scriptnames', // Builds the script names of a named file.
  'layoutnames', // Builds the layout names of a named file.
  'valuelistnames', // Builds the value list names of a named file.
  'tablenames', // Builds the table names of a named file.
  'relationinfo', // Reads relationship information for a named occurrence.
]);

export interface ByNameReads {
  calls: string[];
  texts: string[];
  /** Some possible name values could not be determined without evaluation. */
  incomplete?: boolean;
}

interface Scope {
  parent?: Scope;
  bindings: Map<string, string | undefined>;
}

/**
 * Static name candidates only: literals, concatenation and lexical Let bindings.
 * No functions are evaluated. The task stack also handles While's let payloads.
 * Each folded value is limited to 64 KiB (32,768 UTF-16 code units); a 1 MiB total budget
 * bounds the quadratic output of collecting every prefix of a long & chain.
 * These are analysis limits, not claims about another product (unverified).
 */
export function byNameReads(node: Node): ByNameReads {
  const calls = new Set<string>();
  const texts = new Set<string>();
  const values = new Map<Node, string | undefined>();
  const pending: (() => void)[] = [];
  let incomplete = false;
  let foldedSize = 0;
  const maxText = 64 * 1024;
  const maxTotal = 1024 * 1024;
  const valueOf = (name: string, scope: Scope): string | undefined => {
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      if (s.bindings.has(name)) return s.bindings.get(name);
    }
    return undefined;
  };
  const visit = (n: Node, scope: Scope, mutable = false): void => {
    switch (n.k) {
      case 'str':
        texts.add(n.value);
        values.set(n, n.value);
        return;
      case 'num':
        // Integer literal text is independent of precision settings. Other
        // numeric formatting is unknown here; raw source (001, 1e2, Pi) is not
        // its text value, and runtime formatting parity is unverified.
        if (n.exact !== undefined) values.set(n, n.exact.toString());
        else if (Number.isSafeInteger(n.value)) values.set(n, String(n.value));
        return;
      case 'var':
        values.set(n, n.rep ? undefined : valueOf(n.name.toLowerCase(), scope));
        break;
      case 'bin':
        if (n.op === '&') pending.push(() => {
          const a = values.get(n.a), b = values.get(n.b);
          if (a === undefined || b === undefined) return;
          const size = 2 * (a.length + b.length);
          if (size > maxText || foldedSize + size > maxTotal) { incomplete = true; return; }
          const value = a + b;
          foldedSize += size;
          values.set(n, value);
          texts.add(value);
        });
        break;
      case 'let': {
        const local: Scope = { parent: scope, bindings: new Map() };
        pending.push(() => visit(n.body, local));
        // Binding expressions see earlier bindings, never later ones or inner scopes.
        for (let i = n.binds.length - 1; i >= 0; i--) {
          const [name, value, rep] = n.binds[i];
          pending.push(() => local.bindings.set(name.toLowerCase(), mutable || rep ? undefined : values.get(value)));
          if (rep) pending.push(() => visit(rep, local));
          pending.push(() => visit(value, local));
        }
        return;
      }
      case 'call': {
        const name = n.name.toLowerCase();
        if (BY_NAME_FUNCTIONS.has(name)) {
          calls.add(name);
          pending.push(() => {
            for (const arg of n.args) {
              const value = values.get(arg);
              if (value === undefined) incomplete = true;
              else texts.add(value);
            }
          });
        }
        if (name === 'while') {
          // A loop may change any binding before the next read. Never treat its
          // initial values as constants for later iterations; do not run the loop.
          const loop: Scope = { parent: scope, bindings: new Map() };
          for (const arg of n.args) if (arg.k === 'let') {
            for (const [binding] of arg.binds) loop.bindings.set(binding.toLowerCase(), undefined);
          }
          for (let i = n.args.length - 1; i >= 0; i--) {
            const arg = n.args[i];
            pending.push(() => visit(arg, loop, true));
          }
          return;
        }
        break;
      }
    }
    const children = nodeChildren(n);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      pending.push(() => visit(child, scope));
    }
  };
  pending.push(() => visit(node, { bindings: new Map() }));
  while (pending.length) pending.pop()!();
  if (!calls.size) return { calls: [], texts: [] };
  return { calls: [...calls], texts: [...texts], ...(incomplete ? { incomplete: true } : {}) };
}
