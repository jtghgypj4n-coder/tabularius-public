// An inventory of every place the code reads a record's data from a store, made from the code itself (through the type
// checker) so that a new reader cannot be added without being looked at. A "reader" is a call of one of the Store methods
// that return field values, record counts, found-set sizes, orders or aggregates (READ_APIS), or a call that runs SQL on the
// store's database directly. For each call the scan records where it is, which method of what class it is in, and whether
// the call passes the caller's privileges (an argument, or a property of an options object, whose type is Privileges).
// The test (packages/server/test/read-gate-typed.test.ts) fails for a call that is neither gated this way nor
// classified in scripts/read-gate-typed-allowlist.json with the reason it may read without the caller's privileges.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/** Internal tables (`_fm_*`) that hold record values or the contents of containers, not only the file's design or accounts. */
export const DATA_BEARING_INTERNAL = ['_fm_audit', '_fm_containers', '_fm_container_chunks', '_fm_container_versions', '_fm_deleted', '_fm_pii_vault', '_fm_pending', '_fm_sync_log', '_fm_persistent', '_fm_calc_refresh'];

/**
 * What a statement of SQL reads: `data` (a table of the file's own records: any table not named `_fm_*`, or a name put in
 * by the code), `internal-data` (an internal table that holds record values), or undefined (the design, accounts, settings
 * or a statement that reads nothing).
 */
