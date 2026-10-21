/** Code-derived store read/capability inventory. No imports of application code or solution files. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';
import ts from 'typescript';

export const READ_APIS = {
  Store: new Set(`recordCount auditLog recordAsOf pendingChanges previewRecordRule foundSetRows portalCounts fieldIndex valueListItems externalContainerCheck externalContainerCount externalContainerReport orphanContainerReport container containerInfo containerRange embeddedContainerCount containerId find previewRow row get getMany canViewRecord canView evaluate evaluateEach evaluateRows selectIds countIds computeValues findIds groupSummaries sortIds matchIds iterateCommitted select describe query queryWithOrigins inspectQuery viewableIds scopedTableSql persistentData persistentDataIds`.split(' ')),
  Calculations: new Set(`globalValue value unstoredValue unstoredStyled collect collector summary wholeTable related firstRelated relatedIds statement context executeSQL translateSQL computeStored computeStoredStyled`.split(' ')),
  related: new Set(['relatedRows', 'relatedIdList', 'firstRelatedEach', 'keyValue']),
  calc: new Set(['rowsById', 'rowsOf']),
};
/**
 * The names of read APIs for members of untyped receivers. Everyday method names (get, find, select...) are reported
 * only when the receiver is a cast of a Store, a calculation engine or a SQLite connection to any/unknown, so a
 * Map or an array typed any is not.
 */
const EVERYDAY = new Set(['get', 'find', 'select', 'query', 'value', 'row', 'context', 'collect', 'related', 'summary', 'statement', 'describe', 'container', 'sql']);
const NAMED = new Set([...READ_APIS.Store, ...READ_APIS.Calculations, ...READ_APIS.related, ...READ_APIS.calc]);
for (const common of EVERYDAY) NAMED.delete(common);
export interface ReadSite { file: string; line: number; fn: string; api: string; hash: string }
export interface AllowedReader { file: string; fn: string; gate: string; sites: { api: string; hash: string }[] }
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 20);
const normalized = (node: ts.Node) => node.getText().replace(/\s+/g, ' ');

function sources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.isFile() && /\.[cm]?[jt]sx?$/.test(e.name) && !/\.d\.[cm]?ts$/.test(e.name)) out.push(join(dir, e.name));
    }
  };
  for (const e of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(root, 'packages', e.name, 'src'));
  }
  return out.sort();
}

function scope(node: ts.Node): string {
  const names: string[] = [];
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isConstructorDeclaration(p)) {
      names.unshift(ts.isConstructorDeclaration(p) ? 'constructor' : p.name?.getText() ?? '<anonymous>');
    } else if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      if (ts.isVariableDeclaration(p.parent) || ts.isPropertyAssignment(p.parent)) names.unshift(p.parent.name.getText());
      else if (ts.isCallExpression(p.parent)) {
        const label = p.parent.arguments[0];
        if (label && ts.isStringLiteral(label)) names.unshift(label.text);
      }
    } else if (ts.isClassDeclaration(p) && p.name) names.unshift(p.name.text);
  }
  return names.join('/') || '<module>';
}

