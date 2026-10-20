// Offline evidence gathering only: never installs candidate names in decoder tables.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FmpDatabase, observeCalcs, readLayoutDesigns, FILEMAKER_FUNCTIONS, PLUGIN_FUNCTIONS, getParameterName } from '../../fmp12/src/index.ts';
import { parse, NameTable, type Binding, type CalcNames, type Node } from '../../calc/src/parser.ts';
import { FUNCTIONS } from '../../calc/src/functions.ts';
import { GET_NAMES } from '../../calc/src/get-names.ts';
import { nodeChildren, unknownFunctionId, unknownGetId, unknownCalcTokens } from '../../calc/src/unknown.ts';
import { parseXml, kids, kid, text } from '../../store/src/snippet.ts';

export interface PairingReport {
  tokens: { id: string; names: { name: string; agreements: number; independent: number }[]; candidate?: string }[];
  skipped: { decoded: number; xml: number };
}

type Observation = { id: string; name: string };
type Tree = { node: Node; hash: string };
type Evidence = { name: string; pairs: Map<string, Set<string>> };
const lower = (s: string) => s.toLowerCase();
const candidateName = (s: string) => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s);
const tokenId = (kind: 'function' | 'get', id: string) => id.startsWith('FMDR:') ? id : `${kind === 'get' ? 'get' : 'fn'}:${id}`;
const publicFunctions = new Set([...FUNCTIONS.keys(), ...FILEMAKER_FUNCTIONS, ...PLUGIN_FUNCTIONS].map(lower));
// Include legacy decoded Get names as well as the public/runtime catalog.
const publicGetOptions = new Set([...GET_NAMES]);
for (let id = 0; id <= 0xff; id++) {
  const name = getParameterName(id);
  if (name) publicGetOptions.add(lower(name));
}

/** Redact XML identifiers at the report boundary, preserving full names for evidence matching. */
function reportName(name: string, id: string): string {
  const normalized = lower(name);
  const known = id.startsWith('get:') ? publicGetOptions : publicFunctions;
  return known.has(normalized) ? name : `name#${createHash('sha256').update(normalized).digest('hex').slice(0, 8)}`;
}

/** Normalize whitespace/comments/case away before counting independent formulas. */
function fingerprint(n: Node): string {
  const json = JSON.stringify(n, (key, value: unknown) => {
    if (typeof value === 'bigint') return value.toString();
    if (key === 'binds' && Array.isArray(value)) return (value as Binding[]).map(([name, expression, rep]) =>
      rep ? [lower(name), expression, rep] : [lower(name), expression]);
    return typeof value === 'string' && ['name', 'occurrence', 'param', 'op'].includes(key) ? lower(value) : value;
  });
  return createHash('sha256').update(json).digest('hex');
}

// A coarse structural index avoids comparing every formula in two large files.
function shape(n: Node): string {
  return `${n.k}(${nodeChildren(n).map(shape).join(',')})`;
}

/** Match a complete tree, checking known names/operators and leaf values as additional anchors. */
function align(a: Node, b: Node, out: Observation[]): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'call': {
      if (b.k !== 'call' || a.args.length !== b.args.length) return false;
      const id = unknownFunctionId(a.name);
      if (id) {
        if (!candidateName(b.name)) return false;
        out.push({ id: tokenId('function', id), name: b.name });
      } else if (lower(a.name) !== lower(b.name)) return false;
      break;
    }
    case 'get': {
      if (b.k !== 'get') return false;
      const id = unknownGetId(a.param);
      if (id) {
        if (!candidateName(b.param)) return false;
        out.push({ id: tokenId('get', id), name: b.param });
      } else if (lower(a.param) !== lower(b.param)) return false;
      break;
    }
    case 'num': return b.k === 'num' && a.value === b.value && a.exact === b.exact;
    case 'str': return b.k === 'str' && a.value === b.value;
    case 'field':
      if (b.k !== 'field' || lower(a.name) !== lower(b.name) || lower(a.occurrence ?? '') !== lower(b.occurrence ?? '')) return false;
      break;
    case 'var': if (b.k !== 'var' || lower(a.name) !== lower(b.name)) return false; break;
    case 'unary': if (b.k !== 'unary' || a.op !== b.op) return false; break;
    case 'bin': if (b.k !== 'bin' || a.op !== b.op) return false; break;
    case 'let':
      if (b.k !== 'let' || a.binds.length !== b.binds.length || a.binds.some(([name, , rep], i) => lower(name) !== lower(b.binds[i][0]) || !!rep !== !!b.binds[i][2])) return false;
      break;
  }
  const ac = nodeChildren(a), bc = nodeChildren(b);
  return ac.length === bc.length && ac.every((n, i) => align(n, bc[i], out));
}

