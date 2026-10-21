// Syntax check for a formula as it is typed into a design dialog, like
// FileMaker's check when you click OK in Specify Calculation: it parses the
// formula, then makes sure every field, table occurrence and function it
// names exists, and that functions get the right number of parameters.

import './evaluate.ts';
import { FUNCTIONS, pluginNotInstalled } from './functions.ts';
import { GET_NAMES } from './get-names.ts';
import { NameTable, parse, type CalcNames, type Node } from './parser.ts';
import { CalcError, ERR } from './values.ts';

export interface CheckOptions {
  names?: NameTable | CalcNames;
  /** Custom functions by name: their parameter names. */
  customFunctions?: Iterable<[string, string[]]>;
  /** Plug-in functions enabled for the file: name (or ⟨OWNR:n⟩ marker), fewest and most arguments. */
  plugins?: Iterable<[string, number, number | undefined]>;
  /** Names a custom function's body may use unqualified: its parameters. */
  parameters?: string[];
  /** Table occurrences whose fields can't be listed (another file that isn't open): any field name passes. */
  unresolved?: Iterable<string>;
}

export type CheckResult =
  | { ok: true }
  | { ok: false; code: number; message: string; /** 0-based offset into the formula, when known. */ at?: number };

const fail = (code: number, message: string, at?: number): CheckResult => ({ ok: false, code, message, ...(at !== undefined && at >= 0 ? { at } : {}) });

/** Where a name first appears in the source, ignoring case. */
function find(src: string, name: string): number | undefined {
  const at = src.toLowerCase().indexOf(name.toLowerCase());
  return at >= 0 ? at : undefined;
}