/** Resolve declarations, rather than matching Map.get/Array.find by spelling. Also catches aliases and bracket calls. */
export function collectReadSites(root = resolve(import.meta.dirname, '..'), overrides = new Map<string, string>()): ReadSite[] {
  const roots = sources(root);
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, allowImportingTsExtensions: true, allowJs: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = (path) => overrides.get(relative(root, path)) ?? read(path);
  const program = ts.createProgram(roots, options, host);
  const checker = program.getTypeChecker();
  const included = new Set(roots);
  const sites: ReadSite[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!included.has(sf.fileName)) continue;
    const add = (node: ts.Node, api: string) => {
      let expression = node;
      while ((ts.isPropertyAccessExpression(expression.parent) || ts.isElementAccessExpression(expression.parent) || ts.isCallExpression(expression.parent))
        && expression.parent.expression === expression) expression = expression.parent;
      sites.push({ file: relative(root, sf.fileName), line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        fn: scope(node), api, hash: digest(normalized(expression)) });
    };
    const classify = (decl: ts.Declaration | undefined): string | undefined => {
      if (!decl) return;
      const file = decl.getSourceFile().fileName;
      const name = (decl as ts.NamedDeclaration).name?.getText();
      if (!name) return;
      if (file.endsWith('/node/sqlite.d.ts') && ['prepare', 'get', 'all', 'iterate'].includes(name)) return `SQLite.${name}`;
      if (file.endsWith('/store/src/store.ts') && (READ_APIS.Store.has(name) || name === 'sql')) return `Store.${name}`;
      if (file.endsWith('/store/src/calc.ts') && READ_APIS.Calculations.has(name)) return `Calculations.${name}`;
      if (file.endsWith('/store/src/calc.ts') && READ_APIS.calc.has(name)) return name;
      if (file.endsWith('/store/src/related.ts') && READ_APIS.related.has(name)) return name;
    };
    // A receiver the compiler cannot type (any, unknown, an unresolved import) hides which declaration is called, so a
    // member with a read-API name on it is reported by its name. A computed key on one (`(s as any)[key]()`) is not:
    // such keys are everywhere in code that has nothing to do with the store, so that case stays a known gap.
    const untyped = (e: ts.Expression) => (checker.getTypeAtLocation(e).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    const holdsReader = (type: ts.Type) => (type.symbol?.declarations ?? []).some((d) => /\/(store\/src\/(store|calc|related)\.ts|node\/sqlite\.d\.ts)$/.test(d.getSourceFile().fileName));
    // Whether an expression is a Store, calculation engine or connection cast to any/unknown, directly or through a variable.
    const castOfReader = (e: ts.Expression, depth = 0): boolean => {
      if (depth > 4) return false;
      while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
      if (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e)) return holdsReader(checker.getTypeAtLocation(e.expression)) || castOfReader(e.expression, depth + 1);
      if (ts.isIdentifier(e)) {
        const declaration = checker.getSymbolAtLocation(e)?.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return castOfReader(declaration.initializer, depth + 1);
      }
      return false;
    };
    const untypedApi = (receiver: ts.Expression, name: string): string | undefined =>
      untyped(receiver) && (NAMED.has(name) || (EVERYDAY.has(name) && castOfReader(receiver))) ? `Untyped.${name}` : undefined;
    const unresolved = (receiver: ts.Expression, name: ts.Node): string | undefined =>
      ts.isStringLiteral(name) || ts.isIdentifier(name) ? untypedApi(receiver, name.text) : undefined;
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const name = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
        const symbol = checker.getSymbolAtLocation(name) ?? (ts.isStringLiteral(name) ? checker.getTypeAtLocation(node.expression).getProperty(name.text) : undefined);
        const api = symbol?.declarations?.map(classify).find(Boolean) ?? unresolved(node.expression, name);
        if (api) add(node, api);
      } else if (ts.isCallExpression(node) && !ts.isPropertyAccessExpression(node.expression) && !ts.isElementAccessExpression(node.expression)) {
        const api = classify(checker.getResolvedSignature(node)?.declaration);
        if (api) add(node, api);
      } else if (ts.isBindingElement(node)) {
        // Destructuring a raw connection or read method is a capability transfer, too.
        const decl = node.parent.parent;
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
          const name = (node.propertyName ?? node.name).getText();
          const symbol = checker.getTypeAtLocation(decl.initializer).getProperty(name);
          const api = symbol?.declarations?.map(classify).find(Boolean) ?? untypedApi(decl.initializer, name);
          if (api) add(node, api);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.api.localeCompare(b.api));
}

export function unclassified(sites: ReadSite[], allow: AllowedReader[]): string[] {
  const actual = new Map<string, number>(), expected = new Map<string, number>();
  const key = (file: string, fn: string, api: string, hash: string) => JSON.stringify([file, fn, api, hash]);
  for (const s of sites) { const k = key(s.file, s.fn, s.api, s.hash); actual.set(k, (actual.get(k) ?? 0) + 1); }
  for (const a of allow) for (const s of a.sites) { const k = key(a.file, a.fn, s.api, s.hash); expected.set(k, (expected.get(k) ?? 0) + 1); }
  return [...new Set([...actual.keys(), ...expected.keys()])].filter((k) => actual.get(k) !== expected.get(k));
}

export function inventoryMarkdown(sites: ReadSite[], allow: AllowedReader[]): string {
  return ['<!-- generated read-gate inventory -->', '| Function | Store read / capability (source lines) | Gate |', '| --- | --- | --- |',
    ...allow.map((a) => {
      const found = sites.filter((s) => s.file === a.file && s.fn === a.fn);
      return `| [${a.file}:${found[0]?.line ?? '?'}](../../${a.file}#L${found[0]?.line ?? 1}) \`${a.fn}\` | ${[...new Set(found.map((s) => s.api))].map((api) => `\`${api}\` (${found.filter((s) => s.api === api).map((s) => s.line).join(', ')})`).join('; ')} | ${a.gate} |`;
    }), '<!-- end generated read-gate inventory -->'].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, '..');
  const allow = JSON.parse(readFileSync(join(root, 'notes/audits/read-gate-allowlist.json'), 'utf8')) as AllowedReader[];
  const sites = collectReadSites(root);
  const missing = unclassified(sites, allow);
  if (missing.length) throw new Error(`${missing.length} changed/unclassified read sites; review their gates before editing the allow-list:\n${missing.join('\n')}`);
  const path = join(root, 'notes/audits/audit-read-gate-inventory.md');
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/<!-- generated read-gate inventory -->[\s\S]*?<!-- end generated read-gate inventory -->/, inventoryMarkdown(sites, allow));
  if (process.argv.includes('--check')) {
    if (before !== after) throw new Error('Read-gate report is stale; run node scripts/read-gate-inventory.ts');
  } else writeFileSync(path, after);
  console.log(`${sites.length} read/capability sites in ${allow.length} functions; all classified`);
}