/** Maximum number of distinct source/target pairs: neither side may count twice. */
function independent(pairs: Map<string, Set<string>>): number {
  const assigned = new Map<string, string>();
  const assign = (left: string, visited: Set<string>): boolean => {
    for (const right of pairs.get(left) ?? []) {
      if (visited.has(right)) continue;
      visited.add(right);
      const previous = assigned.get(right);
      if (previous === undefined || assign(previous, visited)) { assigned.set(right, left); return true; }
    }
    return false;
  };
  for (const left of pairs.keys()) assign(left, new Set());
  return assigned.size;
}

function clipboardFormulas(xml: string): string[] {
  let doc;
  try { doc = parseXml(xml.replace(/^\uFEFF/, '')); }
  catch { throw new Error('pair-tokens: invalid clipboard XML'); }
  const roots = kids(doc);
  if (roots.length !== 1 || roots[0].name !== 'fmxmlsnippet') throw new Error('pair-tokens: expected clipboard XML (fmxmlsnippet); Save a Copy as XML is not supported');
  const formulas: string[] = [];
  const pending = [roots[0]];
  while (pending.length) {
    const el = pending.pop()!;
    if (el.name === 'Calculation') {
      // Clipboard calculations are direct text/CDATA, not Save-as-XML's nested <Text>.
      if (kid(el, 'Text') || kids(el).length) throw new Error('pair-tokens: expected direct clipboard Calculation text');
      formulas.push(text(el) ?? '');
    } else pending.push(...kids(el).reverse());
  }
  return formulas;
}

/** Synthetic callers and the file command share the same pairing path. Never evaluates a formula. */
export function pairTokenCalcs(decoded: Iterable<string>, xml: string, names: CalcNames = {}, locals: string[] = []): PairingReport {
  const skipped = { decoded: 0, xml: 0 };
  const table = new NameTable(names);
  const trees = (formulas: Iterable<string>, side: keyof typeof skipped): Tree[] => {
    const unique = new Map<string, Tree>();
    for (const formula of formulas) {
      try {
        const node = parse(formula, table, locals);
        const hash = fingerprint(node);
        unique.set(hash, { node, hash });
      } catch { skipped[side]++; }
    }
    return [...unique.values()];
  };
  const targets = new Map<string, Tree[]>();
  for (const tree of trees(clipboardFormulas(xml), 'xml')) {
    const key = shape(tree.node);
    const bucket = targets.get(key) ?? [];
    bucket.push(tree);
    targets.set(key, bucket);
  }
  const evidence = new Map<string, Map<string, Evidence>>();
  for (const source of trees(decoded, 'decoded')) {
    const unknown = unknownCalcTokens(source.node);
    if (!unknown.length) continue;
    for (const token of unknown) {
      const id = tokenId(token.kind, token.id);
      if (!evidence.has(id)) evidence.set(id, new Map());
    }
    for (const target of targets.get(shape(source.node)) ?? []) {
      const found: Observation[] = [];
      if (!align(source.node, target.node, found)) continue; // Never count a partially matched tree.
      for (const { id, name } of found) {
        const byName = evidence.get(id)!;
        let e = byName.get(lower(name));
        if (!e) byName.set(lower(name), e = { name, pairs: new Map() });
        let rights = e.pairs.get(source.hash);
        if (!rights) e.pairs.set(source.hash, rights = new Set());
        rights.add(target.hash);
      }
    }
  }
  return {
    tokens: [...evidence].sort(([a], [b]) => a.localeCompare(b)).map(([id, byName]) => {
      const names = [...byName.values()].map((e) => ({ name: reportName(e.name, id), agreements: [...e.pairs.values()].reduce((n, s) => n + s.size, 0), independent: independent(e.pairs) })).sort((a, b) => a.name.localeCompare(b.name));
      return { id, names, ...(names.length === 1 && names[0].independent >= 3 ? { candidate: names[0].name } : {}) };
    }),
    skipped,
  };
}

/** Read definitions only. Close the binary file on success and failure; no conversion/store writes. */
export function pairTokenFile(path: string, xmlPath: string): PairingReport {
  // Validate before opening a binary file. Do not echo parser errors or input paths.
  let xml: string;
  try {
    const bytes = readFileSync(xmlPath);
    xml = new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8', { fatal: true }).decode(bytes);
  } catch { throw new Error('pair-tokens: could not read clipboard XML'); }
  clipboardFormulas(xml);
  let db: FmpDatabase | undefined;
  try {
    db = FmpDatabase.open(path);
    const decoded: string[] = [];
    const schema = observeCalcs({ token() {}, formula: (formula) => decoded.push(formula) }, () => {
      const schema = db!.schema;
      readLayoutDesigns(db!.file, schema);
      return schema;
    });
    const fields = schema.tables.flatMap((t) => t.fields.map((f) => f.name));
    const occurrences: [string, string[]][] = schema.tableOccurrences.map((to) => [to.name, to.dataSourceId === undefined ? schema.tables.find((t) => t.id === to.baseTableId)?.fields.map((f) => f.name) ?? [] : []]);
    return pairTokenCalcs(decoded, xml, { fields, occurrences }, schema.customFunctions.flatMap((f) => f.parameters));
  } catch { throw new Error('pair-tokens: could not read or pair definitions'); }
  finally { db?.close(); }
}