export function checkFormula(src: string, opts: CheckOptions = {}): CheckResult {
  const names = opts.names instanceof NameTable ? opts.names : new NameTable(opts.names);
  let node: Node;
  try {
    node = parse(src, names, (opts.parameters ?? []).map((p) => p.trim()));
  } catch (e) {
    if (!(e instanceof CalcError)) throw e;
    const m = / at (\d+)$/.exec(e.message);
    return fail(e.code, e.message.replace(/ at \d+$/, ''), m ? Number(m[1]) - 1 : undefined);
  }
  const custom = new Map<string, string[]>();
  for (const [name, params] of opts.customFunctions ?? []) custom.set(name.toLowerCase(), params);
  const plugins = new Map<string, [number, number | undefined]>();
  for (const [name, min, max] of opts.plugins ?? []) plugins.set(name.toLowerCase(), [min, max]);
  const unresolved = new Set([...opts.unresolved ?? []].map((t) => t.toLowerCase()));
  const params = new Set((opts.parameters ?? []).map((p) => p.trim().toLowerCase()));
  const scopes: Set<string>[] = [];
  const bound = (name: string) => params.has(name.toLowerCase()) || scopes.some((s) => s.has(name.toLowerCase()));
  // Markers the file decoder leaves (⟨fn:37⟩, <Function Missing>) are reported by evaluation, not here.
  const marker = (name: string) => name.startsWith('⟨') || name.startsWith('<');

  const visit = (n: Node): CheckResult | undefined => {
    switch (n.k) {
      case 'num': case 'str': return undefined;
      case 'get':
        // Markers the file decoder leaves are reported by evaluation; a name the Get function does not take cannot be entered in FileMaker.
        if (marker(n.param) || GET_NAMES.has(n.param.toLowerCase())) return undefined;
        return fail(ERR.unknownFunction, `Get does not take "${n.param}"`, find(src, n.param));
      case 'field': {
        if (n.occurrence !== undefined) {
          if (marker(n.occurrence)) return fail(ERR.fieldMissing, 'A table this formula uses was deleted', find(src, n.occurrence));
          if (unresolved.has(n.occurrence.toLowerCase())) return n.rep ? visit(n.rep) : undefined;
          const fields = names.fieldsOf(n.occurrence);
          if (!fields) return fail(ERR.nameMissing, `The table "${n.occurrence}" cannot be found`, find(src, `${n.occurrence}::`));
          if (marker(n.name) || !fields.list.some((f) => f.lower === n.name.toLowerCase())) {
            return fail(ERR.fieldMissing, `The field "${n.occurrence}::${n.name}" cannot be found`, find(src, `${n.occurrence}::`));
          }
        } else if (marker(n.name)) {
          return fail(ERR.fieldMissing, 'A field this formula uses was deleted', find(src, n.name));
        }
        return n.rep ? visit(n.rep) : undefined;
      }
      case 'var': {
        if (n.rep) { const r = visit(n.rep); if (r) return r; }
        if (n.name.startsWith('$') || bound(n.name) || marker(n.name)) return undefined;
        const lower = n.name.toLowerCase();
        if (FUNCTIONS.get(lower)?.min === 0 || plugins.get(lower)?.[0] === 0 || custom.get(lower)?.length === 0) return undefined;
        if (!custom.has(lower) && !plugins.has(lower) && pluginNotInstalled(n.name)) return undefined;
        if (names.fields.list.some((f) => f.lower === lower)) return undefined;
        if (FUNCTIONS.has(lower) || plugins.has(lower) || custom.has(lower)) return fail(ERR.tooFewParameters, `"${n.name}" needs parameters in parentheses`, find(src, n.name));
        return fail(ERR.fieldMissing, `The field "${n.name}" cannot be found`, find(src, n.name));
      }
      case 'unary': return visit(n.a);
      case 'bin': return visit(n.a) ?? visit(n.b);
      case 'let': {
        // Every name the Let declares is known throughout it, even in its own
        // value (where it is still empty), as FileMaker accepts.
        scopes.push(new Set(n.binds.map(([name]) => name.toLowerCase()).filter((name) => !name.startsWith('$'))));
        try {
          for (const [, value, rep] of n.binds) {
            const r = visit(value) ?? (rep ? visit(rep) : undefined);
            if (r) return r;
          }
          return visit(n.body);
        } finally {
          scopes.pop();
        }
      }
      case 'call': {
        const lower = n.name.toLowerCase();
        if (lower === 'while') {
          // While ( [init] ; cond ; [logic] ; result ): one scope across both halves.
          const scope = new Set<string>();
          scopes.push(scope);
          try {
            for (const half of n.args) {
              if (half.k !== 'let') { const r = visit(half); if (r) return r; continue; }
              for (const [name] of half.binds) if (!name.startsWith('$')) scope.add(name.toLowerCase());
              for (const [, value, rep] of half.binds) {
                const r = visit(value) ?? (rep ? visit(rep) : undefined);
                if (r) return r;
              }
              const r = visit(half.body);
              if (r) return r;
            }
            return undefined;
          } finally {
            scopes.pop();
          }
        }
        if (lower !== '[]' && !marker(n.name) && !(pluginNotInstalled(n.name) && !custom.has(lower) && !plugins.has(lower))) {
          const fn = FUNCTIONS.get(lower);
          const pl = fn ? undefined : plugins.get(lower);
          const cf = fn || pl ? undefined : custom.get(lower);
          const at = find(src, `${n.name}`);
          if (!fn && !pl && !cf) return fail(ERR.unknownFunction, `The function "${n.name}" cannot be found`, at);
          const min = fn ? fn.min : pl ? pl[0] : cf!.length;
          const max = fn ? fn.max : pl ? pl[1] : cf!.length;
          if (n.args.length < min) return fail(ERR.tooFewParameters, `Too few parameters in ${n.name}`, at);
          if (max !== undefined && n.args.length > max) return fail(ERR.tooManyParameters, `Too many parameters in ${n.name}`, at);
        }
        for (const a of n.args) { const r = visit(a); if (r) return r; }
        return undefined;
      }
    }
  };
  return visit(node) ?? { ok: true };
}