export function sqlReads(text: string): 'data' | 'internal-data' | undefined {
  const sql = text.replace(/\s+/g, ' ');
  if (!/\b(SELECT|RETURNING)\b/i.test(sql)) return undefined;
  const from = [...sql.matchAll(/\b(?:FROM|JOIN)\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\$\{[^}]*\}|[A-Za-z_][\w.]*)/gi)].map((m) => m[1]);
  let kind: 'data' | 'internal-data' | undefined;
  for (const name of from) {
    const bare = name.replace(/^["`\[]|["`\]]$/g, '').toLowerCase();
    if (name.startsWith('${') || !bare.startsWith('_fm_') && !/^(json_each|json_tree|pragma_|sqlite_|\(|select|values|generate_series)/.test(bare) && !['dual'].includes(bare)) kind = 'data';
    else if (!kind && DATA_BEARING_INTERNAL.some((t) => bare === t)) kind = 'internal-data';
  }
  return kind;
}

/** Store methods that return record data (values, counts, orders, aggregates, file contents) to the caller. */
export const READ_APIS = [
  'find', 'get', 'getMany', 'selectIds', 'countIds', 'computeValues', 'findIds', 'groupSummaries', 'sortIds', 'matchIds',
  'select', 'foundSetRows', 'portalCounts', 'fieldIndex', 'valueListItems', 'evaluate', 'evaluateEach', 'evaluateRows',
  'recordCount', 'recordAsOf', 'container', 'containerInfo', 'containerRange', 'auditLog', 'query', 'queryWithOrigins',
  'iterateCommitted', 'row', 'previewRow', 'viewableIds', 'viewableCount', 'summaryMasked',
] as const;
const READ_SET = new Set<string>(READ_APIS);

export interface Reader {
  /** `file:line`, repo-relative. */
  at: string;
  file: string;
  line: number;
  /** The enclosing function or method (`Class.method`, `function`, or `<top>`). */
  within: string;
  /** What is called: `Store.find`, `sql.prepare`. */
  api: string;
  /** Whether an argument (or a property of an options object) has the type Privileges. */
  gated: boolean;
  /** For SQL run directly on the store's database: what the statement reads (see sqlReads). */
  sqlKind?: 'data' | 'internal-data';
  /** The call's text, shortened, to tell two calls in one function apart. */
  text: string;
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const pkg of readdirSync(join(root, 'packages'))) {
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
      }
    };
    try { walk(join(root, 'packages', pkg, 'src')); } catch { /* a package without src */ }
  }
  return out;
}

function enclosing(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isConstructorDeclaration(n)) {
      const name = n.name && ts.isIdentifier(n.name) ? n.name.text : ts.isConstructorDeclaration(n) ? 'constructor' : '<anonymous>';
      const cls = n.parent && ts.isClassLike(n.parent) && n.parent.name ? n.parent.name.text : '';
      return cls ? `${cls}.${name}` : name;
    }
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.text;
    if (ts.isPropertyDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      const cls = n.parent && ts.isClassLike(n.parent) && n.parent.name ? n.parent.name.text : '';
      return cls ? `${cls}.${n.name.text}` : n.name.text;
    }
  }
  return '<top>';
}

/** `x.sql` or a bare `sql`: the store's database connection, by the name every module gives it. */
const isSqlReceiver = (e: ts.Expression): boolean => (ts.isPropertyAccessExpression(e) && e.name.text === 'sql') || (ts.isIdentifier(e) && e.text === 'sql');

const isPrivileges = (t: ts.Type): boolean => {
  const seen = (x: ts.Type): boolean => x.isUnion() ? x.types.some(seen) : x.symbol?.name === 'Privileges';
  return seen(t);
};

export function scan(root: string): Reader[] {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const files = sourceFiles(root);
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const readers: Reader[] = [];

  const gatedBy = (args: readonly ts.Expression[]): boolean => {
    const check = (e: ts.Expression): boolean => {
      if (isPrivileges(checker.getTypeAtLocation(e))) return true;
      if (ts.isObjectLiteralExpression(e)) {
        return e.properties.some((p) => {
          if (ts.isSpreadAssignment(p)) return check(p.expression);
          if (ts.isShorthandPropertyAssignment(p)) return isPrivileges(checker.getTypeAtLocation(p.name));
          if (ts.isPropertyAssignment(p)) return check(p.initializer);
          return false;
        });
      }
      // An options variable: any property of its type that is Privileges (and is set by the caller, not merely optional in the type).
      const t = checker.getTypeAtLocation(e);
      return t.getProperties().some((s) => s.name === 'privileges' && !!s.valueDeclaration && ts.isPropertyAssignment(s.valueDeclaration));
    };
    return args.some(check);
  };

  for (const sf of program.getSourceFiles()) {
    if (!files.includes(sf.fileName)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        let api: string | undefined;
        if (READ_SET.has(name)) {
          const sym = checker.getSymbolAtLocation(node.expression.name);
          const decl = sym?.declarations?.[0];
          const owner = decl && decl.parent && ts.isClassLike(decl.parent) ? decl.parent.name?.text : undefined;
          if (owner === 'Store') api = `Store.${name}`;
        } else if ((name === 'prepare' || name === 'exec') && isSqlReceiver(node.expression.expression)) {
          api = `sql.${name}`;
        } else if (name === 'prepared' || name === 'statement') {
          // The store's and the calculation engine's caches of prepared statements: the statement is read where it is made.
          const decl = checker.getSymbolAtLocation(node.expression.name)?.declarations?.[0];
          const owner = decl && decl.parent && ts.isClassLike(decl.parent) ? decl.parent.name?.text : undefined;
          if (owner === 'Store' || owner === 'Calculations') api = `sql.${name}`;
        }
        let sqlKind: Reader['sqlKind'];
        if (api?.startsWith('sql.')) {
          const first = node.arguments[0];
          const literal = first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first));
          // A statement that is not written out where it is run (a variable) cannot be read: it counts as reading data (not for exec, which returns no rows).
          sqlKind = !first ? undefined : literal ? sqlReads(ts.isStringLiteralLike(first) ? first.text : first.getText()) : api === 'sql.exec' ? undefined : 'data';
          if (!sqlKind) api = undefined;
        }
        if (api) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          const file = relative(root, sf.fileName);
          readers.push({
            at: `${file}:${line + 1}`, file, line: line + 1, within: enclosing(node), api,
            gated: api.startsWith('sql.') ? false : gatedBy(node.arguments),
            ...(sqlKind ? { sqlKind } : {}),
            text: node.getText().replace(/\s+/g, ' ').slice(0, 100),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return readers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Why an ungated reader may read without the caller's privileges. */
export const GATES = ['full-access', 'checked-before', 'own-account', 'store-internal', 'no-record-data', 'trusted-process'] as const;
export interface Allowance {
  file: string;
  /** The enclosing function (`Class.method`). */
  within: string;
  api: string;
  /** How many calls of `api` the function has (an exact count: a new call has to be looked at). */
  count: number;
  gate: typeof GATES[number];
  /** The check, or the reason none is needed, in a sentence. */
  why: string;
}

/** The readers, and what is wrong with the classification of them: an ungated reader nobody looked at, or a classification of one that is gone. */
export function check(root: string, allow: Allowance[]): { readers: Reader[]; problems: string[] } {
  const readers = scan(root);
  const problems: string[] = [];
  const key = (file: string, within: string, api: string) => `${file}::${within}::${api}`;
  const listed = new Map<string, Allowance>();
  for (const a of allow) {
    if (!(GATES as readonly string[]).includes(a.gate)) problems.push(`${key(a.file, a.within, a.api)}: gate "${a.gate}" is not one of ${GATES.join(', ')}`);
    if (!a.why || a.why.length < 12) problems.push(`${key(a.file, a.within, a.api)}: say why it may read without the caller's privileges`);
    if (listed.has(key(a.file, a.within, a.api))) problems.push(`${key(a.file, a.within, a.api)}: listed twice`);
    listed.set(key(a.file, a.within, a.api), a);
  }
  const open = new Map<string, Reader[]>();
  for (const r of readers) if (!r.gated) open.set(key(r.file, r.within, r.api), [...(open.get(key(r.file, r.within, r.api)) ?? []), r]);
  for (const [k, sites] of open) {
    const a = listed.get(k);
    if (!a) problems.push(`${k}: ${sites.length} read${sites.length > 1 ? 's' : ''} of record data without the caller's privileges (${sites.map((s) => s.line).join(', ')}): pass them, or classify it in scripts/read-gate-typed-allowlist.json with the check that makes it safe`);
    else if (a.count !== sites.length) problems.push(`${k}: ${sites.length} reads now (lines ${sites.map((s) => s.line).join(', ')}), classified for ${a.count}: look at the new one and update the count`);
  }
  for (const [k, a] of listed) if (!open.has(k)) problems.push(`${k}: classified (${a.gate}) but no ungated read is there any more: remove the entry`);
  return { readers, problems };
}
